// A local llama.cpp brain configured through jacoctl's JACO_LLAMACPP_URL must be an
// eligible local Continuum provider, so A2A_INBOUND work reaches it without cloud spend.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const { ContinuumRuntime } = await import('../../src/server/continuum/continuumRuntime.mjs');
class S{async list(){return []}}
const fresh=()=>new ContinuumRuntime({workspaceRoot:fs.mkdtempSync(path.join(os.tmpdir(),'llamacpp-')),browserSessions:new S()});

process.env.JACO_LLAMACPP_URL='http://127.0.0.1:9380/v1';
process.env.JACO_LLAMACPP_MODEL='/data/data/com.termux/files/home/models/Bonsai-27B-Q1_0.gguf';
const rt=fresh();
const p=rt.models.listProviders().find(x=>x.id==='llamacpp-env');
assert.ok(p,'llamacpp-env provider seeded from JACO_LLAMACPP_URL');
assert.equal(p.protocol,'openai-chat');assert.equal(p.baseUrl,'http://127.0.0.1:9380/v1');
assert.equal(p.model,'Bonsai-27B-Q1_0');assert.equal(p.local,true);
assert.ok(rt.providers.candidates({requiredCapabilities:['reasoning'],prompt:'x'}).some(c=>c.provider.id==='llamacpp-env'),'eligible for reasoning work');

delete process.env.JACO_LLAMACPP_URL;delete process.env.JACO_LLAMACPP_MODEL;
assert.equal(fresh().models.listProviders().some(x=>x.id==='llamacpp-env'),false,'not seeded without JACO_LLAMACPP_URL');
console.log('LLAMACPP_PROVIDER: PASS');process.exit(0);
