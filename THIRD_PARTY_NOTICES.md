# Resources and licenses

ФШ 777 is an independent implementation. It does not contain Adobe source code,
icons, branding, commercial fonts, Photoshop action sets, or Adobe plugins.
Photoshop, PSD and PSB are referenced to describe interoperability; there is no
affiliation with or endorsement by Adobe.

## Runtime dependencies

- React / React DOM — MIT; https://github.com/facebook/react
- Lucide React icons — ISC; https://github.com/lucide-icons/lucide
- ag-psd — MIT; https://github.com/Agamnentzar/ag-psd
  - base64-js — MIT
  - pako — MIT and Zlib

Package license files are retained by npm under `node_modules`. Exact versions
are recorded in `package-lock.json`.

## Fonts

- Manrope — SIL Open Font License 1.1; `public/fonts/manrope-OFL.txt`
- Unbounded — SIL Open Font License 1.1; `public/fonts/unbounded-OFL.txt`

Both font files are bundled locally. The WOFF2 files were converted from the
upstream Google Fonts variable TTF files; no remote font requests are made.

## Artwork and test data

`public/demo-landscape.webp` is AI-generated artwork created for this project;
it is not Adobe/stock artwork and is not a photograph represented as real.
The text, layout and sample document are original. Any editor screenshots show the running independent application. The ATN/PSD header test fixtures are generated
from small, original test data and do not include commercial action sets.

The ATN reader implements a bounded subset of the public ATN v16 binary layout.
It does not execute JSX, JavaScript, native plugins, external file references or
unknown commands. No third-party ATN parser source is bundled.

## Development-only tools

Vite, Vitest, TypeScript, Playwright, @sparticuz/chromium and their dependencies
are development/test dependencies. The Chromium executable is downloaded by
npm into ignored `node_modules`; it is not included in the web production bundle.
See each package's license before redistributing development binaries.

## Desktop application

The distributed desktop application bundles Electron (MIT) and its Chromium/Node
runtime. electron-builder packages the upstream `LICENSE.electron.txt` and
`LICENSES.chromium.html` next to the executable; do not remove them when
redistributing the ZIP. Runtime web-package license texts are collected in
`THIRD_PARTY_LICENSES.txt`; font licenses are also included in the bundled assets.
electron-builder is a development-only packager (MIT); the NSIS installer runtime
uses the upstream NSIS licenses.

- Electron — https://github.com/electron/electron
- electron-builder — https://github.com/electron-userland/electron-builder

The scaling behavior was cross-checked against public MIT-licensed Fabric.js
`packages/core/src/canvas/CanvasOptions.ts` and `controls/scale.ts` on its master
branch. Fabric.js is not bundled and its implementation was not copied. The
projective geometry and gesture implementation here are independently written.
The public `mrijk/atn-parser` format examples were consulted as a binary-layout
reference; that parser's source and example action files are not redistributed.

An independent implementation and these notices are not legal clearance or a
guarantee against claims. Before commercial distribution, separately review the
product name, relevant trademark/patent issues, dependencies and the intended use.
