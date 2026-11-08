// JacoCloud: reach your own JACO from your phone. One owner for the tunnel and the pairing of a phone.
//
// A Cloudflare quick tunnel (`cloudflared tunnel --url`) needs no account and costs nothing: it gives this
// computer a temporary public address. The address is not a way in by itself. Every request that arrives
// through it meets the remote IDE gate (ideAccess.mjs): without a signed-in device it sees only the sign-in
// page, and a device signs in with a one-time code that the operator creates on this computer and that is
// valid for 10 minutes. The address changes each time the tunnel starts; the phone is paired again then.
import { spawn as nodeSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import { tunnelHosts } from './ideAccess.mjs';

const QUICK_URL = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)\b/i;
const START_TIMEOUT_MS = 60_000;

export class QuickTunnel {
  /**
   * @param {{ spawn?: typeof nodeSpawn, env?: Record<string, string | undefined>, hosts?: Set<string>, timeoutMs?: number }} [options]
   */
  constructor({ spawn = nodeSpawn, env = process.env, hosts = tunnelHosts, timeoutMs = START_TIMEOUT_MS } = {}) {
    this.spawn = spawn; this.env = env; this.hosts = hosts; this.timeoutMs = timeoutMs;
    this.child = null; this.timer = null;
    this.state = { state: 'off', url: null, host: null, error: null, startedAt: null };
  }

  status() { return { ...this.state }; }

  // Starts the tunnel to the local IDE; resolves when Cloudflare has given the address.
  start(target) {
    if (this.child) return Promise.reject(new Error('TUNNEL_ALREADY_RUNNING'));
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(target))) return Promise.reject(new Error('TUNNEL_TARGET_MUST_BE_LOCAL'));
    const binary = String(this.env.JACO_CLOUDFLARED || 'cloudflared');
    this.state = { state: 'starting', url: null, host: null, error: null, startedAt: new Date().toISOString() };
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code) => {
        if (!settled) { settled = true; reject(new Error(code)); }
        this.#clear(); this.state = { ...this.state, state: 'error', url: null, host: null, error: code };
      };
      let child;
      try { child = this.spawn(binary, ['tunnel', '--no-autoupdate', '--url', String(target)], { shell: false, windowsHide: true }); }
      catch { return fail('CLOUDFLARED_MISSING'); }
      this.child = child;
      this.timer = setTimeout(() => { this.stop(); fail('TUNNEL_START_TIMEOUT'); }, this.timeoutMs);
      const look = chunk => {
        const match = QUICK_URL.exec(String(chunk));
        if (!match || this.state.state === 'on') return;
        clearTimeout(this.timer); this.timer = null;
        this.hosts.add(match[1].toLowerCase());
        this.state = { ...this.state, state: 'on', url: `https://${match[1].toLowerCase()}`, host: match[1].toLowerCase(), error: null };
        if (!settled) { settled = true; resolve(this.status()); }
      };
      child.stdout?.on('data', look); child.stderr?.on('data', look);
      child.on('error', error => fail(error?.code === 'ENOENT' ? 'CLOUDFLARED_MISSING' : 'CLOUDFLARED_FAILED'));
      child.on('close', () => {
        const wasOn = this.state.state === 'on';
        this.#clear();
        if (!settled) return fail('CLOUDFLARED_EXITED');
        if (wasOn || this.state.state === 'starting') this.state = { ...this.state, state: 'off', url: null, host: null };
      });
    });
  }

  stop() {
    const child = this.child;
    this.#clear();
    if (child) { try { child.kill(); } catch { /* it already ended */ } }
    this.state = { state: 'off', url: null, host: null, error: null, startedAt: null };
  }

  #clear() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.state.host) this.hosts.delete(this.state.host);
    this.child = null;
  }
}

// A name for a phone that passes the device registry's rule (lower case, digits and dashes).
export const phoneName = () => `phone-${crypto.randomBytes(3).toString('hex')}`;

// The address the QR code opens: the sign-in page, with the one-time code in the fragment.
export const pairingLink = (url, code) => `${url}/ide-login#code=${encodeURIComponent(code)}`;
