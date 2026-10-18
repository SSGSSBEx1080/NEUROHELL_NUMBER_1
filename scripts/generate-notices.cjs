'use strict';
const fs = require('node:fs');
const packages = ['react', 'react-dom', 'lucide-react', 'ag-psd', 'base64-js', 'pako'];
let text = 'FSH 777 runtime dependency licenses\n\n';
for (const name of packages) {
  const root = `node_modules/${name}`, pkg = JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8'));
  const file = fs.readdirSync(root).find(f => /^license(\.txt|\.md)?$/i.test(f));
  if (!file) throw new Error(`Missing license: ${name}`);
  text += `${'='.repeat(72)}\n${name} ${pkg.version}\n${'='.repeat(72)}\n${fs.readFileSync(`${root}/${file}`, 'utf8')}\n\n`;
}
fs.writeFileSync('THIRD_PARTY_LICENSES.txt', text.trimEnd() + '\n');
