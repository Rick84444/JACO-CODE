import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installRecipes,installRecipe,installRecipePlan} from '../../site/jacocode.com/install-recipes.mjs';
import {handleInstallDiscovery} from '../../site/jacocode.com/cloud-discovery.mjs';

async function invoke(route,method='GET') {
  const url=new URL('https://jacocode.com'+route);
  const r=handleInstallDiscovery(new Request(url,{method}),url);
  if(!r) return null;
  return {status:r.status,data:await r.json(),headers:r.headers};
}
test('recipe catalog is an explicit, platform-filtered read-only discovery API',async()=>{
  const all=await invoke('/cloud/v1/catalog');
  assert.equal(all.status,200);
  assert.equal(all.data.schema,'jaco.install-catalog/v1');
  assert.equal(all.data.execution,'NOT_AVAILABLE_ON_PUBLIC_ENDPOINT');
  const ids=all.data.recipes.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['jaco-lite-windows','ollama-windows','ollama-qwen-coder-1p5b-windows','bonsai-llamacpp-existing-windows','bonsai-termux-existing-android','jaco-android-chat-remote'])
    assert.ok(ids.includes(id));
  const onlyWindows=await invoke('/cloud/v1/catalog?platform=windows');
  assert.ok(onlyWindows.data.recipes.every(x=>x.platforms.includes('windows')));
  assert.equal(onlyWindows.data.recipes.length,4);
  assert.equal(all.headers.get('cache-control'),'no-store');
});
test('public plans are explicit approval plans, not remote code execution',async()=>{
  const result=await invoke('/cloud/v1/recipe-plan?platform=windows&recipe=ollama-windows');
  assert.equal(result.status,200);
  assert.equal(result.data.status,'PLAN_ONLY');
  assert.equal(result.data.operatorApproval,'REQUIRED');
  assert.equal(result.data.execution,'NOT_STARTED');
  assert.equal(result.data.remoteExecution,'NOT_CONNECTED');
  assert.equal(result.data.recipe.installer,'windows-winget-ollama');
  assert.equal(result.data.recipe.agent,undefined);
  assert.equal(result.data.agent,'Aura');
  assert.equal(result.data.agentCount,1);
  const android=await invoke('/cloud/v1/recipe-plan?platform=android-chat&recipe=jaco-android-chat-remote');
  assert.equal(android.status,200);
  assert.equal(android.data.localDeviceRequired,false);
});
test('discovery fails closed on unknown IDs, platforms, query injection and writes',async()=>{
  assert.equal((await invoke('/cloud/v1/recipe-plan?platform=windows&recipe=evil')).status,404);
  assert.equal((await invoke('/cloud/v1/recipe-plan?platform=android-chat&recipe=ollama-windows')).status,400);
  assert.equal((await invoke('/cloud/v1/recipe-plan?platform=windows')).status,400);
  assert.equal((await invoke('/cloud/v1/catalog?platform=windows&url=https://evil.test')).status,400);
  assert.equal((await invoke('/cloud/v1/catalog?platform=windows&platform=android-chat')).status,400);
  assert.equal((await invoke('/cloud/v1/catalog','POST')).status,405);
  assert.equal((await invoke('/cloud/v1/recipe-plan?platform=windows&recipe=ollama-windows','POST')).status,405);
  assert.throws(()=>installRecipe('ollama-windows','android-chat'),/INSTALL_PLATFORM_UNSUPPORTED/);
  assert.throws(()=>installRecipe('bogus','windows'),/INSTALL_RECIPE_UNKNOWN/);
});
test('external mutation cannot change the canonical allowlisted recipe',()=>{
  const one=installRecipe('ollama-windows','windows');
  one.platforms.push('android-chat');
  one.installer='shell';
  one.approvals.splice(0);
  const canonical=installRecipe('ollama-windows','windows');
  assert.equal(canonical.installer,'windows-winget-ollama');
  assert.ok(canonical.approvals.length);
  assert.deepEqual(canonical.platforms,['windows']);
  assert.ok(installRecipes({platform:'android-chat'}).every(x=>x.kind==='client'));
  assert.equal(installRecipePlan('bonsai-llamacpp-existing-windows','windows').recipe.status,'PREREQUISITES_REQUIRED');
});
test('existing Cloudflare Worker mounts both public discovery routes',()=>{
  const worker=fs.readFileSync('site/jacocode.com/worker.mjs','utf8');
  assert.match(worker,/handleInstallDiscovery/);
  assert.match(worker,/cloud\\/v1\\/catalog/);
  assert.match(worker,/cloud\\/v1\\/recipe-plan/);
});
