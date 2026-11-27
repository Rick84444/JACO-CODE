// Controlled browser test of the actual provider components; no vendor network or real secrets.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../runtime/',import.meta.url));
const require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild');
const {chromium}=await import(process.env.JACO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.JACO_PLAYWRIGHT_MODULE).href : pathToFileURL(require.resolve('playwright')).href);
const bundle=await build({stdin:{contents:
  "import React from 'react';import{createRoot}from'react-dom/client';import{ProviderConnect}from'./src/components/ProviderConnect';import{McpServersPanel}from'./src/components/McpServersPanel';import{UiLanguageProvider}from'./src/i18n/UiLanguage';function Fixture(){const [allow,setAllow]=React.useState(true);return <UiLanguageProvider initialLanguage='sv'>{location.search.includes('integrations')?<McpServersPanel observedAt={new Date().toISOString()} providers={[{id:'render',name:'Render',role:'Cloud',status:'READY',transport:'http',error:null,agentAccess:'read',credentialConfigured:true,allowOpenLogin:allow,catalogMatch:true,loginOpeningSupported:true,tools:[{name:'list_services',description:'Read services',readOnly:true,agentAllowed:true}],deny:['delete_service'],stats:{calls:0,failures:0,refused:0,lastCall:null}}]} recentCalls={[]} busy={null} selectedToolId={null} onStart={()=>{}} onSelectTool={()=>{}} onChanged={message=>{if(message.includes('revoked'))setAllow(false);}}/>:<ProviderConnect onConnected={()=>{}}/>}</UiLanguageProvider>}createRoot(document.getElementById('root')).render(<Fixture/>);",
  resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'esm',jsx:'automatic'});
const cssDir=path.join(root,'dist','assets');
const cssFiles=fs.readdirSync(cssDir).filter(f=>f.endsWith('.css'));
assert.ok(cssFiles.length,'production CSS required');
const css=cssFiles.map(f=>fs.readFileSync(path.join(cssDir,f),'utf8')).join('\n');
const brains=[{id:'claude',providerId:'claude-cli',label:'Claude',plan:'Claude Code',installed:true,loggedIn:false,loginKind:'browser'},{id:'gemini',providerId:'gemini-cli',label:'Gemini',plan:'Code Assist',installed:true,loggedIn:false,loginKind:'terminal',loginHint:'gemini'},{id:'codex',providerId:'codex-cli',label:'Codex',plan:'ChatGPT',installed:true,loggedIn:false,loginKind:'browser'}];
const mutations=[];
let linearPending=false;
const linearStatus=()=>({success:true,provider:'linear',state:linearPending?'waiting':'idle',error:null,pending:linearPending,existingConfiguration:false,credentialState:'NOT_CONFIGURED',configured:false,accountVerified:false,verifiedAt:null,toolsDiscovered:null,runtimeReady:false,agentExecutionVerified:false});
const server=http.createServer(async(req,res)=>{
  const send=(body,type='application/json')=>{res.setHeader('content-type',type);res.end(type==='application/json'?JSON.stringify(body):body);};
  if(req.url==='/'||req.url==='/?integrations=1')return send('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#202225;color:white"><div id="root" style="width:min(100%,340px);margin:12px auto"></div><script type="module" src="/app.js"></script></body></html>','text/html');
  if(req.url==='/style.css')return send(css,'text/css');
  if(req.url==='/app.js')return send(bundle.outputFiles[0].text,'text/javascript');
  if(req.method==='POST'||req.method==='PATCH'){
    let body='';for await(const c of req)body+=c;
    mutations.push({url:req.url,body:JSON.parse(body||'{}')});
    if(req.url.endsWith('/mcp/oauth/linear/start')){linearPending=true;return send({success:true,state:'waiting',url:'https://mcp.linear.app/authorize?state=fixture-state&scope=read'});}
    if(req.url.endsWith('/mcp/oauth/linear/cancel')){linearPending=false;return send(linearStatus());}
    return send({success:true,result:{state:'READY',id:'gemini',models:['fixture-model'],defaultModel:'fixture-model'}});
  }
  if(req.url.endsWith('/mcp/oauth/linear'))return send(linearStatus());
  if(req.url.endsWith('/brains'))return send({success:true,brains});
  if(req.url.endsWith('/chatgpt-plan'))return send({success:true,connected:false,state:'disconnected',models:[]});
  if(req.url.endsWith('/providers/scan'))return send({success:true,providers:[]});
  if(req.url.endsWith('/providers/catalog'))return send({success:true,providers:[]});
  res.statusCode=404;return send({success:false,error:'FIXTURE_NOT_FOUND'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true});
  for(const width of [1440,393]){
    const page=await browser.newPage({viewport:{width,height:852}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base='http://127.0.0.1:'+server.address().port;
    await page.goto(base);
    const openai=page.getByRole('button',{name:/^OpenAI —/});
    await openai.click();
    const dialog=page.getByRole('dialog',{name:'OpenAI'});
    await dialog.getByRole('button',{name:'Fortsätt med ChatGPT'}).waitFor();
    assert.equal(mutations.length,0,'opening a dialog never initiates authentication');
    const bounds=await dialog.boundingBox();
    assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1,'dialog fits viewport');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.equal(await openai.evaluate(el=>document.activeElement===el),true,'focus returns to launcher');
    await page.getByRole('button',{name:/^Gemini —/}).click();
    const g=page.getByRole('dialog',{name:'Gemini'});
    await g.getByText('Anslut med API-nyckel',{exact:true}).click();
    const field=g.getByLabel('API-nyckel för modellleverantören');
    await field.fill('fixture-only');
    await g.getByRole('button',{name:'Stäng'}).click();
    await g.waitFor({state:'hidden'});
    await page.getByRole('button',{name:/^Gemini —/}).click();
    await g.getByText('Anslut med API-nyckel',{exact:true}).click();
    assert.equal(await field.inputValue(),'','unsaved secret cleared on close');
    await field.fill('fixture-only');
    await g.getByRole('button',{name:'Spara',exact:true}).click();
    await g.getByText(/gemini är ansluten/).waitFor();
    assert.equal(mutations.at(-1).body.provider,'gemini');
    assert.equal(mutations.at(-1).url,'/api/aura/workbench/providers/key');
    if(process.env.JACO_UI_SCREENSHOTS){fs.mkdirSync(process.env.JACO_UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.JACO_UI_SCREENSHOTS,'provider-dialog-'+width+'.png')});}
    await g.getByRole('button',{name:'Stäng'}).click();
    await page.getByRole('button',{name:/^Fler —/}).click();
    await page.getByRole('dialog',{name:'Fler'}).getByLabel('Modellleverantörens adress').waitFor();
    assert.deepEqual(errors,[]);
    mutations.length=0;
    await page.goto(base+'/?integrations=1');
    const render=page.getByRole('button',{name:'Review Render integration'});
    await render.click();
    const detail=page.getByRole('dialog',{name:'Render'});
    await detail.waitFor();
    assert.equal(mutations.length,0,'opening existing integration cannot mutate its configuration');
    assert.equal(await detail.getByRole('button',{name:'Configure connection'}).count(),0);
    const detailBounds=await detail.boundingBox();
    assert.ok(detailBounds&&detailBounds.x>=0&&detailBounds.x+detailBounds.width<=width+1,'integration dialog fits viewport');
    const optIn=detail.getByRole('checkbox',{name:/Allow Aura to open/});
    assert.equal(await optIn.isChecked(),true);
    await Promise.all([page.waitForResponse(r=>r.url().endsWith('/servers/render/access')),optIn.click()]);
    await page.waitForFunction(()=>!document.querySelector('dialog[open] input[type=checkbox]')?.checked);
    assert.equal(mutations.length,1);
    assert.deepEqual(mutations[0],{url:'/api/aura/workbench/mcp/servers/render/access',body:{allowOpenLogin:false}});
    if(process.env.JACO_UI_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JACO_UI_SCREENSHOTS,'integration-dialog-'+width+'.png')});
    await page.keyboard.press('Escape');
    await detail.waitFor({state:'hidden'});
    assert.equal(await render.evaluate(el=>document.activeElement===el),true);
    await page.getByRole('button',{name:'Available',exact:true}).click();
    await page.getByRole('button',{name:'Review CoinGecko integration'}).click();
    await page.getByRole('dialog',{name:'CoinGecko'}).getByRole('button',{name:'Configure connection'}).click();
    const setup=page.getByRole('dialog',{name:'Configure integration'});
    await setup.waitFor();
    assert.equal(await setup.getByLabel('Server id').inputValue(),'coingecko');
    assert.equal(mutations.length,1,'setup review is not a connection');
    await page.keyboard.press('Escape');
    await setup.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Review Linear integration'}).click();
    const linear=page.getByRole('dialog',{name:'Linear'});
    const signIn=linear.getByRole('button',{name:'Anslut med Linear',exact:true});
    await signIn.waitFor();
    assert.equal(mutations.length,1,'opening account dialog only reads status');
    await signIn.click();
    const signInLink=linear.getByRole('link',{name:'Öppna säker inloggning'});
    await signInLink.waitFor();
    assert.equal(await signInLink.getAttribute('href'),'https://mcp.linear.app/authorize?state=fixture-state&scope=read');
    assert.equal(await signInLink.getAttribute('target'),'_blank');
    assert.equal(mutations.at(-1).url,'/api/aura/workbench/mcp/oauth/linear/start');
    const linearBounds=await linear.boundingBox();
    assert.ok(linearBounds&&linearBounds.x>=0&&linearBounds.x+linearBounds.width<=width+1);
    if(process.env.JACO_UI_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JACO_UI_SCREENSHOTS,'linear-oauth-'+width+'.png')});
    await linear.getByRole('button',{name:'Avbryt',exact:true}).click();
    await signIn.waitFor();
    assert.equal(await signInLink.count(),0);
    assert.equal(mutations.at(-1).url,'/api/aura/workbench/mcp/oauth/linear/cancel');
    await page.keyboard.press('Escape');
    await linear.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    await page.close();
    mutations.length=0;
  }
  console.log('PASS: controlled desktop and phone provider dialogs (no real account or inference)');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
