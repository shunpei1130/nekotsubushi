# 猫つぶし — Codex送信用軽量パック

**まず `AI_START_HERE.md` を読んでください。**

## 含まれる全資料
- `nekotsubushi_web_spec.md` — 仕様書全文（元PDFと同内容）
- `references/` — ゲームモード01〜06の参照画像（941×1672px、WebP形式）
- `reference_manifest.json` — 画像の対応、元PNGおよび変換後のSHA256
- `visual_anchors.json` — 参考画面の座標目安
- `visual_fixtures.json` — 画面を元画像の状態に固定するテスト用データ
- `asset_inventory.csv` — 必要素材リスト
- `AI_START_HERE.md` — AIへの作業指示

サイズを節約するため、元のZIPに含まれる重複PDF（19MB）は省略しました。仕様本文は省略していません。仕様書中の画像への相対パスはWebPへ変更済みです。

この版の画像は高画質WebP（品質97）のため、見た目は原PNGに近いですがピクセル完全一致ではありません。厳密な画素差分検証には元PNGまたはlossless版を使用してください。
