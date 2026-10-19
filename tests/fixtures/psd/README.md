# PSD interoperability fixtures

Small Photoshop-authored regression files from MIT-licensed [Agamnentzar/ag-psd](https://github.com/Agamnentzar/ag-psd), revision `04d927df87130ad6d765bc63d51ade0a98d66c14`. Original paths: `test/read-write/{group-blend,masks,effects}/src.psd`. Upstream copyright and license are in `LICENSE.ag-psd`. Used as test inputs, not bundled in the application.

## Native editability fixtures added for 0.5

`native-shapes.psd`, `native-text.psd`, `native-text-box.psd` are from the same MIT-licensed ag-psd repository, revision `04d927df87130ad6d765bc63d51ade0a98d66c14`, respectively `test/read-write/shapes/src.psd`, `test/read-write/text/src.psd`, `test/read-write/text-box/src.psd`. Original bytes, not modified. They exercise native vector masks/fills/origination and point/box text; the text fixtures reference AdobeInvisFont and do **not** provide a redistributable Adobe font. Font substitution must be reported, not hidden.
