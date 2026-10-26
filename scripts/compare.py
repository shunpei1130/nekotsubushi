#!/usr/bin/env python3
"""Compare captured game stages with the immutable supplied visual references.

Run from any directory:
    python scripts/compare.py

Pixel metrics describe composition/color differences; they are not a visual
quality pass/fail. Generated assets and dynamic typography require human review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
REFERENCE_NAMES = {
    1: "01_neko_tsuntun.webp",
    2: "02_hako_zurase.webp",
    3: "03_neko_punch.webp",
    4: "04_boushi.webp",
    5: "05_hoppe.webp",
    6: "06_nekojyarashi.webp",
}
CREAM = (255, 243, 218)
BROWN = (74, 37, 20)


def font(size: int) -> ImageFont.ImageFont:
    for name in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ):
        if Path(name).is_file():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def opaque(image: Image.Image) -> Image.Image:
    rgba = ImageOps.exif_transpose(image).convert("RGBA")
    background = Image.new("RGBA", rgba.size, CREAM + (255,))
    return Image.alpha_composite(background, rgba).convert("RGB")


def fit_actual(image: Image.Image, size: tuple[int, int]) -> tuple[Image.Image, dict[str, Any]]:
    """Preserve aspect ratio if a noncanonical capture is supplied, and report it."""
    original_size = image.size
    if original_size == size:
        return image, {"resized": False, "original_size": list(original_size)}
    fitted = ImageOps.contain(image, size, Image.Resampling.LANCZOS)
    result = Image.new("RGB", size, CREAM)
    offset = ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2)
    result.paste(fitted, offset)
    return result, {
        "resized": True,
        "original_size": list(original_size),
        "fitted_size": list(fitted.size),
        "offset": list(offset),
        "method": "aspect-preserving contain with cream letterboxing",
    }


def gaussian_blur_valid(array: np.ndarray) -> np.ndarray:
    """11x11 Gaussian, sigma=1.5, valid border; no optional package required."""
    x = np.arange(-5, 6, dtype=np.float32)
    weights = np.exp(-(x * x) / (2 * 1.5 * 1.5))
    weights /= weights.sum()
    rows = np.lib.stride_tricks.sliding_window_view(array, 11, axis=0)
    rows = np.einsum("ijk,k->ij", rows, weights, optimize=True)
    columns = np.lib.stride_tricks.sliding_window_view(rows, 11, axis=1)
    return np.einsum("ijk,k->ij", columns, weights, optimize=True)


def ssim_luminance(reference: np.ndarray, actual: np.ndarray) -> float:
    """SSIM on Rec.601 luminance, range 255, population covariance.

    Uses a standard 11x11 Gaussian window (sigma 1.5), K1=.01, K2=.03.
    Border pixels without a full window are excluded.
    """
    luminance = np.array([0.299, 0.587, 0.114], dtype=np.float32)
    a = reference @ luminance
    b = actual @ luminance
    mean_a = gaussian_blur_valid(a)
    mean_b = gaussian_blur_valid(b)
    variance_a = np.maximum(gaussian_blur_valid(a * a) - mean_a * mean_a, 0)
    variance_b = np.maximum(gaussian_blur_valid(b * b) - mean_b * mean_b, 0)
    covariance = gaussian_blur_valid(a * b) - mean_a * mean_b
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    value = ((2 * mean_a * mean_b + c1) * (2 * covariance + c2)) / (
        (mean_a * mean_a + mean_b * mean_b + c1) * (variance_a + variance_b + c2)
    )
    return float(np.mean(value, dtype=np.float64))


def metrics(reference: Image.Image, actual: Image.Image) -> dict[str, Any]:
    a = np.asarray(reference, dtype=np.float32)
    b = np.asarray(actual, dtype=np.float32)
    delta = a - b
    mae = float(np.mean(np.abs(delta), dtype=np.float64))
    rmse = math.sqrt(float(np.mean(delta * delta, dtype=np.float64)))
    return {
        "mae_rgb_0_255": round(mae, 5),
        "rmse_rgb_0_255": round(rmse, 5),
        "ssim_luminance": round(ssim_luminance(a, b), 7),
    }


def comparison(reference: Image.Image, actual: Image.Image, mode: int) -> Image.Image:
    header = 48
    width, height = reference.size
    result = Image.new("RGB", (width * 2 + 8, height + header), CREAM)
    draw = ImageDraw.Draw(result)
    draw.text((18, 9), f"Mode {mode:02d}  |  Reference", fill=BROWN, font=font(23))
    draw.text((width + 26, 9), f"Mode {mode:02d}  |  Implementation", fill=BROWN, font=font(23))
    result.paste(reference, (0, header))
    result.paste(actual, (width + 8, header))
    return result


def overview(pairs: list[tuple[int, Image.Image, Image.Image, dict[str, Any]]]) -> Image.Image:
    thumb_width = 235
    thumb_height = round(thumb_width * 1672 / 941)
    cell_width = thumb_width * 2 + 8
    cell_height = thumb_height + 74
    margin, gap = 18, 20
    canvas = Image.new("RGB", (margin * 2 + cell_width * 3 + gap * 2, margin * 2 + cell_height * 2 + gap), CREAM)
    draw = ImageDraw.Draw(canvas)
    for index, (mode, reference, actual, value) in enumerate(pairs):
        x = margin + (index % 3) * (cell_width + gap)
        y = margin + (index // 3) * (cell_height + gap)
        draw.text((x, y), f"Mode {mode:02d}", fill=BROWN, font=font(19))
        draw.text((x, y + 25), "Reference", fill=BROWN, font=font(15))
        draw.text((x + thumb_width + 8, y + 25), "Implementation", fill=BROWN, font=font(15))
        canvas.paste(reference.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS), (x, y + 49))
        canvas.paste(actual.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS), (x + thumb_width + 8, y + 49))
        draw.text((x, y + 52 + thumb_height), f"MAE {value['mae_rgb_0_255']:.1f} | RMSE {value['rmse_rgb_0_255']:.1f} | SSIM {value['ssim_luminance']:.3f}", fill=BROWN, font=font(13))
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, default=ROOT / "docs" / "references")
    parser.add_argument("--artifacts", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--diff-gain", type=float, default=3.0)
    args = parser.parse_args()
    if not math.isfinite(args.diff_gain) or args.diff_gain <= 0:
        parser.error("--diff-gain must be a positive finite number")
    args.artifacts.mkdir(parents=True, exist_ok=True)
    missing = [str(args.artifacts / f"actual-{mode:02d}.png") for mode in REFERENCE_NAMES if not (args.artifacts / f"actual-{mode:02d}.png").is_file()]
    missing += [str(args.references / name) for name in REFERENCE_NAMES.values() if not (args.references / name).is_file()]
    if missing:
        print(json.dumps({"status": "waiting_for_inputs", "missing": missing}, ensure_ascii=False, indent=2))
        return 2

    report: dict[str, Any] = {
        "status": "generated",
        "metric_interpretation": "Descriptive image differences only. No automatic quality threshold or pass/fail. Perceptual likeness, character identity, fur, composition and animation require visual review.",
        "ssim_definition": "Rec.601 luminance, 11x11 Gaussian window sigma=1.5, K1=.01, K2=.03, data range=255, population covariance, valid border",
        "diff_gain": args.diff_gain,
        "modes": {},
    }
    pairs = []
    for mode, name in REFERENCE_NAMES.items():
        reference_path = args.references / name
        actual_path = args.artifacts / f"actual-{mode:02d}.png"
        before_hash = digest(reference_path)
        with Image.open(reference_path) as image:
            reference = opaque(image)
        with Image.open(actual_path) as image:
            actual, normalization = fit_actual(opaque(image), reference.size)
        value = metrics(reference, actual)
        filenames = {
            "comparison": f"comparison-{mode:02d}.jpg",
            "overlay": f"overlay-{mode:02d}.png",
            "diff": f"diff-{mode:02d}.png",
        }
        comparison(reference, actual, mode).save(args.artifacts / filenames["comparison"], quality=94, subsampling=0)
        Image.blend(reference, actual, 0.5).save(args.artifacts / filenames["overlay"])
        ImageChops.difference(reference, actual).point(lambda n: min(255, round(n * args.diff_gain))).save(args.artifacts / filenames["diff"])
        assert digest(reference_path) == before_hash, "Reference unexpectedly changed"
        report["modes"][f"{mode:02d}"] = {
            "reference": str(reference_path),
            "reference_sha256": before_hash,
            "actual": str(actual_path),
            "actual_sha256": digest(actual_path),
            "comparison_size": list(reference.size),
            "actual_normalization": normalization,
            **value,
            "artifacts": filenames,
        }
        pairs.append((mode, reference, actual, value))
        print(f"Mode {mode:02d}: MAE={value['mae_rgb_0_255']:.3f} RMSE={value['rmse_rgb_0_255']:.3f} SSIM={value['ssim_luminance']:.5f}")

    overview(pairs).save(args.artifacts / "overview.jpg", quality=94, subsampling=0)
    report["overview"] = "overview.jpg"
    (args.artifacts / "comparison-metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved comparisons, overlays, diffs, overview and metrics in {args.artifacts}")
    print("Visual review required; metrics do not establish a quality pass.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
