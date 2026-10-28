# iOS版とSNS共有の検証

2026-10-28。対象はiOS 16以上のiPhone／iPad。Bundle ID `jp.shunpei1130.nekotsubushi`、バージョン1.0.0。ユーザーの指定に従い、Androidのネイティブ版は保留。

## 実装した範囲

- Capacitor 8とWKWebViewのiOSアプリ。6モード、猫の描画と仕草、ステージ開放、記録、表情集め、日替わり・挑戦状を継続。ゲーム素材とフォントをアプリへ同梱。
- 各モードの終了画面にX・TikTok・Instagram。05は「おわる」で結果を表示。スコアや時間制限は追加しない。
- Xは記録と公開HTTPSリンクを含む投稿画面。Instagramは1080×1350 PNG。iOSのTikTokはAVFoundationで1080×1920・H.264・30fps・5秒の縦動画を端末内生成。動画は記録カードを小さくズームする形式で、猫の顔を変形しない。
- PNG／MP4をOSの共有メニューへ渡す。投稿用文章のコピーと素材保存を用意。共有ポスターにはゲームの切り抜きパーツを使わず、1024pxの完成した猫の肖像を使う。投稿の確定は利用者自身が行う。ブラウザでファイル共有が使えないときは画像保存・文章コピーへ案内。
- 通常プレイのオフライン構成、中断復帰、端末のsafe area、縦横回転、iPad表示。保存ルール2、ステージ開放1、旧データの保持を継続。
- アプリアイコン、起動画面、プライバシー・サポート・依存ライセンス、ストア説明文、署名とアップロード用の手動ワークフロー。認証接続後の日本語説明文・ゲームカテゴリ・審査メモ・10枚のスクリーンショット送信も準備。

## 検証対象と結果

iOSアプリ・6ゲーム画面の撮影・アーカイブの最終ソース：`7a6763180fa3784b8d6b629ca2960c7cd53dfdcc`。該当CI：[40669076446](https://github.com/shunpei1130/nekotsubushi/actions/runs/40669076446)。iPhone、iPad、Chromium、WebKitの4ジョブすべて成功。提出スクリプトの最終ソースは `88727aea30b0378e1e5db58268610a5e7a713f86`。ゲーム描画のsrc／publicと配信JSは `5417ba75e2ac2c04650ef7ad6226e2ac831b9d89` から同一。

| 検証 | 結果・範囲 |
| --- | --- |
| 単体テスト | 103件成功、失敗0。PixiのURL解決に加え、提出処理の9件（実ES256署名検証・Apple APIの模擬応答）を含む。秘密鍵やAppleの実アカウントは使わない |
| ビルド・iOS素材同期 | TypeScript、Vite、Capacitor sync成功 |
| モバイルブラウザ | 最終CIのChromium／WebKitとも成功。6モードの3つのSNSボタン、実PNG生成・保存、コピー、Xの投稿URL、共有未対応・キャンセル、小画面・横画面・iPadサイズ |
| 既存機能の回帰CI | 最終ソースのChromium／WebKitで各12項目＋ステージ開放10項目、計44項目成功。20回再挑戦、同条件リンク、保存移行、仕草、日替わり、共有キャンセルと開放制限。CI [40670353849](https://github.com/shunpei1130/nekotsubushi/actions/runs/40670353849) |
| iOS Simulator | iPhone 17 Pro Max／iOS 26.4.1で2ケース成功。新規01のみ、実タップ・中断復帰・回転・全6モードの開始／終了、3つのSNSボタン、PNG・クリップボード・MP4・OS共有項目、画像／動画共有のキャンセルと復帰を確認 |
| iPad Simulator | iPad Pro 13-inch (M5)／iOS 26.4.1で1ケース成功。メニュー、05終了、画像生成、実際のOS共有メニュー、キャンセルとゲームへの復帰 |
| 未署名Releaseアーカイブ | Xcode 26.6／iPhoneOS SDK 26.5で成功。Bundle ID・1.0.0(1)・iOS 16.0以上を確認。テスト用挿入コードがバイナリにないことを検査 |
| 公開版 | 同じJS `/assets/index-1drYmYmA.js`。6モード操作8、SNS共有10、新規制限・通常時計タップ・未解放URL・プライバシー／ライセンス5、合計23項目成功。JS／アセットエラー0 |

競争モードのブラウザ共有検査では結果状態を構成している。時間制限や難易度を人間が達成した証拠ではない。05の終了、PNG生成、保存、共有ボタン、キャンセルはブラウザの実操作。Xのブラウザ検査は投稿画面をローカルスタブに差し替え、外部投稿は行っていない。

ネイティブの全6モード検査には、Debug・XCTest起動時だけに構成した達成済み保存データを使う。Releaseにはその挿入コードを含めず、アーカイブ内のバイナリにもテスト用環境変数名が残らないことを検査する。開放条件・難易度の調整の根拠は[前回のステージ検証](journey-report.md)を参照。

## 発見して修正した問題

初回のXCTestバンドル名、WebKitの同名ボタンの複数候補を修正した。さらに実アプリでゲーム画面の読み込み失敗を検出した。Pixiのルート相対URL解決はHTTP以外のスキームでホスト名を保持しなかったため、`capacitor://localhost/assets/...` を完全なURLにしてから渡すよう修正。ネイティブではworker fetchの代わりにHTML画像デコードを使う。原画像や猫のメッシュ品質は変更していない。

CapacitorがWebView設定後にcontent controllerを交換するため、Debugのログ／保存データ挿入を交換後の正式なWebView生成フックへ移した。読み込み失敗を直接検出するXCTestのチェックも追加した。iOSのSceneDelegateが標準の画面クラスを作っていたため、独自のGameViewControllerを起動するよう修正し、動画プラグインとDebug検査を実際の起動経路へ接続した。iOSが公開しない共有画面の内部識別子を使う検査は、ゲームのHTMLには存在しないAirDrop等のOS共有項目を検出する方式へ修正した。タップで開始し、実時計で終了する流れも確認する。共有ボタンがダイアログ外へ見切れた状態でもWebKitがhittableを返すことを画面で確認し、共有操作をプレビュー直下へ移動、検査でもダイアログの可視範囲を確認してからタップする方式へ修正した。失敗したCIを成功扱いせず、上記の最終ソースで全ジョブの成功を確認した。

その後の再検査で共有画面を残した終了処理と、動画生成のタイムアウトを検出した。終了前に実際のキャンセル通知を検査するよう変更し、AVFoundationは準備完了通知でフレームを送り、BGRA／IOSurfaceのバッファをロック解除してから渡す方式へ変更した。共有画面を先にロードする独自処理を廃止し、標準の表示経路へ揃えた。WebKitの可視フレーム中央へ実際のOSタッチを送る検査に変更し、Debugログでも `trusted:true` の入力を確認した。iPhoneとiPadを独立したジョブにし、両方の検査とReleaseアーカイブが成功した。途中の失敗を最終合格の根拠には使わない。

## ストアと未検証の範囲

Apple Developer Programへの登録済み回答を確認。ただし、Apple署名とApp Store Connectの認証はこの環境に接続されていない。署名済みIPA、TestFlight配布、App Storeの審査・公開は未実行。ユーザーの指定に従い、認証設定は後日に残す。必要な接続と保護されたSecretsは[署名・ストア接続](../ios/STORE-SUBMISSION.md)、設定後の実行・Apple側の登録確認は[提出準備の手順](ios-release-readiness.md)に記載。最初のアプリ登録、アカウントの契約・連絡先・App Privacyなどの状態は接続後に確認する。

物理iPhone／iPad、旧い実機での長時間性能、インストールされた各SNSの投稿画面・実投稿は未検証。Simulatorの共有メニューが開くことと、SNS側で投稿が完了することは異なる。未署名アーカイブをそのまま実機へインストールしたり、ストアへ提出したりはできない。

## 画面・出力・公開ソース

[6モードのiOS画面](../artifacts/ios-native/six-modes-overview.png)、[機械可読の検査結果](../artifacts/ios-native/report.json)、[実際のネイティブMP4](../artifacts/ios-native/tiktok-native.mp4)。各モードの原寸PNGと終了画面、iPhone／iPadの共有メニューも同じフォルダに保存。画面は構成した開放済み履歴を前提にした実際のSimulator画像。新規ユーザーの画像は `fresh-ios-menu.png`。最終ランの初回メニュー添付は描画完了前だったため提出素材から除外し、同じsrc／publicの以前の実撮影画像を採用した。この1枚の出典と除外理由は [撮影元一覧](../artifacts/ios-native/capture-provenance.json)に記録。実機の初回起動時間は未検証。

ネイティブ動画はffprobeでもH.264・1080×1920・30fps・150フレーム・5.000秒を確認。冒頭・中間・末尾の実フレームをデコードし、向き、日本語、毛並み、猫の顔、穏やかなズームを観察した。共有用の完成した1024px肖像へ切り替え、ゲーム用切り抜きの端が見える問題を解消。ゲームの猫・毛並み・メッシュ素材は維持した。

Web公開先：<https://nekotsubushi.vercel.app>。23項目の本番操作検査は `5417ba75e2ac2c04650ef7ad6226e2ac831b9d89` の配信JSに対して実施。提出処理更新版 `88727aea30b0378e1e5db58268610a5e7a713f86` の本番デプロイ `dpl_2esARsHLiRzJDYoG2t39npq7BguH` でも、src／public・配信JSは同一。iOSの動画出力は変更しているため、ネイティブ版は上記の最終CIとアーカイブを根拠にする。その後の証拠・説明文だけのコミットは、iOSアプリ本体・src／publicのツリーと配信JSを照合する。

公開検査の内訳：[新規の通常プレイと制限](../artifacts/ios-public/report.json)、[6モードの入力・結果・再挑戦](../artifacts/ios-public/modes-report.json)、[SNS共有](../artifacts/ios-public/sharing-report.json)。後者2つは明示的な構成済み達成履歴を使い、競争結果の構成や時計ステップを使う検査を含む。新規の通常プレイ検査はseed・fixture・時計ステップ・エンジン書き換えを使っていない。

Actionsの成果物 `nekotsubushi-ios-unsigned-archive` に未署名アーカイブ、`nekotsubushi-ios-review-iphone` と `nekotsubushi-ios-review-ipad` に画面と動画を保存。保持期間は1日なので、永続的な画像・動画・検査JSONはリポジトリにも収録する。署名・アップロード用の手動ワークフロー自体は、実際の所有者の証明書・APIキーが接続されてから検証する。

納品用ソースZIPは別フォルダへ展開し、継承したnode_modulesなしで `npm ci`、TypeScript／Viteビルド、Capacitor iOS同期、説明文とスクリーンショット10枚の検査が成功。署名ワークフローのApple実接続はこの検査に含めない。提出素材は[一覧](ios-store-media.md)を参照。
