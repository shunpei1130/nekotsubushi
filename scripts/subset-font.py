"""Rebuild the local game font from the preserved Google Fonts TTF master."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
import hashlib, json

root = Path(__file__).resolve().parents[1]
master = root / 'art/MPLUSRounded1c-ExtraBold.ttf'
base = root / 'art/font-subset.txt'
text = base.read_text(encoding='utf-8')
for folder in ['src', 'tests']:
    for path in (root / folder).rglob('*'):
        if path.suffix in ['.ts', '.tsx', '.html', '.css', '.json']:
            text += path.read_text(encoding='utf-8')
text += ''.join(chr(n) for lo,hi in [(0x20,0x7f),(0xa0,0x100),(0x3000,0x3100),(0x31f0,0x3200),(0xff00,0xfff0)] for n in range(lo,hi))
font = TTFont(master)
requested = set(ord(c) for c in text)
supported = set(font.getBestCmap())
options = subset.Options()
options.flavor = 'woff2'
options.hinting = False
options.layout_features = ['*']
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=requested & supported)
subsetter.subset(font)
font.flavor = 'woff2'
output = root / 'public/assets/mplus-rounded-800.woff2'
font.save(output)
metadata = {
  'font': 'M PLUS Rounded 1c ExtraBold',
  'weight': 800,
  'license': 'SIL Open Font License 1.1',
  'copyright': 'Copyright 2016 The Rounded M+ Project Authors.',
  'source': 'https://raw.githubusercontent.com/google/fonts/main/ofl/mplusrounded1c/MPLUSRounded1c-ExtraBold.ttf',
  'google_fonts_repository': 'https://github.com/google/fonts/tree/main/ofl/mplusrounded1c',
  'upstream_master_sha256': hashlib.sha256(master.read_bytes()).hexdigest(),
  'subset_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
  'size_bytes': output.stat().st_size,
  'character_count': len(requested & supported),
  'coverage': 'All characters in original specification data and current app/test sources; ASCII, Latin-1, hiragana, katakana, Japanese punctuation, and fullwidth/halfwidth forms supported by the master.',
  'rebuild': 'python scripts/subset-font.py (requires fonttools and brotli)'
}
(root / 'art/FONT-SOURCE.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({k:metadata[k] for k in ['size_bytes','character_count','subset_sha256']},indent=2))
