# CHASEN

静的ホスティング可能なWebIDE環境。

## 技術スタック

- [CheerpX](https://cheerpx.io/): x86バイナリの実行エンジン
- [Lumino](https://luminojs.github.io/lumino/): ドッキングパネルやレイアウト管理などのデスクトップライクなUI基盤（`@lumino/widgets`, `@lumino/coreutils`, `@lumino/signaling`, `@lumino/virtualdom`）
- [Wunderbaum](https://mar10.github.io/wunderbaum/): ファイルシステムのtreeグリッド化
- [Monaco Editor](https://microsoft.github.io/monaco-editor/): VSCodeライクなコードエディタ
- [xterm.js](https://xtermjs.org/)（`xterm-addon-fit` 含む）: ターミナルUIの提供およびサイズ自動調整
- [Material Symbols](https://fonts.google.com/icons) / [Bootstrap Icons](https://icons.getbootstrap.com/): UIアイコン
- [esm.sh](https://esm.sh/) / [jsDelivr](https://www.jsdelivr.com/) / [cdnjs](https://cdnjs.com/): ビルド不要な静的配信向けのCDN・ESモジュール配信

## 開発者向けガイド（ローカル実行）

本プロジェクトのビルドおよびローカルサーバー起動は[Taskfile.yml](./Taskfile.yml) で管理されています。あらかじめ `task` および `podman` , `caddy` を用意してください。

### 1. ベースイメージのビルド

共通の Alpine（`linux/i386`）ベースイメージをビルドします。

```bash
task build:base
```

### 2. 言語別イメージ（`.ext2`）の作成

対象言語を指定してイメージをビルドし、`dist/rootfs-<lang>.ext2`を生成します。プルするイメージはPodmanかDockerHubから選べますが、どちらでも良いです。
（例：C言語の場合は`LANG=c`を指定）

```bash
task build:lang LANG=c
```

### 3. ローカル配信用ファイルへの反映とサーバー起動

生成した`.ext2`ファイルを`html/dist/`にコピーしたうえで、Caddyコンテナを起動します（デフォルトポート：`8080`）。

```bash
task sync:local-dist
task caddy:run
```

ポート番号を変更する場合は`LOCAL_HOST`の指定が可能です。

### その他便利なタスク

- リリース用`.ext2.gz`の作成: `task pack:gz LANG=c`
- リリース用静的ファイルの準備: `task build:pages`
- ビルド成果物や関連イメージの削除: `task clean`