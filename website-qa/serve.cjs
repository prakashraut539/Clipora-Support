/* Local preview with the same clean HTML URLs as the production host. */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, 'dist');
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.xml':'application/xml; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.ttf':'font/ttf', '.woff2':'font/woff2', '.mp4':'video/mp4', '.vtt':'text/vtt; charset=utf-8', '.zip':'application/zip' };
const port = Number(process.env.PORT || 8766);
http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}).end(); return; }
  let url, pathname;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400).end(); return; }
  const requested = path.resolve(root, '.' + pathname);
  if (requested !== root && !requested.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  let clean = pathname;
  if (clean === '/index.html') clean = '/';
  else if (clean.endsWith('.html') && fs.existsSync(requested)) clean = clean.slice(0, -5);
  else if (clean.endsWith('/') && clean !== '/' && fs.existsSync(path.resolve(root, '.' + clean.slice(0, -1)) + '.html')) clean = clean.slice(0, -1);
  if (clean !== pathname) { res.writeHead(307, {Location:clean + url.search}).end(); return; }
  let file = pathname === '/' ? path.join(root, 'index.html') : requested;
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  let status = 200;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { file = path.join(root, '404.html'); status = 404; }
  const bytes = fs.readFileSync(file);
  res.writeHead(status, {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Content-Length':bytes.length, 'Cache-Control':'no-store'});
  res.end(req.method === 'HEAD' ? undefined : bytes);
}).listen(port, '127.0.0.1', () => console.log(`Clipora preview: http://127.0.0.1:${port}`));
