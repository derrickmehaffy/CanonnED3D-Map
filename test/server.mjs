import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Server root is Source/, not the repo root: 49 pages reference
// "/js/jquery-2.1.4.min.js" with a leading slash.
const ROOT = fileURLToPath(new URL('../Source/', import.meta.url));
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.csv': 'text/csv; charset=utf-8'
};

createServer(async (req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname;
  let pathname;
  try {
    pathname = decodeURIComponent(requested);
  } catch {
    // decodeURIComponent throws on a malformed percent-escape (e.g. a lone
    // "%"). Answer 400 instead of letting the throw become an unhandled
    // rejection in this async handler, which would crash the process.
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  // pathname always starts with "/" (it comes from URL.pathname), and
  // normalize() on an absolute path can never leave a leading ".." — there
  // is nothing above "/" to traverse to (e.g. normalize("/../etc") ===
  // "/etc"). That, plus join(ROOT, safe) and the startsWith(ROOT) check
  // below, is what keeps the resolved file inside ROOT.
  const safe = normalize(pathname);
  const file = join(ROOT, safe);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`serving Source/ on http://localhost:${PORT}`);
});
