/* Repeatable website acceptance suite. Uses isolated profiles and synthetic input only. */
function dependency(name, override) { return require(process.env[override] || name); }
const pw = dependency('playwright','PLAYWRIGHT_MODULE');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const axe = dependency('axe-core','AXE_MODULE');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:8766';
const out = path.resolve(process.env.QA_OUTPUT || 'qa-results/cross-browser'); fs.mkdirSync(out, { recursive: true });
const routes = ['/', '/guide.html', '/privacy.html', '/support.html', '/press.html', '/404.html'];
function canonical(href){const u=new URL(href);u.pathname=u.pathname.replace(/\/index\.html$/,'/').replace(/\.html$/,'');return u.href;}
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
        else if(links[i].download){const downloadPromise=page.waitForEvent('download');await link.click();const d=await downloadPromise;assert.equal(await d.failure(),null);assert(d.suggestedFilename().endsWith('.png'));}
        else {await link.click();await page.waitForURL(u=>canonical(u.href)===canonical(url.href));if(url.hash){assert(await page.locator(url.hash).count());if(url.hash==='#main')assert(await page.locator('#main').evaluate(e=>e===document.activeElement));}}
      });
    }
    await check(engine,'Motion running, paused, resumed; scroll reveals and progress',async()=>{
      await go(page);await page.setViewportSize({width:1440,height:1000});await page.locator('.motion-toggle').click();
      assert.equal(await page.locator('.note').first().evaluate(e=>getComputedStyle(e).animationPlayState),'running');
      for(const selector of ['.note','.picture','.link-card','.shortcut','.search-pill i','.privacy-lock','.final-cta svg']) assert.notEqual(await page.locator(selector).first().evaluate(e=>getComputedStyle(e).animationName),'none');
      await page.locator('.motion-toggle').click();assert.equal(await page.locator('.note').first().evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
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
      await page.locator('.motion-toggle').click();assert.equal(await page.locator('.note').first().evaluate(e=>getComputedStyle(e).animationPlayState),'running');assert.notEqual(await page.locator('.note').first().evaluate(e=>getComputedStyle(e).animationName),'none');
      await page.evaluate(()=>{window.qaMotionChanges=0;matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>window.qaMotionChanges++);});
      await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>window.qaMotionChanges===1);assert.equal(await page.locator('.motion-toggle').getAttribute('aria-pressed'),'false');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.qaMotionChanges===2);assert.equal(await page.locator('.motion-toggle').getAttribute('aria-pressed'),'true');
      await page.emulateMedia({reducedMotion:'no-preference'});
    });
    await check(engine,'Forced colors retains control boundaries and focus',async()=>{
      await go(page);await page.emulateMedia({forcedColors:'active'});await page.locator('#clip-search').focus();assert.notEqual(await page.locator('#clip-search').evaluate(e=>getComputedStyle(e).outlineStyle),'none');await page.screenshot({path:path.join(out,`${engine}-forced-colors.png`)});await page.emulateMedia({forcedColors:'none'});
    });
    await check(engine,'Fallback fonts, blocked script and images remain navigable',async()=>{
      await page.route('**/*.ttf',r=>r.abort());await page.route('**/*.png',r=>r.abort());await go(page);await page.setViewportSize({width:320,height:568});await noOverflow(page);assert(await page.locator('.hero-actions .button').isVisible());await page.unroute('**/*.ttf');await page.unroute('**/*.png');
    });
    await check(engine,'No JavaScript mobile navigation and reading',async()=>{
      const nc=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:568}}),np=await nc.newPage();
      for(const route of routes){await np.goto(base+route);await noOverflow(np);assert(await np.locator('#main-nav').isVisible());assert(await np.locator('.menu-toggle').isHidden());await np.locator('#main-nav a[href="/guide.html"]').click();await np.waitForURL(u=>canonical(u.href)===canonical(base+'/guide.html'));}await nc.close();
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
})().catch(e=>{console.error(e);process.exitCode=1;});
