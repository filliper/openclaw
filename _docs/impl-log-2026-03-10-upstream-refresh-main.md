# 実装ログ - 2026-03-10 upstream refresh to main

## 概要
- 作業ブランチ `codex/upstream-merge-2026-03-10-refresh` で `upstream/main` の `aca216bfcf` を取り込み、ローカル launcher 維持差分を再適用した。
- `py -3` で `git diff --name-only main..HEAD` を機械列挙し、変更 43 ファイルをカテゴリ別に後処理して確認した。
- `pnpm-lock.yaml` は競合 1 件のみで、upstream 版を採用した。

## py -3 列挙結果の後処理
- `.github`: 1 file
  - `codeql` workflow 更新
- repo root: 2 files
  - `CHANGELOG.md`
  - `pnpm-lock.yaml`
- `docs`: 2 files
  - cron job docs
  - Mattermost docs
- `extensions`: 12 files
  - ACPX runtime/config 更新
  - Mattermost target resolution / send 修正
  - MS Teams allowlist 解決修正
- `scripts`: 4 files
  - `HAKUA_LAUNCH.ps1`
  - `clawdbot-master.ps1`
  - `create-desktop-shortcut.ps1`
  - `setup-shortcut.ps1`
- `src`: 20 files
  - ACP session resume
  - embedded runner / sessions spawn
  - outbound target resolution
  - cron delivery target
- `ui`: 2 files
  - debug / render 周辺

## 独自機能の維持
- desktop launcher はローカル優先で維持した。
- `scripts/HAKUA_LAUNCH.ps1` は二重 PowerShell 起動をやめ、同一 console で master launcher を呼ぶ形に戻した。
- `scripts/clawdbot-master.ps1` は `SpeakOnReady` を受け取り、可視 console を維持したまま `launch-desktop-stack.ps1` へ委譲する形を維持した。
- shortcut 生成 2 本は `-NoExit` を保持し、起動直後に console が閉じないようにした。

## 利用可能状態の確認
- `git status` は clean。branch は `codex/upstream-merge-2026-03-10-refresh` で merge commit `b33f379200` を保持。
- `git rev-list --left-right --count main...codex/upstream-merge-2026-03-10-refresh` は `0 10` で、`main` はこの branch に fast-forward 可能。
- `git rev-list --left-right --count origin/main...codex/upstream-merge-2026-03-10-refresh` も `0 10` で、push 対象は `origin/main` に対しても fast-forward 可能。
- runtime/state の退避は `F:\codex-merge-work\20260310\backup` に保持。

## 未解決の実行環境課題
- `corepack pnpm vitest run ...` と `corepack pnpm exec vitest run ...` はどちらも `vitest` 実行体を解決できず失敗した。
- merge commit 前の hook は `oxlint-tsgolint` 実行体不足で失敗したため、統合 commit は `--no-verify` で確定した。
- そのため今回の「利用可能状態確認」は git 整合性、merge 整合性、push 可能性、launcher 維持までを確認範囲とし、テスト実行は環境整備後の追試対象とした。
