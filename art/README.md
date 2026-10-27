# 猫つぶし 素材の正本と再生成

配信素材は `public/assets/`、編集・再生成の正本は `art/masters/` に保存する。PNGマスターは完全版ZIPに含まれる。通常のゲーム起動・ビルドにPNGマスターや画像生成APIは不要。

原画は `docs/references/` と `docs/spec/reference_manifest.json` で識別する。参照原画を上書きしない。選択済みの05通常顔は `masters/m05-cat.png`（v3を採用）。`m05-cat-v1`〜`v3` と `*-generated.png` は制作過程の保存用で、直接配信する対象ではない。

## 正式な生成順

リポジトリのルートから実行する。

```sh
python -m pip install -r requirements-art.txt
python scripts/prepare-art.py
python scripts/prepare-box-layers.py
python scripts/prepare-blink.py
python scripts/prepare-hand.py
python scripts/subset-font.py
npm run build
```

1. `prepare-art.py` は選択済み透過PNGの微小アルファ汚れを除去し、一般のWebPと6つのメニューサムネイルを生成する。PNGマスターは保持する。`m05-cat-v*`、`*-generated`、次の専用スクリプトが扱う派生素材は除外されている。RGB背景の変換処理はこのスクリプトの対象外で、対応する配信用WebPを保持する。
2. `prepare-box-layers.py` は `masters/m02-box-open-generated.png` から、開いた箱の正確な六角形外周マスクで生成時の周囲のぼけを除去し、`m02-box-open`（合成版）、`m02-box-back`（背面・内部）、`m02-box-front`（前壁・縁）を生成する。3素材は1536×1024の同じキャンバスを使い、縁に2pxの重なりを持つ。ゲームでは背面→猫→前壁の順に同じ変換で合成する。開口部とアンカーは `public/assets/m02-box-layers.json` に記録している。
3. `prepare-blink.py` は `masters/m05-blink-generated.png` の自然に閉じた瞼だけを、選択済み通常顔と同じ941×1672のキャンバスに抽出する。2つの楕円の外周15%を滑らかにぼかし、目以外の部分は透明にする。鼻・顔全体を差し替えず、眼球の縦潰しも行わない。処理は `m05-blink-manifest.json`、確認画像は `m05-blink-eye-review.jpg` と `m05-blink-overlay-review.jpg`。
4. `prepare-hand.py` は `masters/m05-hand.png` を `m05-hand-clean.json` の出典・寸法と照合し、輪郭を描き直さずにアルファ8以下を0、248以上を255へ揃える。完全透明な画素のRGBを0にし、lossless WebP（quality=80、method=6、exact=True）を生成する。元画像と同じ1536×1024、つまみ点は `(460,350)`。この処理は形状変更や背景補完を行わない。
5. `subset-font.py` は保存済みM PLUS Rounded 1c TTFから、仕様・現在のコードで必要な字を含むローカルWOFF2を生成する。SIL OFLライセンスと出典は `FONT-LICENSE.txt`、`FONT-SOURCE.json`。文字追加後に実行する。

専用スクリプトは一般処理の後に実行し、派生素材のマスク・透明RGB・lossless設定を保持する。PNGを更新する場合は新しいバージョンとして保存し、レビュー後に選択済みの正本へ反映する。画像生成そのものは、保存されたマスターから後続処理を再現する工程とは分けている。

## 配信物を書き換えない確認

```sh
python scripts/prepare-hand.py --check
```

元PNGのSHA-256、マスターのRGBA画素、配信WebPの復号画素、および配信WebPのバイト列が一致することを検証する。`--check` は素材・メタデータを変更しない。Pillow等のバージョンは `requirements-art.txt` に固定している。

実画面の照合はブラウザ撮影後に `python scripts/compare.py` で行う。原画に対する横並び・50%重ね合わせ・増幅差分・記述的な画像指標を保存し、指標の数値だけで猫や動作の品質を合格にしない。

## 表情コレクションと実際の反応

`masters/reaction-portraits-generated.png` は、選択済みの `m05-cat.png` と `m03-body.png` を画像生成の参照に使った4列×3行の表情集。額の縞、白い頬、鼻、琥珀色の目、耳、細かい毛並みと暖かい光を引き継いでいる。12枚の配信用画像は等分セルをそのまま抽出したもので、顔の幾何変形や文字の焼き込みは行わない。各セルとSHA-256は `reactions.json` に保存している。

```sh
python scripts/prepare-reaction-portraits.py
python scripts/prepare-reaction-portraits.py --check
```

ゲーム中の頬の反応は、同じ猫の描画を維持し、登録済みの `m05-blink` の左右の瞼を個別に使う。左右のウインク、両目の短い閉眼、交互の閉眼、長めの穏やかな閉眼と、小さな耳の動きを組み合わせる。鼻・目の位置・頭蓋を変形させず、顔全体をコレクション画像へ差し替えない。耳の追加変位はステージ上で最大約5px、顔の領域には影響しない。動きを減らす設定では耳を動かさず表情を残す。参考画像の照合状態では追加反応を無効にする。

実ポインター操作、瞼の合成、通常時計での動画、6モードの同じキャンバスでの再プレイは `artifacts/replay/art-motion/` に検証資料を保存する。
