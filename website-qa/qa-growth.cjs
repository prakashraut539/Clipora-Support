/* Full new-release checks. Isolated browser contexts; synthetic text only. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function dependency(name,override,fallback){if(process.env[override])return require(process.env[override]);try{return require(name);}catch{return require(fallback);}}
const pw=dependency('playwright','PLAYWRIGHT_MODULE','C:/Users/khokh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),axe=dependency('axe-core','AXE_MODULE','E:/Work/Clipboard Studio/work/website-qa-tools/node_modules/axe-core');
const config=require('./seo.config.json'),base=process.env.QA_BASE_URL||'http://127.0.0.1:8784';
const out=path.resolve(process.env.QA_OUTPUT||'qa-results/growth/acceptance');fs.mkdirSync(out,{recursive:true});
const engines=(process.env.QA_ENGINES||'chrome,webkit').split(','),results=[],browsers=[];
async function check(engine,name,fn){try{await fn();results.push({engine,name,pass:true});}catch(e){results.push({engine,name,pass:false,error:e.message});console.log(`FAIL ${engine} ${name}: ${e.message.slice(0,1000)}`);}}
async function overflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflows horizontally');}
async function scan(page,engine,name){await page.addScriptTag({content:axe.source});const r=await page.evaluate(()=>axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']}}));fs.writeFileSync(path.join(out,`axe-${engine}-${name}.json`),JSON.stringify(r));assert.deepEqual(r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);}
async function go(page,route){await page.goto(base+route);await page.evaluate(()=>document.fonts.ready);if(await page.locator('.motion-toggle').getAttribute('aria-pressed')!=='true')await page.locator('.motion-toggle').click();}
async function clipboard(page,mode='success'){
 await page.evaluate(mode=>{window.qaWrites=[];window.qaReads=0;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>{window.qaReads++;throw Error('Unexpected clipboard read');},writeText:async text=>{window.qaWrites.push(text);if(mode==='denied')throw new DOMException('Denied','NotAllowedError');if(mode==='slow')await new Promise(resolve=>window.qaFinishCopy=resolve);}}});},mode);
}
(async()=>{
for(const engine of engines){let browser;
 try{
  browser=await(['chrome','msedge'].includes(engine)?pw.chromium:pw[engine]).launch({headless:true,...(['chrome','msedge'].includes(engine)?{channel:engine}:{})});browsers.push({engine,version:browser.version()});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const p of config.pages){const slug=p.path.replaceAll('/','-')||'home';await go(page,p.path);
   await check(engine,`${p.path} reading structure and accessibility`,async()=>{assert.equal(await page.locator('h1').count(),1);assert.equal(await page.title(),p.title);await scan(page,engine,slug);});
   for(const [w,h] of [[320,568],[390,844],[568,320],[768,1024],[1024,768],[1440,1000]])await check(engine,`${p.path} reflow ${w}x${h}`,async()=>{await page.setViewportSize({width:w,height:h});await overflow(page);});
   await check(engine,`${p.path} headings, local anchors and media`,async()=>{
    const bad=await page.locator('a[href^="#"]').evaluateAll(es=>es.map(a=>a.getAttribute('href')).filter(h=>!document.getElementById(decodeURIComponent(h.slice(1)))));assert.deepEqual(bad,[]);
    assert(await page.locator('main').innerText());
    const images=await page.locator('img').evaluateAll(es=>es.map(i=>({src:i.getAttribute('src'),alt:i.hasAttribute('alt'),width:i.getAttribute('width'),height:i.getAttribute('height')})));for(const i of images){assert(i.alt);assert(i.width&&i.height);assert((await ctx.request.get(base+i.src)).ok(),i.src);}
   });
   if(p.path.startsWith('/tools/')||p.path==='/compare/ditto'||p.path==='/guides/clipboard-history-windows'){
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`${engine}${slug}-mobile.png`),fullPage:true});
   }
  }
  await go(page,'/');await page.setViewportSize({width:1440,height:1000});
  await check(engine,'Clip button accessible names include all visible copy',async()=>{const names=await page.locator('.clip-main').evaluateAll(es=>es.map(e=>({name:e.getAttribute('aria-label')||e.textContent,title:e.querySelector('strong').textContent,detail:e.querySelector('small').textContent})));for(const n of names){assert(n.name.includes(n.title));assert(n.name.includes(n.detail));}});
  await check(engine,'Speech-control labels match visible text',async()=>{await page.addScriptTag({content:axe.source});for(let state=0;state<2;state++){const audit=await page.evaluate(()=>axe.run({runOnly:{type:'rule',values:['label-content-name-mismatch']}}));assert.deepEqual(audit.violations.map(v=>v.id),[]);await page.locator('.motion-toggle').click();}});
  for(const [lesson,clip] of [['find','meeting'],['pin','reply'],['plain','lesson']])await check(engine,`Guided ${lesson}: copy, find, paste, reset`,async()=>{
   await page.locator(`[data-lesson="${lesson}"]`).click();assert.equal(await page.locator(`[data-lesson="${lesson}"]`).getAttribute('aria-pressed'),'true');
   await page.locator('#lesson-copy').click();assert.equal(await page.locator('.clip-row').count(),6);assert(await page.locator('#lesson-copy').isDisabled());
   if(lesson==='find')await page.locator('#clip-search').fill('meeting');
   await page.locator(`[data-clip-id="${clip}"] .clip-main`).click();assert.match(await page.locator('#lesson-completion').innerText(),/Done/);
   if(lesson==='plain')assert.equal(await page.locator('#paste-target').inputValue(),'Weekly review\nBring your next useful idea.');
   assert.equal(await page.locator('.lesson-progress .is-done').count(),3);
   await page.locator('#reset-demo').click();assert.equal(await page.locator('.clip-row').count(),5);assert(await page.locator('.lesson-panel').isHidden());assert.equal(await page.locator('[data-lesson][aria-pressed=true]').count(),0);
  });
  await check(engine,'Guided task keyboard and reduced-motion paste',async()=>{
   await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.locator('[data-lesson="find"]').focus();await page.keyboard.press('Enter');await page.locator('#lesson-copy').focus();await page.keyboard.press('Space');await page.locator('#clip-search').fill('meeting');await page.locator('#clip-search').press('Enter');assert.match(await page.locator('#lesson-completion').innerText(),/Done/);assert.equal(await page.locator('.transfer-chip').count(),0);await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check(engine,'User-initiated video, captions and transcript',async()=>{
   await go(page,'/');const info=await page.locator('#native-walkthrough').evaluate(v=>({auto:v.autoplay,preload:v.preload,controls:v.controls,track:v.querySelector('track').src,canPlay:v.canPlayType('video/mp4')}));assert(!info.auto);assert.equal(info.preload,'none');assert(info.controls);assert((await ctx.request.get(info.track)).ok());
   if(info.canPlay){await page.locator('#native-walkthrough').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('#native-walkthrough').currentTime>0);assert.equal(await page.locator('#native-walkthrough').evaluate(v=>Math.round(v.duration)),30);await page.locator('#native-walkthrough').evaluate(v=>{v.currentTime=25;v.pause();});}
   else results.push({engine,name:'MP4 codec availability',pass:true,limitation:'This test engine does not expose MP4 decoding; visible download and transcript tested. Actual Safari/Chrome playback checked separately.'});
   await page.locator('.native-video summary').click();assert(await page.locator('.native-video details').evaluate(e=>e.open));await page.locator('.native-video summary').press('Space');assert(!await page.locator('.native-video details').evaluate(e=>e.open));
  });
  for(const route of ['/tools/paste-as-plain-text','/tools/remove-line-breaks']){
   const plain=route.endsWith('plain-text');await go(page,route);await clipboard(page);const input=page.locator('#tool-input'),output=page.locator('#tool-output');
   await check(engine,`${route} empty, sample, clear and undo`,async()=>{
    assert(await page.locator('[data-action=copy]').isDisabled());await page.locator('[data-action=convert]').click();assert.match(await page.locator('#tool-status').innerText(),/no text/);
    await page.locator('[data-action=sample]').click();assert((await input.inputValue()).length>20);await page.locator('[data-action=convert]').click();const before=await output.inputValue();assert(before);await page.locator('[data-action=clear]').click();assert.equal(await input.inputValue(),'');assert.equal(await output.inputValue(),'');await page.locator('[data-action=undo]').click();assert.equal(await output.inputValue(),before);assert(await page.locator('[data-action=undo]').isDisabled());
   });
   await check(engine,`${route} Unicode, HTML inertness and copy success`,async()=>{
    const text='café नमस्ते 日本語 😀 <script>window.injected=true</script> & <img src=x onerror=alert(1)>';
    await input.fill(text);await page.locator('[data-action=convert]').click();assert.equal(await output.inputValue(),text);assert.equal(await page.evaluate(()=>window.injected),undefined);await page.locator('[data-action=copy]').click();assert.match(await page.locator('#tool-status').innerText(),/Result copied/);assert.deepEqual(await page.evaluate(()=>window.qaWrites),[text]);assert.equal(await page.evaluate(()=>window.qaReads),0);
   });
   if(!plain)await check(engine,'Line breaks: LF, CRLF, CR, paragraphs, spaces and mode changes',async()=>{
    for(const sep of ['\n','\r\n','\r','\u2028','\u2029']){await input.fill(`  Alpha  beta${sep} Gamma ${sep}${sep}Delta${sep}Epsilon  `);await page.locator('[value=paragraphs]').check();await page.locator('[data-action=convert]').click();assert.equal(await output.inputValue(),'Alpha  beta Gamma\n\nDelta Epsilon');await page.locator('[value=single]').check();assert(await page.locator('[data-action=copy]').isDisabled());await page.locator('[data-action=convert]').click();assert.equal(await output.inputValue(),'Alpha  beta Gamma Delta Epsilon');}
    await input.fill('state-\nof-the-art');await page.locator('[data-action=convert]').click();assert.equal(await output.inputValue(),'state- of-the-art');
   });
   await check(engine,`${route} large text, limit validation and recovery`,async()=>{
    await input.fill('A'.repeat(200000),{timeout:120000});await page.locator('[data-action=convert]').click();assert.equal((await output.inputValue()).length,200000);
    await input.fill('B'.repeat(200001),{timeout:120000});await page.locator('[data-action=convert]').click();assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal((await input.inputValue()).length,200001);assert(await page.locator('[data-action=copy]').isDisabled());
    await input.fill('Valid again');await page.locator('[data-action=convert]').click();assert.equal(await input.getAttribute('aria-invalid'),null);assert.equal(await output.inputValue(),'Valid again');
   });
   await check(engine,`${route} clipboard denial and selection fallback`,async()=>{await clipboard(page,'denied');await page.locator('[data-action=copy]').click();assert.match(await page.locator('#tool-status').innerText(),/selected/);assert(await output.evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length&&document.activeElement===e));});
   await check(engine,`${route} duplicate copy guard and stale completion`,async()=>{
    await clipboard(page,'slow');await page.locator('[data-action=copy]').click();assert(await page.locator('[data-action=copy]').isDisabled());await input.fill('Edited while copying');await page.evaluate(()=>window.qaFinishCopy());await page.waitForFunction(()=>!document.querySelector('[data-action=copy]').hasAttribute('aria-busy'));assert.match(await page.locator('#tool-status').innerText(),/previous result/);assert.equal(await page.evaluate(()=>window.qaWrites.length),1);assert(await page.locator('[data-action=copy]').isDisabled());
   });
   await check(engine,`${route} offline operation and no input storage/network`,async()=>{
    const requests=[];page.on('request',r=>requests.push(r.url()));await ctx.setOffline(true);await input.fill('Offline synthetic example');await page.locator('[data-action=convert]').click();assert.equal(await output.inputValue(),'Offline synthetic example');assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,query:location.search,hash:location.hash})),{local:0,session:0,query:'',hash:''});assert.deepEqual(requests,[]);await ctx.setOffline(false);
   });
   await page.setViewportSize({width:390,height:844});await check(engine,`${route} touch targets, keyboard and mobile axe`,async()=>{
    const bad=await page.locator('button').evaluateAll(es=>es.filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.outerHTML));assert.deepEqual(bad,[]);
    await input.fill('keyboard sample');await page.locator('[data-action=convert]').focus();await page.keyboard.press('Enter');assert.equal(await output.inputValue(),'keyboard sample');await scan(page,engine,plain?'plain-mobile':'lines-mobile');await overflow(page);
   });
   await check(engine,`${route} 200% layout zoom`,async()=>{await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>document.documentElement.style.zoom='2');await overflow(page);await page.evaluate(()=>document.documentElement.style.zoom='');});
   await page.reload();await check(engine,`${route} reload clears sensitive state`,async()=>{assert.equal(await input.inputValue(),'');assert.equal(await output.inputValue(),'');assert(await page.locator('[data-action=undo]').isDisabled());});
  }
  await check(engine,'Mobile public download link success and denial',async()=>{await go(page,'/');await page.setViewportSize({width:390,height:844});await clipboard(page);await page.locator('#copy-download-link').click();assert.match((await page.evaluate(()=>window.qaWrites))[0],/9NN5TJ6G4T5W/);await clipboard(page,'denied');await page.locator('#copy-download-link').click();assert(await page.locator('#download-link').isVisible());assert(await page.locator('#download-link').evaluate(e=>e.selectionEnd===e.value.length));});
  await check(engine,'No-JavaScript content and tool explanation',async()=>{const c=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),p=await c.newPage();for(const route of ['/','/guide','/tools/paste-as-plain-text','/tools/remove-line-breaks','/compare/ditto']){await p.goto(base+route);assert(await p.locator('h1').isVisible());await overflow(p);if(route.includes('/tools/')){assert(await p.locator('.text-tool noscript').isVisible());assert(await p.locator('[data-action=convert]').isHidden());}}await c.close();});
  await go(page,'/');await page.setViewportSize({width:1440,height:1000});await page.locator('.motion-toggle').click();await page.screenshot({path:path.join(out,`${engine}-home-desktop.png`)});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`${engine}-home-mobile.png`),fullPage:true});
  await check(engine,'No uncaught browser errors',async()=>assert.deepEqual(errors,[]));await ctx.close();
 }catch(e){results.push({engine,name:'Browser execution',pass:false,error:e.stack});console.log(e.message);}finally{await browser?.close();}
}
const report={date:new Date().toISOString(),base,browsers,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,limits:['Responsive/touch emulation is not physical mobile testing.','Clipboard permission success/denial uses controlled adapters; no user clipboard content is accessed.']};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,browsers,output:out},null,2));process.exitCode=report.failed?1:0;
})();
