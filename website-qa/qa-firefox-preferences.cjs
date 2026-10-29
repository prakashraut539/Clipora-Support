/* Additional stock-Firefox coverage using temporary profile preferences. */
const {Builder,By}=require('selenium-webdriver');
const firefox=require('selenium-webdriver/firefox');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.QA_BASE_URL||'https://clipora.deltabits.in',out=path.resolve('qa-results/firefox-preferences');fs.mkdirSync(out,{recursive:true});
const results=[],profiles=[];let d;
async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});console.log(`FAIL ${name}: ${e.message}`);}}
const js=(fn,...args)=>d.executeScript(fn,...args),el=s=>d.findElement(By.css(s));
async function start(prefs){const o=new firefox.Options().setBrowserVersion('stable').addArguments('-headless');for(const [k,v]of Object.entries(prefs))o.setPreference(k,v);d=await new Builder().forBrowser('firefox').setFirefoxOptions(o).build();await d.manage().window().setRect({width:800,height:900});const c=await d.getCapabilities();profiles.push({browser:c.get('browserVersion'),prefs});}
(async()=>{
try{
  await start({'javascript.enabled':false});
  for(const route of ['/','/guide.html','/privacy.html','/support.html','/press.html','/404.html'])await check(`No JavaScript: ${route} navigation and reading`,async()=>{
    await d.get(base+route);assert(await(await el('#main-nav')).isDisplayed());assert(!await(await el('.menu-toggle')).isDisplayed());assert(await text('h1'));assert(await js(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await(await el('#main-nav a[href="/guide.html"]')).click();assert.match(await d.getCurrentUrl(),/\/guide(?:\.html)?$/);
  });
  await d.get(base+'/');fs.writeFileSync(path.join(out,'no-javascript.png'),await d.takeScreenshot(),'base64');await d.quit();
  await start({'ui.prefersReducedMotion':1});await d.get(base+'/');
  await check('Reduced motion preference is honored at first load',async()=>{assert(await js(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));assert.equal(await(await el('.motion-toggle')).getAttribute('aria-pressed'),'true');assert(await js(()=>document.getAnimations().filter(a=>a instanceof CSSAnimation).every(a=>a.playState!=='running')));});
  await check('Explicit resume and pause work with reduced motion preference',async()=>{await(await el('.motion-toggle')).click();assert.equal(await js(()=>getComputedStyle(document.querySelector('.note')).animationPlayState),'running');assert.notEqual(await js(()=>getComputedStyle(document.querySelector('.note')).animationName),'none');await(await el('.motion-toggle')).click();assert(await js(()=>document.getAnimations().filter(a=>a instanceof CSSAnimation).every(a=>a.playState!=='running')));});
  fs.writeFileSync(path.join(out,'reduced-motion.png'),await d.takeScreenshot(),'base64');await d.quit();
  await start({'permissions.default.image':2,'browser.display.use_document_fonts':0});
  for(const route of ['/','/guide.html','/privacy.html','/support.html','/press.html','/404.html'])await check(`Blocked images and document fonts: ${route}`,async()=>{await d.get(base+route);assert(await js(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await(await el('.header-actions .button')).isDisplayed());});
  await d.get(base+'/');await check('Demo works with images and fonts disabled',async()=>{await(await el('#clip-search')).sendKeys('thank');await(await el('.clip-main')).click();assert.match(await(await el('#paste-target')).getAttribute('value'),/Thanks/);});
  fs.writeFileSync(path.join(out,'blocked-assets.png'),await d.takeScreenshot(),'base64');
}finally{await d?.quit();const report={finished:new Date().toISOString(),profiles,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;}
})().catch(e=>{console.error(e);process.exitCode=1;});
async function text(s){return(await el(s)).getText();}
