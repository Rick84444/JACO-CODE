// Byte-signature based image delivery for Aura's visual workspace.
// Never parse SVG or trust a filename/HTTP MIME supplied by an agent.
export function inspectWorkspaceImage(bytes, filename) {
  if (!Buffer.isBuffer(bytes)) throw new Error('WORKSPACE_IMAGE_BYTES_REQUIRED');
  if (bytes.length === 0 || bytes.length > 6_000_000) throw new Error('WORKSPACE_IMAGE_SIZE_LIMIT');
  const name=String(filename || '').toLowerCase();
  if (/\.png$/.test(name) && bytes.length >= 8 &&
      bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (/\.jpe?g$/.test(name) && bytes.length >= 3 &&
      bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return 'image/jpeg';
  if (/\.webp$/.test(name) && bytes.length >= 12 &&
      bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return 'image/webp';
  throw new Error('WORKSPACE_IMAGE_UNSUPPORTED_OR_MISMATCH');
}
