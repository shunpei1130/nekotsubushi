# 署名・App Store Connectの接続

アプリの実装、Simulator検査、署名前のアーカイブはAI側で実行します。App Storeへ提出する署名済みIPAには、ご本人のApple認証が必要です。この環境には接続されていないため、公開リポジトリやチャットへ秘密鍵を送らず、[GitHubの保護されたSecrets](https://github.com/shunpei1130/nekotsubushi/settings/secrets/actions)へ設定します。

| Secret名 | 内容 |
| --- | --- |
| `IOS_DISTRIBUTION_P12_BASE64` | Apple Distribution証明書と秘密鍵を含むP12のBase64 |
| `IOS_DISTRIBUTION_P12_PASSWORD` | そのP12のパスワード |
| `IOS_PROVISION_PROFILE_BASE64` | `jp.shunpei1130.nekotsubushi` 用App Store配布プロファイルのBase64 |
| `ASC_API_KEY_P8_BASE64` | App Store Connect API秘密鍵P8のBase64 |
| `ASC_KEY_ID` | API Key ID |
| `ASC_ISSUER_ID` | API Issuer ID |

Team IDはプロファイルから取得するので、別のコード編集は不要です。APIキーには対象アプリのアップロードが許可された権限を使います。Appleのパスワードや2段階認証コードをこのチャットへ貼る必要はありません。

`ios-release.yml` はmainブランチに対する手動実行だけを受け付けます。認証を接続したらAIが署名付きアーカイブとIPAを作成し、`upload`指定時にApp Store Connectへ送ります。自動のpushやPR検査では署名情報を使いません。`app-store` environmentに承認者を設定することもできます。署名に必要な一時ファイルは処理後に削除します。

App Store Connect側では、同じBundle IDのアプリ登録が必要です。表示名、説明文、プライバシーURL、審査メモは `store/ja/` に準備します。申請・審査・ストア公開が完了したかどうかは、ビルドの成功と分けて報告します。署名前アーカイブは、そのまま実機にインストールしたりストアへアップロードしたりできません。

参照：[Appleのビルドアップロード](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)、[Transporter認証](https://help.apple.com/itc/transporteruserguide/en.lproj/static.html)、[Xcodeの書き出し](https://help.apple.com/xcode/mac/current/en.lproj/dev23ea8b877.html)。
