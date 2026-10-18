"""Independent PSD checks, deliberately not ag-psd round-tripping its own data.

Run after the complete browser suite: .venv/bin/python tests/interop/check_psd.py
This does NOT substitute for testing XnConvert or Adobe Photoshop.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import Resource

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "test-results"


def premultiplied(image):
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float64).copy()
    rgba[:, :, :3] *= rgba[:, :, 3:4] / 255.0
    return rgba


for fixture in ["groups", "masks", "effects"]:
    original = PSDImage.open(ROOT / f"tests/fixtures/psd/{fixture}.psd")
    edited = PSDImage.open(RESULTS / f"exported-{fixture}.psd")
    assert np.array_equal(np.asarray(original.topil()), np.asarray(edited.topil())), fixture
    assert original.image_resources.get_data(Resource.ICC_PROFILE) == edited.image_resources.get_data(Resource.ICC_PROFILE), fixture
    assert len(list(original.descendants())) == len(list(edited.descendants())), fixture
    print(f"PASS {fixture}: independent merged pixels exactly equal; layer count retained")

for transform in ["rotated", "flipped", "perspective", "rotated-disabled", "rotated-soft"]:
    document = PSDImage.open(RESULTS / f"native-mask-{transform}.psd")
    reference = premultiplied(Image.open(RESULTS / f"native-mask-{transform}.png"))
    assert document[0].has_mask(), transform
    # Both the stored preview and a fresh composition of native layers must agree.
    for source, image in [("merged", document.topil()), ("native layers", document.composite(force=True, apply_icc=False))]:
        actual = premultiplied(image)
        assert actual.shape == reference.shape, (transform, source, actual.shape)
        delta = np.abs(actual - reference)
        worst = float(delta.max())
        assert worst <= 2.0, (transform, source, worst, int(np.count_nonzero(delta.max(axis=2) > 2)))
        print(f"PASS {transform}, {source}: max premultiplied RGBA error {worst:.4f}/255, mean {delta.mean():.6f}")

document = PSDImage.open(RESULTS / "layout-workflow.psd")
reference = premultiplied(Image.open(RESULTS / "layout-workflow.png"))
types = [layer for layer in document.descendants() if layer.kind == "type"]
assert len(types) == 2, "Layout text must remain native type layers"
assert "город уже" in types[0].text and "доставка" in types[1].text
for source, image in [("merged", document.topil()), ("native layers", document.composite(force=True, apply_icc=False))]:
    delta = np.abs(premultiplied(image) - reference)
    worst = float(delta.max())
    assert worst <= 2.0, ("layout workflow", source, worst)
    print(f"PASS layout J → typeset, {source}: max premultiplied RGBA error {worst:.4f}/255, mean {delta.mean():.6f}; two native type layers")

print("Scope: RGB/8, these nine fixtures only. No XnConvert/Photoshop execution, ICC conversion, or arbitrary Adobe FX validation.")

# Native fill/path/stroke structure, read and redrawn by a completely independent library.
# aggdraw and Canvas2D use different edge AA/cap rasterizers: do not reuse the 2/255
# pixel-cache threshold for genuinely redrawn cubic paths.
document = PSDImage.open(RESULTS / "native-vectors.psd")
reference = premultiplied(Image.open(RESULTS / "native-vectors.png"))
shapes = [layer for layer in document.descendants() if layer.kind == "shape"]
assert len(shapes) == 5
assert all(layer.vector_mask is not None for layer in shapes)
assert len(document[1]) == 2 and document[1].is_group()
assert np.array_equal(premultiplied(document.topil()), reference)
redrawn = premultiplied(document.composite(ignore_preview=True, force=True, apply_icc=False))
delta = np.abs(redrawn - reference)
assert float(delta.mean()) < .35, float(delta.mean())
assert float((delta.max(axis=2) > 2).mean()) < .015
# Broad interior samples catch orientation, missing fill and group compositing failures.
for x, y in [(100, 80), (360, 80), (120, 290), (370, 290), (20, 20)]:
    assert np.max(np.abs(redrawn[y, x] - reference[y, x])) <= 2, (x, y)
print(f"PASS native vectors: five actual ShapeLayers, groups, merged exact; independent path redraw mean {delta.mean():.6f}/255. Edge/cap rasterizers differ; not an Adobe visual-fidelity claim.")
