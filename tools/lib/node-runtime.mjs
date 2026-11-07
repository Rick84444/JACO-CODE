// The official Node.js for Windows, so the Windows download starts without anything installed first. A beginner who
// had to install Node.js before JACO would start stopped at the first step (operator 2026-11-07).
//
// Downloaded from nodejs.org, checked against nodejs.org's SHASUMS256.txt, and cached so a rebuild does not download
// again. Only node.exe is taken from the archive: JACO Lite needs the runtime, not npm.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readZip } from './zip.mjs';

export const NODE_DIST_URL = 'https://nodejs.org/dist/latest-v24.x';

export async function windowsNode({ cacheDir, distUrl = NODE_DIST_URL, fetchImpl = fetch, log = () => {} } = {}) {
  const sums = await (await fetchImpl(`${distUrl}/SHASUMS256.txt`)).text();
  const line = sums.split('\n').find(l => /\snode-v[\d.]+-win-x64\.zip$/.test(l.trim()));
  if (!line) throw new Error('NODE_WINDOWS_ZIP_NOT_LISTED');
  const [sha256, file] = line.trim().split(/\s+/);
  const version = /node-(v[\d.]+)-win-x64\.zip/.exec(file)[1];
  fs.mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, file);
  let zip = fs.existsSync(cached) ? fs.readFileSync(cached) : null;
  if (!zip || crypto.createHash('sha256').update(zip).digest('hex') !== sha256) {
    log(`downloading Node.js ${version} for Windows`);
    const response = await fetchImpl(`${distUrl}/${file}`);
    if (!response.ok) throw new Error(`NODE_DOWNLOAD_FAILED_${response.status}`);
    zip = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(zip).digest('hex') !== sha256) throw new Error('NODE_CHECKSUM_MISMATCH');
    fs.writeFileSync(cached, zip);
  }
  const exe = readZip(zip).find(e => e.name === `node-${version}-win-x64/node.exe`);
  if (!exe) throw new Error('NODE_EXE_NOT_IN_ARCHIVE');
  const licence = readZip(zip).find(e => e.name === `node-${version}-win-x64/LICENSE`);
  return { version, sha256, exe: exe.data, licence: licence?.data || null };
}
