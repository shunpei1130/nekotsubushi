# 後日のApple接続と提出

ユーザーの指定に従い、Appleの認証情報は後から接続する。アプリの実装、公開ソース、画像・動画、Simulator検査、署名前アーカイブ、提出処理は先に準備する。ストアに公開済みとは扱わない。

## 接続する情報

[STORE-SUBMISSION.md](../ios/STORE-SUBMISSION.md)の6項目だけを、[GitHub Actions Secrets](https://github.com/shunpei1130/nekotsubushi/settings/secrets/actions)へ設定する。秘密鍵、P12、パスワード、APIキーをチャットや公開リポジトリへ貼らない。Apple Developer Programへの登録済み回答は確認済み。

接続後は [Sign iOS and upload to App Store Connect](https://github.com/shunpei1130/nekotsubushi/actions/workflows/ios-release.yml) をmainで実行する。`upload=false`では署名済みIPAの作成まで、`upload=true`では日本語のストア情報・審査メモ・画面の準備とビルドのアップロードを行う。実行時のApple認証・アップロード自体は未検証。

| 自動処理 | 内容 |
| --- | --- |
| 署名 | 対象Bundle ID、有効期限、App Store配布用プロファイルを検証。一時キーチェーンで署名しIPAを出力 |
| App Store Connect認証 | Node標準の暗号機能で短期間のES256トークンを生成。追加の有料サービスは使用しない |
| 対象確認 | Bundle IDでアプリを検索し、別アプリや審査中・配信中の同一バージョンを変更しない |
| ストア情報 | 編集可能な1.0.0、ゲームカテゴリ、日本語名・副題・説明文・サポート／プライバシーURL・審査メモを設定 |
| スクリーンショット | iPhone 8枚とiPad 2枚を元PNGのまま送信。分割アップロードとチェックサム、Appleの処理完了を確認。既存の完了画像を再利用し、削除しない |
| アップロード | Apple Transporterへ署名済みIPAを渡す。ビルドの処理結果、審査提出、ストア公開の状態は別途確認 |
| 後片付け | 一時キーチェーン、P12、プロファイル、API秘密鍵を削除 |

`scripts/app-store.mts --validate`は認証不要で、説明文と元PNG10枚の寸法を検査する。`tests/app-store.test.ts`は実際に検証できるES256署名、対象制限、画像の分割転送、トークンを画像配信へ送らないこと、再実行、破損した転送範囲、認証エラーを検査する。APIの検査は明示的な模擬応答を使い、Appleへ送信した証拠にはしない。

## Apple側で接続後に確認すること

Appleの公開API仕様4.5.1では `/v1/apps` はGETのみで、最初のアプリ登録を作るPOSTを提供していない。アプリが未登録なら、Appleの画面で「猫つぶし」、日本語、Bundle ID `jp.shunpei1130.nekotsubushi` の初回登録が必要。接続後の処理は未登録を検出してこの内容を表示し、無関係なアプリを作ったり変更したりしない。既に登録済みならこの作業は不要。

アカウントの契約、審査連絡先、App Privacyの回答、配信地域・価格、年齢区分など、Apple側の登録状態は認証前には確認できない。必要なアカウント所有者の操作が見つかった場合は、その対象を接続後に特定する。日本語説明文やスクリーンショットの制作・転記をユーザーへ依頼する必要はない。

この処理は審査への提出やストア公開を自動的に確定しない。署名済みIPA、Appleでのビルド処理、TestFlight、審査・配信を順に確認してから完了を判断する。実機のiPhone／iPadと、インストールされたSNSでの実投稿はまだ検証していない。

参照：[Appleの公式OpenAPI仕様](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip)、[アップロードの公式手順](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)。画像のAPI表示区分は公式仕様の `APP_IPHONE_67` と `APP_IPAD_PRO_3GEN_129` を使う。実際のPNGはそれぞれ1320×2868、2064×2752。
