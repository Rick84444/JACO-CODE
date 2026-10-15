import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';

const DEFAULT_BRIDGE = process.env.JACO_ANDROID_BRIDGE_URL || 'http://127.0.0.1:4311';
const PAIR_TTL_MS = 5 * 60_000;
const ALLOWED_EXECUTABLES = new Set([
  'termux-battery-status','termux-sensor','termux-torch','termux-vibrate','termux-tts-speak',
  'free','uname','getprop','pwd','ls','git','node','npm','ollama','python','python3'
]);

interface PairChallenge { codeHash: string; deviceId: string; expiresAt: number; used: boolean; }
const pairChallenges = new Map<string, PairChallenge>();
const bridgeTokens = new Map<string, { deviceId: string; expiresAt: number }>();

function timingSafeTextEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function hash(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
function isTermux(): boolean { return Boolean(process.env.PREFIX?.includes('com.termux') || process.env.TERMUX_VERSION); }
function splitCommand(command: string): { executable: string; args: string[] } {
  const trimmed = String(command || '').trim();
  if (!trimmed) throw new Error('command is required');
  if (/[;&|`$><\n\r]/.test(trimmed)) throw new Error('shell operators are not allowed');
  const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const executable = parts.shift()?.replace(/^['"]|['"]$/g, '') || '';
  const args = parts.map(v => v.replace(/^['"]|['"]$/g, ''));
  if (!ALLOWED_EXECUTABLES.has(executable)) throw new Error(`executable not allowed: ${executable}`);
  return { executable, args };
}
async function localExec(command: string) {
  const { executable, args } = splitCommand(command);
  return await new Promise<{ success:boolean; output:string; exitCode:number|null }>((resolve) => {
    const child = spawn(executable, args, { shell: false, timeout: 15_000 });
    let out = '';
    child.stdout.on('data', d => out += d.toString()); child.stderr.on('data', d => out += d.toString());
    child.on('error', e => resolve({ success:false, output:e.message, exitCode:null }));
    child.on('close', code => resolve({ success:code===0, output:out.trim(), exitCode:code }));
  });
}

export function beginPairing(deviceId = 'android-termux') {
  const pairingId = crypto.randomUUID();
  const code = crypto.randomInt(100000, 1000000).toString();
  pairChallenges.set(pairingId, { codeHash: hash(code), deviceId: String(deviceId), expiresAt: Date.now()+PAIR_TTL_MS, used:false });
  return { pairingId, pairingCode: code, expiresSec: PAIR_TTL_MS/1000 };
}
export function verifyPairing(pairingId: string, code: string) {
  const challenge = pairChallenges.get(String(pairingId));
  if (!challenge || challenge.used || Date.now() > challenge.expiresAt) return { verified:false as const, error:'pairing challenge invalid or expired' };
  if (!timingSafeTextEqual(challenge.codeHash, hash(String(code)))) return { verified:false as const, error:'pairing code mismatch' };
  challenge.used = true;
  const token = crypto.randomBytes(32).toString('base64url');
  bridgeTokens.set(hash(token), { deviceId: challenge.deviceId, expiresAt: Date.now()+24*60*60_000 });
  return { verified:true as const, token, deviceId:challenge.deviceId, expiresSec:86400 };
}
export function verifyBridgeToken(token: string): boolean {
  const record = bridgeTokens.get(hash(String(token||'')));
  return Boolean(record && record.expiresAt > Date.now());
}
export async function bridgeStatus() {
  const started = Date.now();
  try {
    const r = await fetch(`${DEFAULT_BRIDGE}/status`, { signal: AbortSignal.timeout(1200), redirect:'error' });
    return { reachable:r.ok, status:r.status, latencyMs:Date.now()-started, url:DEFAULT_BRIDGE, localTermux:isTermux(), hostname:os.hostname() };
  } catch (e:any) {
    return { reachable:false, status:null, latencyMs:Date.now()-started, url:DEFAULT_BRIDGE, localTermux:isTermux(), hostname:os.hostname(), error:String(e?.message||e) };
  }
}
export async function executeAndroidCommand(command: string, token?: string) {
  splitCommand(command); // validate before local or relay
  if (isTermux()) return { ...(await localExec(command)), transport:'DIRECT_TERMUX' as const };
  const headers:Record<string,string> = {'content-type':'application/json'};
  const relayToken = process.env.JACO_ANDROID_BRIDGE_TOKEN || token;
  if (relayToken) headers.authorization = `Bearer ${relayToken}`;
  try {
    const r = await fetch(`${DEFAULT_BRIDGE}/execute`, { method:'POST', headers, body:JSON.stringify({command}), signal:AbortSignal.timeout(4000), redirect:'error' });
    const text = await r.text();
    let body:any; try { body=JSON.parse(text); } catch { body={output:text}; }
    if (!r.ok || body?.success === false) return { success:false, output:String(body?.error||body?.output||`bridge HTTP ${r.status}`), exitCode:body?.exitCode??null, transport:'ANDROID_RELAY' as const };
    return { success:true, output:body?.output??body, exitCode:body?.exitCode??0, transport:'ANDROID_RELAY' as const };
  } catch (e:any) {
    return { success:false, output:`Android bridge unavailable: ${String(e?.message||e)}`, exitCode:null, transport:'UNAVAILABLE' as const };
  }
}
export const ANDROID_PROXY_PORTS = new Set([11434,4311,3218,8080,1234,8000,8686,9379]);
