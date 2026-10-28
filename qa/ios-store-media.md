# App Store提出用の画像・説明文

iOSの画面は、実際のiOS Simulatorから出力したPNGを加工せず収録している。iPhone用は1320×2868、iPad用は2064×2752。撮影したゲーム画面の実装コミットは `7a6763180fa3784b8d6b629ca2960c7cd53dfdcc`、撮影CIは [40669076446](https://github.com/shunpei1130/nekotsubushi/actions/runs/40669076446)。この最終検査のゲーム・共有画面を提出素材へ収録する。初回メニュー1枚は描画完了前の添付を除外し、同じsrc／publicで実際の表示を確認済みのCI 40652501519の画像を使用する。各画像の出典は[撮影元一覧](../artifacts/ios-native/capture-provenance.json)を参照。

| 内容 | リポジトリ内のファイル |
| --- | --- |
| 新規ユーザーのメニュー | [fresh-ios-menu.png](../artifacts/ios-native/fresh-ios-menu.png) |
| 全6モード | `artifacts/ios-native/ios-game-1.png` 〜 `ios-game-6.png` |
| iPhoneの共有画面 | [ios-tiktok-video-ready.png](../artifacts/ios-native/ios-tiktok-video-ready.png) |
| iPadのメニュー | [ios-ipad-menu.png](../artifacts/ios-native/ios-ipad-menu.png) |
| iPadの共有画面 | [ios-ipad-share.png](../artifacts/ios-native/ios-ipad-share.png) |
| 1024×1024 RGBアイコン | [AppIcon-512@2x.png](../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png) |
| 日本語説明文 | [description.txt](../ios/store/ja/description.txt) |
| アプリ情報・審査メモ | [metadata.json](../ios/store/ja/metadata.json) |

全6モードの撮影には、Debug／XCTestで構成した達成済み履歴を使っている。人間がクリア条件を達成した証拠ではない。新規メニューの画像は、01だけが開放された状態を撮影している。実際のゲーム画面と区別のつかない架空の宣伝画面や、未実装機能の画像は使用していない。

納品用の `nekotsubushi-app-store-materials.zip` は、上記13ファイルと、各ファイルの出典・ピクセル寸法・SHA-256を記した `manifest.json` を含む。署名済みIPAやストアへのアップロード完了を示すものではない。署名とApp Store Connectの接続は [STORE-SUBMISSION.md](../ios/STORE-SUBMISSION.md) を参照。
