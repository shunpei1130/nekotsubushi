"""Extract the twelve generated expression portraits; --check never writes files."""
from pathlib import Path
from PIL import Image
import argparse
import hashlib
import io
import json

root = Path(__file__).resolve().parents[1]
source = root / 'art/masters/reaction-portraits-generated.png'
manifest_path = root / 'art/reactions.json'
ids = ['cheek-right', 'cheek-left', 'cheek-up', 'cheek-down', 'cheek-inward', 'cheek-gentle',
       'streak-1', 'streak-2', 'close-3', 'rhythm-4', 'clear-6', 'personal-best']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
image = Image.open(source).convert('RGB')
w, h = image.size
items = []
for i, name in enumerate(ids):
    column, row = i % 4, i // 4
    box = (round(column*w/4), round(row*h/3), round((column+1)*w/4), round((row+1)*h/3))
    crop = image.crop(box)
    buffer = io.BytesIO()
    crop.save(buffer, 'WEBP', quality=94, method=6)
    data = buffer.getvalue()
    path = root / f'public/assets/reaction-{name}.webp'
    if args.check:
        assert path.read_bytes() == data, f'Delivery differs from generated cell: {name}'
    else:
        path.write_bytes(data)
    items.append({'id': name, 'asset': str(path.relative_to(root)), 'crop': list(box),
                  'dimensions': list(crop.size), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
manifest = {
    'source': str(source.relative_to(root)),
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'references': ['art/masters/m05-cat.png', 'art/masters/m03-body.png'],
    'method': 'image_gen reference-guided 4x3 portrait contact sheet, cell extraction only; no face warps or geometric placeholder characters. Live scenes keep original cat textures with registered original eyelid patches and bounded ear influence fields.',
    'dimensions': list(image.size), 'grid': [4, 3], 'items': items,
}
if args.check:
    assert json.loads(manifest_path.read_text()) == manifest, 'Manifest differs from generated source'
else:
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'checked' if args.check else 'prepared': len(items), 'deliveryBytes': sum(item['bytes'] for item in items)}))
