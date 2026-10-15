// Renders a QR code string (the WhatsApp link code) as an SVG, with the QR encoder that qrcode-terminal already
// ships, so the IDE can show the code to scan without a new dependency or a canvas in the browser.
const ERROR_LEVEL_L = 1;

export async function qrModules(text, { load = () => import('qrcode-terminal/vendor/QRCode/index.js') } = {}) {
  const input = String(text ?? '');
  if (!input) throw new Error('QR_TEXT_REQUIRED');
  const loaded = await load();
  const QRCode = loaded.default ?? loaded;
  const qr = new QRCode(-1, ERROR_LEVEL_L);
  qr.addData(input);
  qr.make();
  const size = qr.getModuleCount();
  const rows = [];
  for (let row = 0; row < size; row += 1) {
    const cells = [];
    for (let col = 0; col < size; col += 1) cells.push(Boolean(qr.isDark(row, col)));
    rows.push(cells);
  }
  return rows;
}

export function qrSvgFromModules(rows, { margin = 4 } = {}) {
  const size = rows.length;
  const total = size + margin * 2;
  const path = [];
  rows.forEach((cells, y) => {
    let x = 0;
    while (x < size) {
      if (!cells[x]) { x += 1; continue; }
      let end = x;
      while (end < size && cells[end]) end += 1;
      path.push(`M${x + margin} ${y + margin}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="WhatsApp QR-kod"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path.join('')}" fill="#000"/></svg>`;
}

export async function qrSvg(text, options) {
  return qrSvgFromModules(await qrModules(text, options), options);
}
