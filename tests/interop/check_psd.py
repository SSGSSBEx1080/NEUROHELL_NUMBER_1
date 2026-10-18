"""Independent PSD checks, deliberately not ag-psd round-tripping its own data.

Run after the complete browser suite: .venv/bin/python tests/interop/check_psd.py
This does NOT substitute for testing XnConvert or Adobe Photoshop.
"""
from pathlib import Path
from io import BytesIO

import numpy as np
from PIL import Image, ImageFilter
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

# Native vectors are now genuinely redrawn by aggdraw, unlike the old pixel-only shape cache.
# Keep the original raster-mask <=2/255 contract above. For vector masks, allow different
# AA only within a two-pixel geometric edge band derived from the UNMASKED native cache;
# painted holes/density/feather and all other interior pixels still have the exact <=2 bound.
for transform in ["rotated", "flipped", "perspective", "rotated-disabled", "rotated-soft"]:
    document = PSDImage.open(RESULTS / f"native-vector-mask-{transform}.psd")
    reference = premultiplied(Image.open(RESULTS / f"native-vector-mask-{transform}.png"))
    layer = document[0]
    assert layer.kind == "shape" and layer.vector_mask and layer.has_mask()
    assert float(np.abs(premultiplied(document.topil()) - reference).max()) <= 2
    native = premultiplied(document.composite(ignore_preview=True, force=True, apply_icc=False))
    delta = np.abs(native - reference)
    plane = Image.new("L", document.size, 0)
    plane.paste(layer.topil().getchannel("A"), layer.offset)
    # Threshold the coverage silhouette: tiny perspective-mesh alpha variation inside is NOT an edge exemption.
    plane = plane.point(lambda value: 255 if value >= 128 else 0)
    outside = np.asarray(plane.filter(ImageFilter.MaxFilter(5)))
    inside = np.asarray(plane.filter(ImageFilter.MinFilter(5)))
    edge = outside != inside
    assert float(edge.mean()) < .1, (transform, "edge band too broad")
    assert float(delta[~edge].max()) <= 2.0, (transform, "vector mask interior", float(delta[~edge].max()))
    assert float(delta.mean()) < .7, (transform, "vector mask mean", float(delta.mean()))
    print(f"PASS vector {transform}: native ShapeLayer + raster mask, interior max {delta[~edge].max():.4f}/255; edge-AA mean {delta.mean():.6f}/255")

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


for fixture in ["native-point", "native-text-transforms"]:
    document = PSDImage.open(RESULTS / f"{fixture}.psd")
    reference = premultiplied(Image.open(RESULTS / f"{fixture}.png"))
    types = [layer for layer in document.descendants() if layer.kind == "type"]
    assert len(types) == (1 if fixture == "native-point" else 3)
    if fixture == "native-point":
        assert types[0].text == "Редактор 777"
        assert types[0].width > 400, "Point type's native raster cache must not clip to its old 22px box"
    else:
        smart = [layer for layer in document.descendants() if layer.kind == "smartobject"]
        assert len(smart) == 2
        for layer in smart:
            assert layer.smart_object.kind == "data"
            nested = PSDImage.open(BytesIO(layer.smart_object.data))
            assert nested[0].kind == "type" and nested[0].text == "Текст 777"
    for source, image in [("merged", document.topil()), ("native layers", document.composite(ignore_preview=True, force=True, apply_icc=False))]:
        delta = np.abs(premultiplied(image) - reference)
        assert float(delta.max()) <= 2.0, (fixture, source, float(delta.max()))
        print(f"PASS {fixture}, {source}: max premultiplied RGBA error {delta.max():.4f}/255; native type and editable embedded PSD verified")

document = PSDImage.open(RESULTS / "native-warped-paint.psd")
reference = premultiplied(Image.open(RESULTS / "native-warped-paint.png"))
assert len(document) == 3 and all(layer.kind == "smartobject" for layer in document)
contents = {layer.name: PSDImage.open(BytesIO(layer.smart_object.data)) for layer in document}
assert contents["Warped stroke"][0].kind == "shape"
assert contents["Warped effects"][0].kind == "shape" and contents["Warped effects"][0].has_mask()
assert not document[1].has_mask(), "Local mask must not be applied again outside the transformed effects"
blur = contents["Warped type FX"][0]
assert blur.kind == "smartobject"
type_contents = PSDImage.open(BytesIO(blur.smart_object.data))
assert type_contents[0].kind == "type" and type_contents[0].text == "Эффекты"
for source, image in [("merged", document.topil()), ("native layers", document.composite(ignore_preview=True, force=True, apply_icc=False))]:
    delta = np.abs(premultiplied(image) - reference)
    assert float(delta.max()) <= 2.0, ("warped editable paint", source, float(delta.max()))
    print(f"PASS warped editable paint, {source}: max premultiplied RGBA error {delta.max():.4f}/255; nested shapes/type/mask retained, no duplicate outer effects")

print("Scope: RGB/8, these eighteen fixture cases only. Type/smart-object caches are composed, not font/filter regeneration. Independent vector paths use aggdraw. No XnConvert/Photoshop execution or universal ICC/Adobe FX validation.")
