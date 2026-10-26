# GitHub保存の再調査

調査日: 2026-10-23。全操作は読み取り専用。保存先が確定しない既存リポジトリには一切書き込んでいない。

- CLI認証アカウントは `shumpeihasegawa-gif`。前工程の新規作成は `Resource not accessible by integration (createRepository)` で拒否された。権限変更を示す根拠がないため、同じ作成操作は再試行していない。
- 接続済みGitHubプラグインの2つのプロフィールは `shumpeihasegawa-gif` と `shunpei1130`。前者とCLIは同一アカウントだが、後者には複数の既存リポジトリへのadmin/push権限がある。したがって「CLIの所有リポジトリ一覧が空」と「接続全体に保存可能な既存リポジトリがない」は同義ではない。
- 両アカウントのインストール済みリポジトリ検索で `nekotsubushi` は0件。ゲーム用と確認できる保存先は見つからなかった。
- 現在公開されているGitHubツールには、新規repository作成および汎用REST/GraphQL mutation実行の入口がない。`create_file`、`create_tree`、`create_commit`、`update_ref`等は既存repository内への保存用。
- Vercelの `create_git_project` は既存のアクセス可能なremote repositoryをVercelへ接続する機能で、GitHub repository自体を作る機能ではない。
- GitHubプラグインを検索し、既にインストール済みであることを確認。別の未接続GitHubプラグインは検索結果にない。接続ローカルブラウザを操作するツールも現在は公開されていない。

必要な外部操作は、希望するGitHubアカウントにゲーム専用の空の `nekotsubushi` repositoryを作成してURLを共有すること、または既存の保存先repository URLを明示すること。両プロフィールの主要GitHub Appインストールはall-repositories選択なので、新規repositoryは対象になる見込みだが、実際の書込可否は作成後に検査する。トークンやパスワードを共有する必要はない。

保存先と書込権限が確認できれば、ローカルGitの最終ソース状態をpush、またはGitHub connectorのtree/commit/ref操作で保存できる。アカウント選択が曖昧なまま、別ユーザーや無関係なプロジェクトへ保存しない。

## 公開リポジトリとVercel連携の許可後

ユーザーから公開リポジトリの作成とVercel接続の明示的な許可を受領。CLIで `shumpeihasegawa-gif/nekotsubushi` を公開設定で新規作成したが、GitHubは再び `Resource not accessible by integration (createRepository)` を返した。ユーザーの許可は有効であり、残る制約はGitHub連携の操作権限である。両アカウントの同名公開リポジトリも見つからなかった。

既存のVercelプロジェクトはそのまま保持し、Git接続後のビルドをVite、`npm ci`、`npm run build`、出力`dist`へ設定。設定後も公開URLの匿名HTTP200を確認した。Vercel側で接続済みのGitHub namespaceは `shunpei1130` のため、そのアカウントで公開リポジトリを作るのが最も直接的。

現在のVercel連携ツールに既存プロジェクトのGitリポジトリ接続操作がないため、公式CLIの `vercel git connect` を代替手段として準備する。CLIの認証はアプリ連携とは別であり、必要なログインはユーザー自身の認証画面で行う。パスワードやAPIトークンのチャット共有は不要。
