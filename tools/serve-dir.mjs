// node tools/serve-dir.mjs <folder> <port>   serves the files of one folder on 127.0.0.1 (for checking the installers
// against a real build before it is published). Prints "ready <url>" when listening.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 0);
const types = { '.json': 'application/json', '.zip': 'application/zip', '.sh': 'text/plain', '.ps1': 'text/plain', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.resolve(dir, name);
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`ready http://127.0.0.1:${server.address().port}\n`));
