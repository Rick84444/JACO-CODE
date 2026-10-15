import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { normalizeWmiRequest, windowsWmiRead, WINDOWS_WMI_QUERIES } from '../../agents/lib/windows-wmi-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('WMI query surface is fixed and rejects arbitrary WQL/PowerShell', () => {
  assert.deepEqual(WINDOWS_WMI_QUERIES, [
    'system','computer','cpu','memory','disks','network','processes','services'
  ]);
  assert.deepEqual(normalizeWmiRequest({ query:'processes', limit:999 }), { query:'processes', limit:200 });
  assert.throws(() => normalizeWmiRequest({ query:'SELECT * FROM Win32_Process' }), /WINDOWS_WMI_QUERY_UNSUPPORTED/);
  assert.throws(() => normalizeWmiRequest({ query:'powershell' }), /WINDOWS_WMI_QUERY_UNSUPPORTED/);
});

test('WMI reader fails closed on non-Windows hosts', async () => {
  const result = await windowsWmiRead({ query:'system' }, { platform:'linux' });
  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
  assert.equal(result.error, 'WINDOWS_WMI_UNAVAILABLE_ON_THIS_HOST');
});

test('WMI reader invokes only the packaged fixed PowerShell bridge and parses verified JSON', async () => {
  let invocation = null;
  const spawnImpl = (exe, args, options) => {
    invocation = { exe, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end(JSON.stringify({
        schema:'jaco.windows-wmi-read/v1',
        ok:true,
        verified:true,
        observed:true,
        source:'windows-cim',
        query:'cpu',
        count:1,
        observedAt:'2026-09-19T00:00:00.000Z',
        host:'TEST-PC',
        data:[{ DeviceID:'CPU0', Name:'CPU' }]
      }));
      child.emit('exit', 0, null);
    });
    return child;
  };

  const result = await windowsWmiRead({ query:'cpu', limit:5 }, {
    platform:'win32',
    spawnImpl,
    scriptPath:'C:\\JACO\\agents\\windows-wmi-read.ps1',
    timeoutMs:2000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.query, 'cpu');
  assert.equal(invocation.exe, 'powershell.exe');
  assert.deepEqual(invocation.args.slice(0,6), [
    '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File'
  ]);
  assert.equal(invocation.args.includes('-Command'), false);
  assert.equal(invocation.args.includes('cpu'), true);
  assert.equal(invocation.args.includes('5'), true);
});

test('PowerShell bridge contains CIM read allowlist and no generic execution primitive', () => {
  const src = fs.readFileSync(path.join(ROOT, 'agents', 'windows-wmi-read.ps1'), 'utf8');
  assert.match(src, /ValidateSet\('system','computer','cpu','memory','disks','network','processes','services'\)/);
  assert.match(src, /Get-CimInstance/);
  assert.doesNotMatch(src, /Invoke-Expression|Invoke-Command|Start-Process/);
  assert.doesNotMatch(src, /\[scriptblock\]|FromBase64String/);
});


test('Desktop AgentOS advertises WMI and canonical executors route it before lease', async () => {
  const agentos = fs.readFileSync(path.join(ROOT, 'agents', 'desktop-agentos.mjs'), 'utf8');
  const nova = fs.readFileSync(path.join(ROOT, 'agents', 'hands-off-agent.mjs'), 'utf8');
  const mission = fs.readFileSync(
    path.join(ROOT, 'runtime', 'src', 'server', 'connected', 'novaMissionControl.mjs'),
    'utf8'
  );
  assert.match(agentos, /windows_system_observation:\s*windows/);
  assert.match(agentos, /\.\.\.\(windows \? \['windows-wmi-read'\] : \[\]\)/);
  assert.match(agentos, /onEvents:\s*async events => recordWorkplaceEvents/);
  const {acceptNovaMission}=await import('../../agents/hands-off-agent.mjs');
  assert.equal(acceptNovaMission({metadata:{executor:'desktop-agentos'}}),false);
  assert.equal(acceptNovaMission({metadata:{executor:'nova@device'}},'nova'),false);
  assert.equal(acceptNovaMission({metadata:{executor:'nova@device'}},'nova@device'),true);
  assert.equal(acceptNovaMission({metadata:{}}),true);
  assert.match(mission, /MISSION_EXECUTOR_MISMATCH/);
  assert.match(mission, /WINDOWS_WMI_REQUIRES_DESKTOP_AGENTOS/);
});
