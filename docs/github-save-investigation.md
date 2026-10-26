# GitHub保存とVercel接続の記録

更新日：2026-10-26。

## 現在の保存先と接続状態

ユーザーが指定した公開リポジトリ [shunpei1130/nekotsubushi](https://github.com/shunpei1130/nekotsubushi) の `main` へ、ソース、配信素材、PNGマスター、仕様、比較画像、動作動画、QA資料を含む318ファイルを保存した。

- 初回の全ソース保存コミット：[bb28f86a7714e108c1cc70bc21d6d7b18dbe88ba](https://github.com/shunpei1130/nekotsubushi/commit/bb28f86a7714e108c1cc70bc21d6d7b18dbe88ba)
- 保存ツリー：`407b7deea63c5adbcbd4b79fb47fde0ca726a38f`。ローカル `fcde2ae` のスナップショットと一致することを確認した。
- GitHub repository ID：`1434026915`。公開設定、既定ブランチ `main`。
- Vercelは既存の `nekotsubushi` プロジェクト `prj_b9KY9TnCKejq0A7fGpe6uoC0cPFE` を保持。ユーザーがCLI認証を完了し、同じリポジトリへの `git connect` が終了コード0と `Connected` を返した。
- サーバー側でも、repository IDを指定したVercelプロジェクト検索が既存プロジェクト1件を返し、接続を確認した。
- 公開URLは https://nekotsubushi.vercel.app 。Vite、`npm ci`、`npm run build`、出力 `dist` のビルド設定を使用する。

GitHubコミット `bb28f86a7714e108c1cc70bc21d6d7b18dbe88ba` から本番デプロイ `dpl_G8SuEXHdGJzJuRQ8qc8D4RcoLuCh` を作成し、READYと既存公開URLへの反映を確認した。公開先を匿名ブラウザで操作し、全6モードの操作・結果・再プレイ・メニュー復帰を含む8項目成功、JavaScript／素材HTTPエラー0件。記録は `artifacts/production-report.json`、検証対象は `deployment.json` に保持する。

## 解決済みの経緯

2026-10-23には、CLIアカウント `shumpeihasegawa-gif` からの新規リポジトリ作成が、非公開・公開の両設定で `Resource not accessible by integration (createRepository)` として拒否された。当時は両接続アカウントにゲーム専用の保存先も見つからず、ソースをローカルGitとZIPに保持した。公開作成についてのユーザーの許可は有効であり、拒否理由は連携の操作権限だった。

その後、ユーザーが `shunpei1130/nekotsubushi` を保存先に指定し、既存リポジトリへの書込機能で全ファイルの保存を完了した。VercelのGit接続操作が現在のMCPにない点は、公式CLIを使って解決した。CLIの認証はアプリ連携とは別だが、ユーザーによるログインも完了済み。保存先URLの再指定や追加の認証操作は、この接続記録のためには必要ない。パスワードやAPIトークンをチャットで共有する必要もない。
