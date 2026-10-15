// A small zip writer with no dependencies, for the JACO Lite download (tools/build-lite.mjs).
// Deflate-compressed entries, UTF-8 names, unix modes (so start.sh stays executable), no zip64: the
// archive must stay under 4 GB and 65 535 entries, otherwise it refuses instead of writing a broken file.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time, local time, the format zip stores.
export function dosDateTime(date = new Date()) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

/**
 * @param {Array<{ name: string, data: Buffer | string, mode?: number }>} entries  names use "/" and are relative
 * @param {{ date?: Date }} [options]  one timestamp for every entry (the build time)
 * @returns {Buffer}
 */
export function createZip(entries, { date = new Date() } = {}) {
  if (entries.length > 0xfffe) throw new Error('ZIP_TOO_MANY_ENTRIES');
  const { time, date: day } = dosDateTime(date);
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = String(entry.name);
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error(`ZIP_NAME_INVALID:${name}`);
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const deflated = data.length > 0 ? zlib.deflateRawSync(data, { level: 9 }) : Buffer.alloc(0);
    // Stored when deflate does not help (already compressed files) and for empty files.
    const useDeflate = deflated.length > 0 && deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    if (data.length > 0xffffffff || offset + body.length > 0xfffffff0) throw new Error('ZIP_TOO_LARGE');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, nameBuf, body);

    const mode = (entry.mode ?? 0o644) & 0o7777;
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, spec 2.0
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); // regular file + permissions
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += header.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

// Reads a zip back (central directory), for tests and for the build's own self-check.
export function readZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIP_NO_END_RECORD');
  const count = buffer.readUInt16LE(end + 10);
  let p = buffer.readUInt32LE(end + 16);
  const out = [];
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP_BAD_CENTRAL_RECORD');
    const method = buffer.readUInt16LE(p + 10);
    const crc = buffer.readUInt32LE(p + 16);
    const csize = buffer.readUInt32LE(p + 20);
    const usize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const attrs = buffer.readUInt32LE(p + 38);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (data.length !== usize) throw new Error(`ZIP_SIZE_MISMATCH:${name}`);
    if (crc32(data) !== crc) throw new Error(`ZIP_CRC_MISMATCH:${name}`);
    out.push({ name, data, mode: (attrs >>> 16) & 0o7777, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
