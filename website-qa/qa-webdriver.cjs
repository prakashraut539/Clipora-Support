/* Public website QA. Isolated browser profile; synthetic text; no clipboard or account access. */
const {Builder, By, Key} = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const axe = require('axe-core');
const browser = process.env.QA_BROWSER || 'firefox';
const base = process.env.QA_BASE_URL || 'https://clipora.deltabits.in';
const out = path.resolve(process.env.QA_OUTPUT || `qa-results/${browser}`);
fs.mkdirSync(out, {recursive:true});
const results=[], limits=[], layouts=[], links={}, errors=[], started=new Date().toISOString();
let d, capabilities;
const routes=['/','/guide.html','/privacy.html','/support.html','/press.html','/404.html'];
function canonical(href){const u=new URL(href);u.pathname=u.pathname.replace(/\/index\.html$/,'/').replace(/\.html$/,'');return u.href;}
const el=s=>d.findElement(By.css(s)), all=s=>d.findElements(By.css(s));
const js=(fn,...args)=>d.executeScript(fn,...args);
const value=s=>el(s).then(e=>e.getAttribute('value'));
const attr=(s,n)=>el(s).then(e=>e.getAttribute(n));
const text=s=>el(s).then(e=>e.getText());
const count=async s=>(await all(s)).length;
const wait=fn=>d.wait(fn,10000);
const focus=s=>js(s=>document.querySelector(s).focus(),s);
const click=async s=>{const e=await el(s);await js(e=>e.scrollIntoView({block:'center',behavior:'instant'}),e);await e.click();};
const keys=async(s,...k)=>(await el(s)).sendKeys(...k);
const fill=async(s,v)=>{await (await el(s)).clear();if(v)await keys(s,v);else await js(s=>document.querySelector(s).dispatchEvent(new Event('input',{bubbles:true})),s);};
const noOverflow=async()=>assert(await js(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow');
const isFocus=async s=>js(s=>document.activeElement===document.querySelector(s),s);
async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});console.log(`FAIL ${name}: ${e.message.slice(0,700)}`);try{fs.writeFileSync(path.join(out,`failure-${results.length}.png`),await d.takeScreenshot(),'base64');}catch{}}}
async function screenshot(name){fs.writeFileSync(path.join(out,`${name}.png`),await d.takeScreenshot(),'base64');}
async function navigate(url){
  const current=new URL((await d.getCurrentUrl())||'about:blank'),destination=new URL(canonical(url));
  const token=current.origin==='null'?null:await js(()=>{window.qaNavigationToken=Math.random().toString();return window.qaNavigationToken;});
  if(current.href===destination.href)await d.navigate().refresh();
  else {await d.get(destination.href);if(current.origin===destination.origin&&current.pathname===destination.pathname&&current.search===destination.search)await d.navigate().refresh();}
  await wait(async()=>{const state=await js(()=>({url:document.URL,ready:document.readyState,token:window.qaNavigationToken}));return state.url.startsWith('http')&&canonical(state.url)===canonical(url)&&state.ready==='complete'&&(!token||state.token!==token);});
}
async function go(route='/'){
  await navigate(base+route);
  await d.executeAsyncScript('const done=arguments[arguments.length-1];document.fonts.ready.then(()=>done(true));');
  await js(()=>{window.qaErrors=[];addEventListener('error',e=>window.qaErrors.push(e.message));addEventListener('unhandledrejection',e=>window.qaErrors.push(String(e.reason)));});
  if(await attr('.motion-toggle','aria-pressed')!=='true')await click('.motion-toggle');
}
async function size(width,height){
  await d.manage().window().setRect({x:0,y:0,width,height});
  let rect=await js(()=>({width:innerWidth,height:innerHeight,outerWidth,outerHeight}));
  await d.manage().window().setRect({width:width+rect.outerWidth-rect.width,height:height+rect.outerHeight-rect.height});
  rect=await js(()=>({width:innerWidth,height:innerHeight}));
  layouts.push({requested:{width,height},actual:rect});return rect;
}
async function scan(name){
  await js(axe.source);
  const a=await d.executeAsyncScript(`const done=arguments[arguments.length-1];axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']}}).then(done).catch(e=>done({error:e.message}));`);
  fs.writeFileSync(path.join(out,`axe-${name}.json`),JSON.stringify(a,null,2));
  assert(!a.error,a.error);assert.equal(a.violations.length,0,JSON.stringify(a.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))));
}
async function demo(){
  await go();await check('Initial sample count, pinned order and image preview',async()=>{
    assert.equal(await count('.clip-row'),5);assert.equal(await attr('.clip-row','data-clip-id'),'reply');
    assert(await js(()=>{const i=document.querySelector('.clip-icon img');return i.complete&&i.naturalWidth>0;}));
  });
  for(const id of ['reply','link','image','idea','meeting']){
    await check(`Insert ${id} into selected destination range`,async()=>{
      await fill('#paste-target','before AFTER');await js(()=>document.querySelector('#paste-target').setSelectionRange(7,12));
      await click(`[data-clip-id="${id}"] .clip-main`);const v=await value('#paste-target');assert(v.startsWith('before '));assert(!v.includes('AFTER'));assert(v.length>15);assert(await isFocus('#paste-target'));assert.match(await text('#demo-status'),id==='image'?/placeholder/:/pasted/);
    });
    await check(`Pin and unpin ${id}, order and focus`,async()=>{
      const s=`[data-clip-id="${id}"] .pin-button`,prior=await attr(s,'aria-pressed');
      await click(s);assert.equal(await attr(s,'aria-pressed'),String(prior!=='true'));assert(await isFocus(s));
      const pins=await js(()=>Array.from(document.querySelectorAll('.pin-button'),e=>e.getAttribute('aria-pressed')==='true'));
      assert(!pins.some((v,i)=>v&&pins.slice(0,i).includes(false)));await click(s);assert.equal(await attr(s,'aria-pressed'),prior);
    });
  }
  for(const [filter,n]of[['text',3],['link',1],['image',1],['all',5]])await check(`Filter ${filter}`,async()=>{await click(`[data-filter="${filter}"]`);assert.equal(await count('.clip-row'),n);assert.equal(await count('.demo-filters [aria-pressed=true]'),1);});
  await check('Search case, whitespace, content, no results and clear',async()=>{
    await fill('#clip-search','  THANK  ');assert.equal(await count('.clip-row'),1);await fill('#clip-search','next steps');assert.equal(await attr('.clip-row','data-clip-id'),'meeting');
    await fill('#clip-search','<script>not a clip</script>');assert.equal(await count('.clip-row'),0);assert(await(await el('.empty-results')).isDisplayed());await keys('#clip-search',Key.ARROW_DOWN,Key.ENTER);
    await click('#clear-search');assert.equal(await count('.clip-row'),5);assert(await isFocus('#clip-search'));assert(!await(await el('#clear-search')).isDisplayed());
  });
  await check('Combined filter/search and Escape',async()=>{await click('[data-filter="image"]');await fill('#clip-search','thank');assert.equal(await count('.clip-row'),0);await keys('#clip-search',Key.ESCAPE);assert.equal(await count('.clip-row'),1);await click('[data-filter="all"]');});
  await check('Keyboard wrapping, announcement and Enter',async()=>{await click('#reset-demo');await keys('#clip-search',Key.ARROW_UP);assert.equal(await attr('.is-selected','data-clip-id'),'meeting');assert.match(await text('#demo-status'),/Selected The meeting/);await keys('#clip-search',Key.ARROW_DOWN);assert.equal(await attr('.is-selected','data-clip-id'),'reply');await keys('#clip-search',Key.ENTER);assert.match(await value('#paste-target'),/Thanks/);});
  await check('IME composition guards',async()=>{
    await click('#reset-demo');await js(()=>{const e=document.querySelector('#clip-search');e.value='thank';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));});
    assert.equal(await count('.clip-row'),5);assert.equal(await value('#paste-target'),'');await js(()=>document.querySelector('#clip-search').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));assert.equal(await count('.clip-row'),1);
  });
  for(const theme of ['light','dark'])await check(`Theme ${theme}, selection and accessibility`,async()=>{await click(`.segmented [data-theme="${theme}"]`);assert.equal(await attr('#demo-picker','data-theme'),theme);await scan(`demo-${theme}`);await screenshot(`demo-${theme}`);});
  await check('Density choices and full reset',async()=>{
    await click('[data-density="compact"]');assert((await attr('#demo-picker','class')).includes('compact'));await click('[data-density="roomy"]');assert(!(await attr('#demo-picker','class')).includes('compact'));
    await click('.segmented [data-theme="light"]');await click('[data-density="compact"]');await click('#reset-demo');assert.equal(await attr('#demo-picker','data-theme'),'dark');assert(!(await attr('#demo-picker','class')).includes('compact'));assert.equal(await value('#paste-target'),'');assert.equal(await value('#clip-search'),'');assert.equal(await count('.clip-row'),5);
  });
  await check('Long text remains inside destination',async()=>{await js(()=>{document.querySelector('#paste-target').value='Synthetic long text '.repeat(1000);});await noOverflow();assert(await js(()=>{const e=document.querySelector('#paste-target');return e.scrollHeight>e.clientHeight;}));await click('#reset-demo');});
  for(const shot of ['library-light.png','settings.png','library.png'])await check(`Screenshot selector ${shot}`,async()=>{await click(`[data-shot="${shot}"]`);await wait(()=>js(()=>{const e=document.querySelector('#workspace-shot');return e.complete&&e.naturalWidth>0;}));assert((await attr('#workspace-shot','src')).endsWith(shot));assert.equal(await count('.workspace-tabs [aria-pressed=true]'),1);});
  for(let i=1;i<=5;i++)await check(`FAQ ${i}: keyboard and pointer open/close`,async()=>{const s=`.faq-list details:nth-child(${i}) summary`,isOpen=()=>js(s=>document.querySelector(s).parentElement.open,s);await focus(s);await keys(s,Key.ENTER);assert(await isOpen());await keys(s,Key.SPACE);assert(!await isOpen());await click(s);assert(await isOpen());await click(s);assert(!await isOpen());});
  await check('Synthetic clipboard isolation and no saved demo data',async()=>{
    await js(()=>{for(const name of ['read','readText','write','writeText'])try{Object.defineProperty(navigator.clipboard,name,{value:()=>{throw new Error('Clipboard must not be accessed');},configurable:true});}catch{};});
    await click('#reset-demo');await click('[data-clip-id="reply"] .clip-main');assert.match(await value('#paste-target'),/Thanks/);assert.equal(await js(()=>sessionStorage.length+localStorage.length),0);assert.equal(await js(()=>location.search),'');
  });
}
async function pages(){
  for(const route of routes){
    await size(1440,1000);await go(route);const slug=route==='/'?'home':route.replace(/\W/g,'');
    await check(`${route} semantic structure, fonts and axe`,async()=>{assert.equal(await count('h1'),1);assert(await d.getTitle());assert.equal(await attr('html','lang'),'en');assert(await js(()=>document.fonts.check('650 24px Bricolage')&&document.fonts.check('400 16px Manrope')));await scan(slug);});
    await screenshot(`${slug}-desktop`);
    const seen=new Set();
    for(const [w,h]of[[320,568],[360,800],[390,844],[430,932],[568,320],[760,900],[768,1024],[844,390],[1024,768],[1280,800],[1440,1000],[1920,1080]]){
      const actual=await size(w,h),key=`${actual.width}x${actual.height}`;
      if(actual.width!==w||actual.height!==h)limits.push(`${route}: OS window limits requested ${w}x${h} to ${key}`);
      if(seen.has(key))continue;seen.add(key);
      await check(`${route} actual viewport ${key}`,async()=>{await noOverflow();assert.deepEqual(await js(()=>Array.from(document.querySelectorAll('.site-header a,.header-actions button')).filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left < -1||r.right>innerWidth+1;}).map(e=>e.textContent)),[]);});
    }
    await size(568,800);
    await check(`${route} narrow menu, Escape, outside interaction and breakpoint`,async()=>{
      await click('.menu-toggle');assert.equal(await attr('.menu-toggle','aria-expanded'),'true');await keys('.menu-toggle',Key.ESCAPE);assert(await isFocus('.menu-toggle'));assert.equal(await attr('.menu-toggle','aria-expanded'),'false');
      await click('.menu-toggle');await d.actions().move({origin:'viewport',x:5,y:(await js(()=>innerHeight))-10}).click().perform();assert.equal(await attr('.menu-toggle','aria-expanded'),'false');await click('.menu-toggle');await size(1024,768);await wait(async()=>await attr('.menu-toggle','aria-expanded')==='false');await size(568,800);
    });
    await check(`${route} narrow tap targets`,async()=>{assert.deepEqual(await js(()=>Array.from(document.querySelectorAll('button')).filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44;}).map(e=>e.outerHTML)),[]);});
    await screenshot(`${slug}-narrow`);
    await check(`${route} 200% CSS layout zoom`,async()=>{await size(1280,900);await js(()=>document.documentElement.style.zoom='2');try{await noOverflow();}finally{await js(()=>document.documentElement.style.zoom='');}});
    await size(568,800);
    links[route]=await js(()=>Array.from(document.querySelectorAll('a'),e=>({href:e.getAttribute('href'),text:e.textContent.trim(),download:e.hasAttribute('download')})));
    for(let i=0;i<links[route].length;i++)await check(`${route} link ${i+1}: ${links[route][i].text.slice(0,40)}`,async()=>{
      await go(route);let a=(await all('a'))[i];
      if(await js(e=>!!e.closest('#main-nav'),a))await click('.menu-toggle');
      await js(e=>{if(e.classList.contains('skip')){e.focus();}else e.scrollIntoView({block:'center',behavior:'instant'});},a);
      const href=links[route][i].href,url=new URL(href,await d.getCurrentUrl());
      if(url.origin===new URL(base).origin&&!links[route][i].download){
        const from=new URL(await d.getCurrentUrl()),destination=new URL(canonical(url.href));
        const changesDocument=from.pathname!==url.pathname||from.search!==url.search||!url.hash;
        const token=await js(()=>{window.qaNavigationToken=Math.random().toString();return window.qaNavigationToken;});
        await a.click();await wait(async()=>canonical(await d.getCurrentUrl())===canonical(url.href)&&await js((token,changes)=>document.readyState==='complete'&&(!changes||window.qaNavigationToken!==token),token,changesDocument));
        if(url.hash){assert(await js(hash=>!!document.querySelector(hash),url.hash));if(url.hash==='#main')assert(await isFocus('#main'));}
      }
      else {await js(e=>{window.qaLink=null;e.addEventListener('click',event=>{event.preventDefault();window.qaLink={href:e.href,download:e.hasAttribute('download')};},{once:true});},a);await a.click();const captured=await js(()=>window.qaLink);assert.equal(captured.href,url.href);assert.equal(captured.download,links[route][i].download);}
    });
    errors.push(...await js(()=>window.qaErrors||[]));
  }
}
(async()=>{
  try{
    const builder=new Builder().forBrowser(browser);if(browser==='firefox')builder.setFirefoxOptions(new firefox.Options().setBrowserVersion('stable').addArguments('-headless'));
    d=await builder.build();const caps=await d.getCapabilities();capabilities={browserName:caps.get('browserName'),browserVersion:caps.get('browserVersion'),platformName:caps.get('platformName')};await d.manage().setTimeouts({implicit:0,pageLoad:30000,script:30000});await size(1440,1000);
    await demo();await pages();
    await check('Motion running, paused timeline, resume, reveals and progress',async()=>{
      await go();await size(1440,1000);await click('.motion-toggle');
      for(const s of ['.search-pill i','.privacy-lock','.final-cta svg'])assert.notEqual(await js(s=>getComputedStyle(document.querySelector(s)).animationName,s),'none');
      assert.equal(await js(()=>getComputedStyle(document.querySelector('.search-pill i')).animationPlayState),'running');await click('.motion-toggle');
      await d.executeAsyncScript('const done=arguments[arguments.length-1];Promise.all(document.getAnimations().map(a=>a.ready)).then(()=>done(true));');
      const times=()=>js(()=>document.getAnimations().filter(a=>a instanceof CSSAnimation).map(a=>a.currentTime));const t=await times();await new Promise(r=>setTimeout(r,150));assert.deepEqual(await times(),t);assert.equal(await js(()=>getComputedStyle(document.querySelector('.button')).transitionDuration),'0s');
      await click('.motion-toggle');await js(()=>document.querySelector('.final-cta').scrollIntoView({behavior:'instant'}));await wait(()=>js(()=>parseFloat(document.documentElement.style.getPropertyValue('--reading-progress'))>80));await js(()=>document.querySelector('.privacy-copy').scrollIntoView({behavior:'instant'}));await wait(()=>js(()=>document.querySelector('.privacy-copy').classList.contains('is-visible')));
    });
    await check('Native image composition helper variants',async()=>{for(const variant of ['quick','library','pins','appearance','unknown']){await navigate(base+'/store-shot.html?view='+variant);assert(await text('#headline'));await wait(()=>js(()=>{const e=document.querySelector('#view');return e.complete&&e.naturalWidth>0;}));}});
    await check('Nested missing URL retains branded navigation and assets',async()=>{await go('/qa-missing/deep-page');assert.match(await text('h1'),/lost|find|404|wandering/i);assert(await js(()=>document.styleSheets.length>0));await click('.brand');await wait(()=>js(base=>document.URL===base+'/'&&document.readyState==='complete'&&!!document.querySelector('#demo-picker'),base));assert.equal(await d.getCurrentUrl(),base+'/');});
    await check('No captured page errors',async()=>assert.deepEqual(errors,[]));
    await go();await size(1440,1000);await screenshot('final-hero');await js(()=>document.querySelector('#demo-picker').scrollIntoView({block:'center',behavior:'instant'}));await screenshot('final-demo');
    for(const href of [...new Set(Object.values(links).flat().map(l=>l.href))])await check(`HTTP destination ${href}`,async()=>{const u=new URL(href,base);u.hash='';const r=await fetch(u,{signal:AbortSignal.timeout(30000)});assert(r.ok,`HTTP ${r.status}`);if(href.endsWith('.png'))assert((await r.arrayBuffer()).byteLength>1000);});
  }catch(e){results.push({name:'Browser/setup or uncaught suite failure',pass:false,error:e.stack});console.error(e.stack);}
  finally{await d?.quit();const report={browser,base,started,finished:new Date().toISOString(),capabilities,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,limits:[...new Set(limits)],layouts,links,results};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({browser,version:capabilities?.browserVersion,passed:report.passed,failed:report.failed,out}));process.exitCode=report.failed?1:0;}
})();
