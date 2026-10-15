import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// One installation key, outside Git. This protects database content without its
// key; it does not protect a compromised host or provide transport end-to-end encryption.
export function privateContent(stateDir) {
  const file = path.join(stateDir, 'content.key');
  if (!fs.existsSync(file)) {
    // Never silently generate a replacement for an existing encrypted database.
    if (fs.existsSync(path.join(stateDir, 'content.encrypted'))) throw Error('WORKPLACE_CONTENT_KEY_MISSING');
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, crypto.randomBytes(32)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
    }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw Error('WORKPLACE_CONTENT_KEY_INVALID');
  const prefix = 'jacoenc1:';
  return {
    seal(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return prefix + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    open(value) {
      if (typeof value !== 'string' || !value.startsWith(prefix)) return value;
      try {
        const data = Buffer.from(value.slice(prefix.length), 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
        decipher.setAuthTag(data.subarray(12, 28));
        return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
      } catch { throw Error('WORKPLACE_CONTENT_AUTHENTICATION_FAILED'); }
    },
    encrypted: value => typeof value === 'string' && value.startsWith(prefix),
  };
}
