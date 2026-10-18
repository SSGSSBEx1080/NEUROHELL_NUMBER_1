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
The text, layout and sample document are original. The UI screenshot in `docs/`
shows the running application. The ATN/PSD header test fixtures are generated
from small, original test data and do not include commercial action sets.

The ATN reader implements a bounded subset of the public ATN v16 binary layout.
It does not execute JSX, JavaScript, native plugins, external file references or
unknown commands. No third-party ATN parser source is bundled.

## Development-only tools

Vite, Vitest, TypeScript, Playwright, @sparticuz/chromium and their dependencies
are development/test dependencies. The Chromium executable is downloaded by
npm into ignored `node_modules`; it is not included in the web production bundle.
See each package's license and Chromium's notices before redistributing those
binaries in a desktop package.

An independent implementation and these notices are not legal clearance or a
guarantee against claims. Before commercial distribution, separately review the
product name, relevant trademark/patent issues, dependencies and the intended use.
