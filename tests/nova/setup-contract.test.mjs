import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from '../../scripts/setup.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-setup-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['', 'runtime', 'runtime/gateway']) {
    const location = path.join(root, dir);
    fs.mkdirSync(location, { recursive: true });
    fs.writeFileSync(path.join(location, 'package.json'), '{"name":"fixture","version":"0.0.0"}');
  }
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(root, 'runtime', 'package-lock.json'), '{}');
  return root;
}

const noLog = { log() {} };

test('setup installs all manifests then builds both canonical production artifacts', t => {
  const root = fixture(t);
  const calls = [];
  setup(root, { JACO_PIXEL_SETUP: '0' }, {
    spawn(binary, args, options) {
      calls.push({ binary, args, cwd: options.cwd });
      return { status: 0 };
    },
    logger: noLog,
  });
  assert.deepEqual(calls.map(c => [path.relative(root, c.cwd).split(path.sep).join('/'), c.args[0]]), [
    ['', 'ci'], ['runtime', 'ci'], ['runtime/gateway', 'install'],
    ['runtime', 'run'], ['runtime', 'run'],
  ]);
  assert.deepEqual(calls.slice(-2).map(c => c.args), [
    ['run', 'build:client'], ['run', 'build:server'],
  ]);
  assert(calls.every(c => c.binary === (process.platform === 'win32' ? 'npm.cmd' : 'npm')));
  const envText = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.match(envText, /^JACO_GATEWAY_TOKEN=[a-f0-9]{64}\n$/);
});

test('setup refuses a failed build and does not claim completion', t => {
  const root = fixture(t);
  let completed = false;
  assert.throws(() => setup(root, { JACO_PIXEL_SETUP: '0' }, {
    spawn(_binary, args) {
      if (args.join(' ') === 'run build:server') return { status: 9 };
      return { status: 0 };
    },
    logger: { log(message) { if (message.startsWith('Setup complete')) completed = true; } },
  }), /Production server build failed \(exit 9\)/);
  assert.equal(completed, false);
  assert.equal(fs.existsSync(path.join(root, '.env')), false);
});

test('setup preserves configured credentials and honors explicit npm executable', t => {
  const root = fixture(t);
  const token = 'a'.repeat(32);
  fs.writeFileSync(path.join(root, '.env'), `JACO_GATEWAY_TOKEN=${token}\n`, { mode: 0o600 });
  const binaries = [];
  setup(root, { JACO_PIXEL_SETUP: '0', npm_execpath: '/custom/npm-cli.js' }, {
    spawn(binary, args) {
      binaries.push({ binary, args });
      return { status: 0 };
    },
    logger: noLog,
  });
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), `JACO_GATEWAY_TOKEN=${token}\n`);
  assert(binaries.every(c => c.binary === process.execPath && c.args[0] === '/custom/npm-cli.js'));
});

test('setup reports missing package manifests before executing any commands', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'runtime/gateway/package.json'));
  const calls = [];
  assert.throws(() => setup(root, { JACO_PIXEL_SETUP: '0' }, {
    spawn(...args) { calls.push(args); return { status: 0 }; },
    logger: noLog,
  }), /SETUP_MANIFEST_MISSING:runtime\/gateway/);
  assert.equal(calls.length, 2);
});

test('Termux setup prepares native Rollup and builds Aura without desktop server bundling', t => {
  const root = fixture(t);
  const calls = [];
  setup(root, { PREFIX: '/data/data/com.termux/files/usr' }, {
    spawn(binary, args, options) {
      calls.push({ binary, args, cwd: options.cwd });
      return { status: 0 };
    },
    logger: noLog,
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[3].binary, process.execPath);
  assert.deepEqual(calls[3].args, ['scripts/ensure_rollup_native.mjs']);
  assert.equal(calls[3].cwd, path.join(root, 'runtime'));
  assert.deepEqual(calls[4].args, ['run', 'build:termux']);
  assert.equal(calls.some(c => c.args.join(' ').includes('build:server')), false);
});

test('Termux setup fails closed when native Rollup preparation fails', t => {
  const root = fixture(t);
  assert.throws(() => setup(root, { PREFIX: '/data/data/com.termux/files/usr' }, {
    spawn(_binary, args) {
      return { status: args[0] === 'scripts/ensure_rollup_native.mjs' ? 5 : 0 };
    },
    logger: noLog,
  }), /Android Rollup preparation failed \(exit 5\)/);
  assert.equal(fs.existsSync(path.join(root, '.env')), false);
});

import { pixelDebian, preparePixelBrowser, activatePixelInstallation } from '../../scripts/pixel-browser-setup.mjs';
const pixel = { platform:'linux',arch:'arm64',osRelease:'ID=debian\n' };
test('Pixel detection distinguishes Debian arm64 from Termux and ordinary CI',()=>{
  assert.equal(pixelDebian({},pixel),true);
  assert.equal(pixelDebian({TERMUX_VERSION:'x'},pixel),false);
  assert.equal(pixelDebian({JACO_PIXEL_SETUP:'0'},pixel),false);
  assert.equal(pixelDebian({}, {...pixel,arch:'x64'}),false);
});
test('Pixel installation provisions Chromium via apt and verifies actual executable',t=>{
  const root=fixture(t);const calls=[];let installed=false;
  const result=preparePixelBrowser(root,{}, {uid:1000,logger:noLog,find:()=>installed?'/usr/bin/chromium':undefined,
    spawn(binary,args){calls.push([binary,args]);if(args.includes('install'))installed=true;return {status:0};}});
  assert.deepEqual(calls,[['sudo',['apt-get','update']],['sudo',['apt-get','install','-y','chromium']],['/usr/bin/chromium',['--version']]]);
  assert.equal(result.state,'INSTALLED');
  calls.length=0;
  assert.equal(preparePixelBrowser(root,{JACO_ENABLE_CDP:'0'},{spawn(){throw Error('unexpected install');}}).state,'DISABLED');
  assert.equal(preparePixelBrowser(root,{},{uid:1000,logger:noLog,find:()=>undefined,spawn:()=>({status:1})}).state,'UNAVAILABLE');
});
test('Pixel setup generates internal credentials before canonical activation and preserves .env settings',t=>{
  const root=fixture(t),calls=[];
  fs.writeFileSync(path.join(root,'.env'),'JACO_ENABLE_CDP=0\n');
  setup(root,{}, {system:pixel,logger:noLog,
    spawn(_binary,args){calls.push(args.join(' '));return {status:0};},
    pixelBrowser(_root,env){assert.equal(env.JACO_ENABLE_CDP,'0');assert.ok(env.JACO_GATEWAY_TOKEN.length>=24);calls.push('browser');return {state:'DISABLED'};},
    pixelActivate(_root,env){assert.equal(env.JACO_ENABLE_CDP,'0');calls.push('activate');return {state:'READY',browser:'DISABLED'};}});
  assert.deepEqual(calls.slice(-4),['run build:client','run build:server','browser','activate']);
});
test('activation accepts only fresh canonical receipt from its own process and reports CDP truth',t=>{
  const root=fixture(t),start=Date.now(),pid=123;
  const receipt={schema:'jaco.local-startup/v1',runId:pid+'-'+start,startedAt:new Date(start).toISOString(),phase:'complete',state:'DEGRADED',browserAttachment:'UNAVAILABLE',
    services:['runtime','workplace','seer','nova'].map(id=>({id,state:'READY',url:'http://127.0.0.1:3000/api/runtime/identity'}))};
  const options={spawn:()=>({pid,status:1}),now:()=>start,logger:noLog,read:()=>JSON.stringify(receipt)};
  assert.deepEqual(activatePixelInstallation(root,{},options),{state:'DEGRADED',browser:'UNAVAILABLE'});
  receipt.runId='456-'+start;
  assert.equal(activatePixelInstallation(root,{},options).state,'BLOCKED');
});
