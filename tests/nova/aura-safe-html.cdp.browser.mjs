// Real Chromium/CDP regression for Aura's sanitized visual artifact boundary.
// Requires Playwright available to the runtime test environment.
// Does NOT assert that the user's live JACO instance was tested.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const runtimeRoot=fileURLToPath(new URL('../../runtime/',import.meta.url));
const require=createRequire(path.join(runtimeRoot,'package.json'));
const {chromium}=await import(process.env.JACO_PLAYWRIGHT_MODULE || require.resolve('playwright'));
const source=fs.readFileSync(new URL('../../runtime/src/lib/auraSafeHtml.mjs',import.meta.url),'utf8');
let browser=null;
const passed=[];
const ok=(condition,name)=>{assert.ok(condition,name);passed.push(name);console.log('PASS '+name);};
try {
  browser=await chromium.launch({headless:true,
    ...(process.env.JACO_BROWSER_EXECUTABLE?{executablePath:process.env.JACO_BROWSER_EXECUTABLE}:{}),
    args:['--no-sandbox','--disable-dev-shm-usage','--remote-allow-origins=*']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const outbound=[];
  page.on('request',request=>{if(request.url().includes('capture-leak.example'))outbound.push(request.url());});
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0;background:#08121b;color:#e2f2fa;font-family:system-ui}.main{height:100vh;display:flex}.chat{width:40%;padding:20px;border-right:1px solid #38516a}.stage{flex:1;padding:20px}.mat{height:60vh}.mat iframe{width:100%;height:100%;border:0}@media(max-width:767px){.main[data-focus=chat] .stage{display:none}.main[data-focus=stage] .chat{display:none}.main .chat,.main .stage{width:100%;flex:1}}</style>
    <div class="main" data-focus="chat"><div class="chat"><h1>Aura</h1><button id="focus">Visa arbete</button></div>
    <div class="stage"><button id="pin">Fäst</button><h2 id="name">Arbetsyta</h2><div class="mat"></div></div></div>
    <script>let pinned=false;document.querySelector('#pin').onclick=()=>{pinned=!pinned};
      document.querySelector('#focus').onclick=()=>document.querySelector('.main').dataset.focus='stage';
      window.present=(name,raw)=>{if(pinned)return;document.querySelector('#name').textContent=name;
      const frame=document.createElement('iframe');frame.setAttribute('sandbox','');
      frame.srcdoc='<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;;"><body>'+window.safeHtml(raw)+'</body>';
      document.querySelector('.mat').replaceChildren(frame);};</script>`);
  await page.evaluate(async code=>{
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    try{window.safeHtml=(await import(url)).sanitizeAuraStageHtml;}
    finally{URL.revokeObjectURL(url);}
  },source);
  const hostile='<h1 id="material">Material visas</h1><img src="https://capture-leak.example/img">' +
    '<style>h1{color:#22ccea}body{background-image:url(https://capture-leak.example/css)}</style>' +
    '<script>parent.document.body.dataset.infected="yes"</script>';
  await page.evaluate(raw=>window.present('HTML arbetskopia',raw),hostile);
  ok(await page.frameLocator('iframe').locator('#material').innerText()==='Material visas','live HTML text rendered');
  ok(await page.evaluate(()=>document.body.dataset.infected||null)===null,'host scripts blocked');
  ok(await page.locator('iframe').getAttribute('sandbox')==='','iframe has no script or origin grants');
  ok((await cdp.send('Runtime.evaluate',{expression:'document.querySelector("iframe").getAttribute("sandbox")',returnByValue:true})).result.value==='','CDP inspected opaque sandbox');
  const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'});
  ok(typeof screenshot.data==='string' && screenshot.data.length>2000,'real CDP PNG screenshot received');
  await page.locator('#pin').click();
  await page.evaluate(()=>window.present('OTHER','<h1>wrong</h1>'));
  ok(await page.locator('#name').innerText()==='HTML arbetskopia','pinned content unchanged');
  await page.locator('#pin').click();
  await page.evaluate(()=>window.present('NEW','<h1 id="new">new</h1>'));
  ok(await page.locator('#name').innerText()==='NEW','unpin follows fresh material');
  await page.setViewportSize({width:393,height:852});
  ok(await page.locator('.chat').isVisible() && !(await page.locator('.stage').isVisible()),'mobile starts at Aura chat');
  await page.locator('#focus').click();
  ok(await page.locator('.stage').isVisible() && !(await page.locator('.chat').isVisible()),'mobile focuses stage');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile no horizontal overflow');
  ok(outbound.length===0,'zero unauthorized image or CSS request attempts');
  if(process.env.JACO_UI_SCREENSHOTS) {
    fs.mkdirSync(process.env.JACO_UI_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:path.join(process.env.JACO_UI_SCREENSHOTS,'aura-sanitized-stage-cdp.png')});
  }
  console.log(`CDP PASS ${passed.length}/${passed.length} – isolated fixture with production sanitizer module`);
} finally {await browser?.close();}
