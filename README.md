# 猫つぶし

公開URL： https://nekotsubushi.vercel.app

ソース： https://github.com/shunpei1130/nekotsubushi

スマートフォンの指1本／PCのマウスで遊ぶ、6つの猫ゲームです。ログイン・課金・サーバー保存はありません。

| モード | あそび方 |
| --- | --- |
| ねこつんつん | 閉眼中にタップ。開眼中は手を止める。30秒。 |
| 箱をずらせ | 猫が離陸した瞬間、箱を左右へドラッグ。30秒。 |
| 猫パンチ寸止め | 鼻の前を長押し、パンチの前に離す。成功時だけ記録。 |
| その帽子、いやニャ！ | 帽子が外れたらタップして装着。15秒。 |
| ほっぺむにむに | 左右の頬をドラッグして離す。時間・得点なし。 |
| あとちょっとで届くのに | 羽の光る輪をドラッグし、15秒逃げる。 |

## 起動と検証

Node.js 22以上を推奨します。

```sh
npm ci
npm run dev
npm test
npm run build
npm run test:browser
npx playwright install ffmpeg
BASE_URL=http://127.0.0.1:5173 npx tsx tests/motion.ts
python -m pip install -r requirements-art.txt
python scripts/compare.py
```

ブラウザテストは `/usr/bin/chromium` を初期値にしています。`tests/browser.ts` で実行環境を調整できます。WebKitの追加検証は `tests/webkit.ts` と `artifacts/webkit-report.json` を参照してください。ブラウザ検証のビューポートは端末相当のエミュレーションで、物理iPhone/Android実機を接続した検査とは異なります。

## 構造

- `src/engine.ts`：seed付き時計・6モード判定・単一ポインター・取消／中断復帰
- `src/scene.ts`：PixiJSの背景／猫メッシュ／独立した手や小物／効果、参照カウントによる素材解放
- `src/choreography.ts`：箱への入場・跳躍・接地と前面レイヤーによる遮蔽
- `src/hat.ts`：2つの帽子の装着・独立した落下・着地・床上での保持
- `src/cheek.ts`：実際の押下位置を使う頬変形、三角形の反転防止、変形後の接点計算
- `src/main.ts`：メニュー・HUD・設定・結果・保存・画面遷移
- `src/store.ts`：端末内保存とWeb Audioの短い合成効果音
- `public/assets/`：配信WebP、軽量サムネイル、ローカル日本語フォント
- `art/masters/`：生成したPNGマスターと制作バージョン
- `docs/references/`：変更していない6枚の参考画像
- `docs/spec/`：受領した全仕様・JSON・CSV・レビュー
- `artifacts/`：各モード最終画面、動作フレーム、比較・差分・重ね合わせ、テスト結果
- `qa/report.md`：検証結果・視覚差分・残る制限

頬は33×43頂点の共通メッシュから局所的に動かします。目・鼻・耳の領域を固定し、元のテクスチャから毎フレーム計算するため歪みを累積しません。原画像の完成画面を背景に貼る方式は使用していません。

`npm test` は判定・入箱動作・頬メッシュの30件です。`tests/motion.ts` は実Pointer入力で入箱、パンチと手の退避、左右の頬の接点・内向きドラッグ・復元、自然なまばたきを検査し、動画とキーフレームを `artifacts/improved-motion/` に保存します。

動作検査の最終集約は `artifacts/improved-motion/final-report.json`。全モードの基準検査と、修正後のパンチの再検査を出典付きでまとめています。初回に発見した時計・フレーム飛びの失敗記録も診断資料として残しています。

帽子の落下中に次の帽子を被せる操作、両方の着地と保持、再プレイでのリセットは `BASE_URL=http://127.0.0.1:5173 npx tsx tests/hat-motion.ts` で検査できます。

## 照合状態

`/?mode=1&fixture=reference&capture=1`〜`mode=6` で同じ本番Sceneを参照状態にします。ステージは941×1672、時計・アイドルを固定、UIの値は動的テキストです。通常プレイは `/?mode=1`。`test=1` は時計を固定して `window.__game.step(ms)` から進めます。

## 保存と素材

最高記録・音・動き設定は `nekotsubushi:v1` で端末に保存され、保存不能時もメモリで遊べます。05には得点記録を作りません。受領参考画像をもとに画像生成でクリーンプレート、透明猫、表情差分、手、小物を制作し、透明縁を検査・整理しました。出所・処理は `art/processing.json`、`art/FONT-SOURCE.json`、フォントSIL OFLライセンスは `art/FONT-LICENSE.txt` に保存しています。

軽量ソースZIPはPNG制作元を省略しています。完全版ZIPには制作元・動作フレーム・差分をすべて含みます。ゲームの起動・ビルドにPNG制作元は不要です。

動作レビューZIPには入箱・パンチ・頬の動画、まばたきと接触姿勢、2つの帽子の着地画面を収録しています。軽量版は主要な最終画面・比較・検証JSONを含み、動画や全制作過程は完全版または動作レビューZIPを参照してください。

ソース、制作素材、参照画像、検証資料を公開リポジトリに収録しています。既存のVercelプロジェクトへGit接続し、`main` の更新を自動ビルド・公開する設定です。検証済みのGitソースとデプロイIDは `deployment.json`、保存・接続の経緯は `docs/github-save-investigation.md` を参照してください。
