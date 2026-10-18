'use strict';
const path = require('node:path');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://api.github.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
function resolveAsset(root, requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'fsh777:' || url.hostname !== 'studio' || url.port || url.username || url.password) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\\') || decoded.includes('\0')) return null;
    const name = decoded.replace(/^\/+/, '') || 'index.html';
    const base = path.resolve(root), target = path.resolve(base, name);
    return target.startsWith(base + path.sep) ? target : null;
  } catch { return null; }
}
function mime(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}
module.exports = { resolveAsset, mime, CSP };
