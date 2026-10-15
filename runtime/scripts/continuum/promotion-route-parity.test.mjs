import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const router=fs.readFileSync(path.join(root,'src/server/continuum/router.mjs'),'utf8');
const standalone=fs.readFileSync(path.join(root,'src/server/continuum/standalone-server.mjs'),'utf8');

for(const route of [
  '/cognition/promotions/receipt',
  '/cognition/promotions/decision',
]){
  assert.equal(router.includes(route),true,`router missing ${route}`);
  assert.equal(standalone.includes('/api/continuum'+route),true,`standalone missing ${route}`);
}

console.log('PROMOTION_ROUTE_PARITY: PASS (integrated router + standalone Continuum)');
