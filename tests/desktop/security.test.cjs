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
test('font IPC rejects child frames, other windows and remote origins', () => {
  const { trustedFontRequest } = require('../../desktop/fonts.cjs');
  const mainFrame = { url: 'fsh777://studio/index.html' }, contents = { mainFrame }, window = { webContents: contents };
  assert.equal(trustedFontRequest({ sender: contents, senderFrame: mainFrame }, window), true);
  assert.equal(trustedFontRequest({ sender: {}, senderFrame: mainFrame }, window), false);
  assert.equal(trustedFontRequest({ sender: contents, senderFrame: { url: mainFrame.url } }, window), false);
  for (const url of ['https://evil.test', 'file:///tmp/evil', 'fsh777://evil/index.html', 'fsh777://studio:3000/index.html']) { mainFrame.url = url; assert.equal(trustedFontRequest({ sender: contents, senderFrame: mainFrame }, window), false); }
});
test('desktop font catalog permits only GitHub API network access and correct font types', () => {
  assert.equal(mime('variable.ttf'), 'font/ttf'); assert.equal(mime('variable.otf'), 'font/otf');
  assert.match(CSP, /connect-src 'self' https:\/\/api\.github\.com;/);
  assert.doesNotMatch(CSP, /connect-src[^;]*\*/);
});
