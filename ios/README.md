# 猫つぶし iOS版

iOS 16以上のiPhone／iPad用。Bundle IDは `jp.shunpei1130.nekotsubushi`、表示名は「猫つぶし」、バージョンは1.0.0です。Capacitor 8のWKWebViewへ全ゲーム素材を同梱し、通常のプレイには通信を必要としません。Androidのネイティブプロジェクトは今回の対象外です。

## 共有

全6モードの終了画面にX・TikTok・Instagramのボタンがあります。時間無制限のほっぺむにむには、右上の「おわる」から結果へ進めます。

- X：記録と公開HTTPSリンクを設定した投稿画面。本人が投稿を確定します。
- Instagram：1080×1350のPNGをOSの共有メニューへ渡します。アプリの表示可否や選べる投稿方法はインストールされたInstagramに依存します。
- TikTok：iOSのAVFoundationで1080×1920・H.264・5秒のMP4を端末内生成し、共有メニューへ渡します。猫を変形させず、小さなズームで記録を見せるカード動画です。
- 投稿用文章はiOSのクリップボードへコピーできます。アプリが共有先に現れない場合は共有メニューから素材を保存し、SNSで選択します。アプリは自動投稿しません。

共有画像・動画はキャッシュへ保存し、再挑戦で不要になった分を削除します。写真へ保存する場合はユーザーが選択します。記録は端末内に残り、Web版との自動同期はありません。旧スコアルール2とステージ開放1は継続します。

## ビルドと実アプリ検査

```sh
npm ci
npm run ios:sync
# macOS・Xcode26以降
npm run ios:open
```

`.github/workflows/ios.yml` が公開リポジトリの標準macOS runnerで実際のiOSアプリをビルドし、XCTestのタッチ、終了・共有、iPad表示、MP4出力を検査します。署名前のReleaseアーカイブと、Simulatorの画像・検査結果をActionsの成果物に保存します。

単純なブラウザのiPhone表示とは区別し、実iOS Simulatorの結果は `qa/ios-report.md` に記録します。境界検査に使う達成済みの保存データは明示的な構成fixtureです。ネイティブ側のfixture挿入はDebugとXCTest専用の起動引数に限り、Releaseにはコンパイルされません。

## ストア提出

`store/ja/` に説明文、Bundle ID、プライバシーURL、審査メモを用意します。`public/privacy.html` はアプリ内からも読めます。署名前のアーカイブは、実機への配布やApp Store提出が可能な署名済みIPAではありません。

Apple Developer Program登録済みと確認していますが、この作業環境にはApple署名・App Store Connectの認証は接続されていません。認証情報は公開リポジトリやチャットに貼らず、GitHubの保護されたSecretsに設定する必要があります。署名とアップロードの設定手順は、アプリのビルド・検査を完了したうえで別途案内します。審査と公開の状態を、実装やSimulator検査の完了と混同しません。
