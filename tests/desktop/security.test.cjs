const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { resolveAsset, mime, CSP } = require('../../desktop/security.cjs');
test('desktop protocol only serves packaged app files', () => {
  const root = path.resolve('dist');
  assert.equal(resolveAsset(root, 'fsh777://studio/assets/main.js'), path.join(root, 'assets', 'main.js'));
  for (const url of ['https://evil.com', 'file:///etc/passwd', 'fsh777://evil/index.html', 'fsh777://studio/%2e%2e%2fsecret.txt', 'fsh777://studio/%5c..%5csecret', 'fsh777://studio/%00']) assert.equal(resolveAsset(root, url), null);
});
test('worker JavaScript and fonts have correct MIME types, CSP disallows remote scripts', () => {
  assert.match(mime('pixel.worker.js'), /javascript/); assert.equal(mime('manrope.woff2'), 'font/woff2');
  assert.match(CSP, /script-src 'self';/); assert.doesNotMatch(CSP, /unsafe-eval/);
});
