"""Independent PSD checks, deliberately not ag-psd round-tripping its own data.

Run after the complete browser suite: .venv/bin/python tests/interop/check_psd.py
This does NOT substitute for testing XnConvert or Adobe Photoshop.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage

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
    assert len(list(original.descendants())) == len(list(edited.descendants())), fixture
    print(f"PASS {fixture}: independent merged pixels exactly equal; layer count retained")

for transform in ["rotated", "flipped", "perspective"]:
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

print("Scope: RGB/8, these six fixtures only. No XnConvert/Photoshop execution, ICC conversion, or arbitrary Adobe FX validation.")
