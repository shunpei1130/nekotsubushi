# 猫つぶし

公開URL： https://nekotsubushi.vercel.app

ソース： https://github.com/shunpei1130/nekotsubushi

スマートフォンの指1本／PCのマウスで遊ぶ、6つの猫ゲームです。ログイン・課金・サーバー保存はありません。記録更新、同じ条件での友人への挑戦、日替わりのお題、表情集めを楽しめます。

| モード | あそび方・記録 |
| --- | --- |
| ねこつんつん | 閉眼中だけタップ。30秒。成功回数・最大連続数・起きる直前の「ギリギリ」を記録。 |
| 箱をずらせ | 猫が飛び込む間に箱を横へドラッグ。30秒。成功回数・連続数に加え「早め／ぴったり／ギリギリ」を判定。 |
| 猫パンチ寸止め | 鼻の前を長押し、パンチ前に離す。成功時の「パンチまで残り何msか」を競い、小さいほど上位。 |
| その帽子、いやニャ！ | 帽子が外れたらタップ。15秒。装着回数と、180ms以内の「ぴったり」回数・連続数を記録。 |
| ほっぺむにむに | 頬をドラッグして離す。時間・得点なし。6種類の触り方から表情を発見。 |
| あとちょっとで届くのに | 羽の光る輪をドラッグして15秒逃げる。生存時間と、猫の手の近くを逃げた「ひやひや時間」を記録。 |

## 何度でも、ひと勝負

結果には今回・前回・自己ベストと、次の目標を表示します。「もう1回！」では同じ描画基盤を再利用し、説明画面を挟まず開始操作を待ちます。通常モードの再挑戦は新しい出題、日替わりと挑戦状は同じ条件です。

「今日のねこチャレンジ」は日本時間の午前0時に更新します。競争可能な5モードが日替わりで登場し、同じ日の出題条件は共通です。開始後に日付が変わっても、そのお題を最後まで遊べます。

結果から「友だちに挑戦状」を送ると、相手は登録なしで同じ出題と目標記録に挑めます。結果を比較し、自分の記録で返信もできます。画像共有、リンクコピー、画像保存に対応します。共有される記録は端末からの自己申告で、公式ランキングではありません。

「ねこのきろく」には全12種類の表情カードがあります。6種類のほっぺ操作、5モードの達成、自己ベスト更新で発見できます。発見したカードから「仕草をみる」を押すと、静止画だけでなく実際のゲームSceneで目や耳の仕草を再生します。未発見のカードにもヒントがあります。

数値・順位・共有形式・保存移行の詳細は [改善仕様](docs/replay-improvements.md) を参照してください。

## 起動と検証

Node.js 22以上を推奨します。GitHub ActionsはNode.js 24を使用します。

```sh
npm ci
npm run dev
npm test
npm run build

# 新機能のブラウザ検査。未起動ならローカルViteを自動起動します。
npx playwright install chromium webkit
npm run test:replay
BROWSER=webkit npm run test:replay

# 公開先や起動済みプレビューを検査する場合
BASE_URL=https://nekotsubushi.vercel.app npm run test:replay
```

`npm test` の単体テストは69件で、判定、入箱、頬メッシュ、追加成績、日替わり、共有、保存移行、仕草を検査します。69件の成功を確認しています。新機能のブラウザ検査はメニュー・6モード・実時計での保存と友人比較・表情収集と再生・20回再挑戦・共有の代替操作を対象にし、実行結果と画面を `artifacts/replay/chromium/` または `artifacts/replay/webkit/` に出力します。各実行の成否はその `report.json` を確認してください。

Chromiumは `/usr/bin/chromium` があれば使用し、`CHROMIUM_EXECUTABLE_PATH` で指定もできます。WebKitは `WEBKIT_EXECUTABLE_PATH` で指定できます。Linux WebKitや端末サイズのビューポートは、物理iPhone Safari／Android実機の検査とは異なります。実機のOS共有画面や発熱・長時間性能は別途確認が必要です。

GitHub ActionsにはChromium／WebKitの行列で単体テスト・ビルド・新機能のブラウザ検査を実行するワークフローを用意しています。`main` のpush、pull request、手動実行が対象です。

既存の動作・画像照合を再検査するコマンド：

```sh
npm run test:browser
npx playwright install ffmpeg
BASE_URL=http://127.0.0.1:5173 npx tsx tests/motion.ts
BASE_URL=http://127.0.0.1:5173 npx tsx tests/hat-motion.ts
python -m pip install -r requirements-art.txt
python scripts/compare.py
```

## 構造

- `src/engine.ts`：seed付き時計・6モード判定・単一ポインター・取消／中断復帰・追加成績と判定イベント
- `src/progression.ts`：成績比較・日本時間の日替わり・挑戦URL・表情定義
- `src/store.ts`：端末内保存v2・旧記録移行・表情解放・Web Audio
- `src/main.ts`：メニュー・HUD・結果比較・再挑戦・表情閲覧と再生・共有・保存
- `src/share.ts`：1080×1350の共有画像・OS共有・リンクコピー・画像保存
- `src/scene.ts`、`src/reactions.ts`：独立した背景／猫／小物、局所変形と仕草、描画資源を再利用する再挑戦
- `src/choreography.ts`、`src/hat.ts`、`src/cheek.ts`：入箱・帽子の独立落下・反転を防ぐ頬変形
- `public/assets/`：配信WebP、12枚の表情カード、軽量サムネイル、ローカル日本語フォント
- `art/masters/`：制作元PNG。`docs/references/` と `docs/spec/`：受領した原画像と全仕様
- `tests/`、`artifacts/`、`qa/report.md`：自動検査・画面／動画・比較と残る制限

頬は33×43頂点の共通メッシュから局所的に動かします。目・鼻・耳の領域を固定し、元のテクスチャから毎フレーム計算するため歪みを累積しません。原画像の完成画面を背景に貼る方式は使用していません。

## 照合状態

`/?mode=1&fixture=reference&capture=1`〜`mode=6` で同じ本番Sceneを参照状態にします。ステージは941×1672、時計・アイドルを固定、UIの値は動的テキストです。参考画像用表示では追加UIを隠します。通常プレイは `/?mode=1`。`test=1` は時計を固定して `window.__game.step(ms)` から進めます。テスト時計やfixtureを使用したプレイの記録・発見は保存せず、共有対象にも含めません。

従来の動作検査資料は `artifacts/improved-motion/` に残しています。新しいブラウザ検査の結果は `artifacts/replay/` を参照し、異なる版の結果を一度の検査結果として扱わないでください。

## 保存と素材

記録・音・動き設定・発見済み表情は `nekotsubushi:v2` で端末に保存します。旧 `nekotsubushi:v1` は削除・上書きせず、設定と既存の回数・生存時間を引き継ぎます。寸止めの旧「長押し時間」は旧記録として保持し、新しい「パンチまでの残り時間」と区別します。通常の自己ベストとお題別のベストを分け、お題履歴は直近90コースを保存します。保存不能でもメモリ上で遊べます。05には得点を作りません。

素材は受領参考画像をもとに画像生成とパーツ制作で用意しました。新しい表情カードも同じ猫を参照して制作しています。既存素材の出所・処理は `art/processing.json`、フォント出所は `art/FONT-SOURCE.json`、SIL OFLライセンスは `art/FONT-LICENSE.txt` に保存しています。

ソース、制作素材、参照画像、検証資料を公開リポジトリに収録します。既存VercelプロジェクトはGit接続済みで、`main` の更新を自動ビルド・公開します。公開済み版の検証対象ソースとデプロイIDは `deployment.json`、接続の経緯は `docs/github-save-investigation.md` を参照してください。
