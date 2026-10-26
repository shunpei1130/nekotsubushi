#!/usr/bin/env python3
"""Reproduce the selected lossless pinch-hand asset from its preserved PNG source.

Use --check during QA to validate the existing outputs without writing any files.
"""
from __future__ import annotations
import argparse
from io import BytesIO
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
METADATA = ROOT / 'art/m05-hand-clean.json'


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Read-only pixel and byte validation')
    args = parser.parse_args()
    metadata = json.loads(METADATA.read_text(encoding='utf-8'))
    source = ROOT / metadata['source']
    master = ROOT / metadata['master']
    output = ROOT / metadata['output']
    source_data = source.read_bytes()
    if sha256(source_data) != metadata['sourceSha256']:
        raise ValueError('Pinch-hand source hash differs from the selected metadata')
    rgba = np.array(Image.open(source).convert('RGBA'))
    alpha = rgba[:, :, 3]
    alpha[alpha <= 8] = 0
    alpha[alpha >= 248] = 255
    rgba[alpha == 0, :3] = 0
    image = Image.fromarray(rgba)
    png = BytesIO()
    image.save(png, 'PNG')
    webp = BytesIO()
    # The selected asset used Pillow's default quality=80, including for lossless effort.
    image.save(webp, 'WEBP', lossless=True, quality=80, method=6, exact=True)
    png_data, webp_data = png.getvalue(), webp.getvalue()
    checks = {
        'sourceSha256': sha256(source_data),
        'dimensions': list(image.size),
        'masterPixelsIdentical': master.exists() and np.array_equal(
            np.array(Image.open(master).convert('RGBA')), rgba),
        'deliveryBytesIdentical': output.exists() and output.read_bytes() == webp_data,
        'deliveryDecodedPixelsIdentical': output.exists() and np.array_equal(
            np.array(Image.open(output).convert('RGBA')), rgba),
        'deliveryBytes': len(webp_data),
        'deliverySha256': sha256(webp_data),
        'encoder': {'format': 'WebP', 'lossless': True, 'quality': 80, 'method': 6, 'exact': True},
        'readOnly': args.check,
    }
    if args.check:
        print(json.dumps(checks, ensure_ascii=False, indent=2))
        return 0 if all(checks[k] for k in [
            'masterPixelsIdentical', 'deliveryBytesIdentical', 'deliveryDecodedPixelsIdentical']) else 1
    atomic_write(master, png_data)
    atomic_write(output, webp_data)
    metadata.update({
        'dimensions': list(image.size),
        'alphaBounds': list(image.getchannel('A').getbbox()),
        'outputBytes': len(webp_data),
        'outputSha256': sha256(webp_data),
        'encoder': checks['encoder'],
        'rebuild': 'python scripts/prepare-hand.py',
        'validate': 'python scripts/prepare-hand.py --check',
    })
    atomic_write(METADATA, (json.dumps(metadata, ensure_ascii=False, indent=2) + '\n').encode())
    print(json.dumps(checks, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
