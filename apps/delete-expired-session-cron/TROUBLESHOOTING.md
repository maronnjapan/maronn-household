# トラブルシューティング: Drizzle ORM型エラー

## 問題の概要

packagesに設定した内部パッケージ`@maronn-household/db-schema`からインポートしたスキーマを使用すると、以下のような型エラーが発生：

```
src/index.ts(46,13): error TS2345: Argument of type 'PgTableWithColumns<...>' is not assignable to parameter of type 'PgTable<TableConfig>'.
```

## 根本原因

### pnpmの依存解決によるdrizzle-ormの重複インストール

同じ`drizzle-orm@0.45.1`が、**peer dependenciesの組み合わせが異なる**ため、複数のインスタンスとしてインストールされた：

```
node_modules/.pnpm/
├── drizzle-orm@0.45.1_kysely@0.28.9_pg@8.16.3_postgres@3.4.7/
│   └── packages/db-schema が better-auth 経由で間接的に参照
│       (better-auth が kysely, pg などを peer dependencies として要求)
└── drizzle-orm@0.45.1_@types+pg@8.16.0_postgres@3.4.7/
    └── apps/delete-expired-session-cron が直接参照
        (このアプリは @types/pg と postgres のみ依存)
```

### TypeScriptの型判定

TypeScriptは**型のモジュールパスも含めて型を判定**するため、構造が同じでも異なるパスから来た型は互換性がないと判断される：

```typescript
// db-schemaからインポートしたsession
// → drizzle-orm@0.45.1_kysely@0.28.9_pg@8.16.3_postgres@3.4.7 の型

// drizzle(sql) が返すdb
// → drizzle-orm@0.45.1_@types+pg@8.16.0_postgres@3.4.7 の型

// db.delete(session) を実行しようとすると...
// → 異なるインスタンスの型なので型エラー！
```

エラーメッセージの詳細：

```
Type 'import("/path/to/drizzle-orm@0.45.1_kysely@0.28.9_pg@8.16.3_postgres@3.4.7/...").PgColumn<...>'

is not assignable to type

'import("/path/to/drizzle-orm@0.45.1_@types+pg@8.16.0_postgres@3.4.7/...").PgColumn<...>'

Property 'config' is protected but type 'Column<T, TRuntimeConfig, TTypeConfig>'
is not a class derived from 'Column<T, TRuntimeConfig, TTypeConfig>'.
```

## 試した解決策と結果

### ❌ 1. バージョンを統一

```json
// すべてのpackage.jsonでdrizzle-ormを0.45.1に統一
"dependencies": {
  "drizzle-orm": "^0.45.1"
}
```

**結果**: 効果なし
**理由**: バージョンは同じでも、peer dependenciesの組み合わせが異なるため、pnpmは別インスタンスとしてインストール

### ❌ 2. node_modules全削除＆再インストール

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

**結果**: 効果なし
**理由**: pnpmの仕様通りに動作しているため、クリーンインストールしても同じ結果

### ❌ 3. moduleResolutionをbundlerに変更

```json
// tsconfig.json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

**結果**: 効果なし
**理由**: モジュール解決方法を変えても、異なるパスから来た型は依然として別物として扱われる

## 採用しなかった解決策

### 方法A: pnpm.overridesで強制統一

```json
// package.json (root)
{
  "pnpm": {
    "overrides": {
      "drizzle-orm": "0.45.1"
    }
  }
}
```

**採用しなかった理由**:
- better-authのpeer dependenciesを無視することになる
- 実行時エラーのリスクがある
- better-authが期待する他のパッケージ（kysely等）との互換性が保証されない

### 方法B: db-schemaをビルド済みパッケージにする

```json
// packages/db-schema/package.json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./auth": "./dist/auth.js"
  },
  "scripts": {
    "build": "tsc"
  }
}
```

**採用しなかった理由**:
- ビルドステップが必要になり、開発体験が悪化
- db-schemaを変更するたびにビルドが必要
- monorepoの利点（即座の変更反映）が失われる

### 方法C: 型定義のみエクスポート

```typescript
// packages/db-schema/src/auth.ts
export type SessionTable = typeof session;
export type UserTable = typeof user;
// 実際のテーブル定義はエクスポートしない
```

**採用しなかった理由**:
- 実行時の値（テーブル定義）が使えなくなる
- ORMのクエリビルダーで使えない
- db-schemaパッケージの本来の目的（スキーマの共有）を果たせない

### 方法D: drizzle-ormを使わず、型定義のみ共有

```typescript
// packages/db-schema/src/auth.ts
export interface Session {
  id: string;
  expiresAt: Date;
  token: string;
  // ...
}

// 各アプリで独自にテーブル定義を作成
```

**採用しなかった理由**:
- 型定義とテーブル定義の二重管理が発生
- スキーマ変更時に複数箇所の修正が必要
- 本末転倒（スキーマの一元管理が目的だった）

## 採用した解決策: 生SQLの使用

```typescript
// apps/delete-expired-session-cron/src/index.ts
const result = await sql`
  DELETE FROM session
  WHERE id IN (
    SELECT id FROM session
    WHERE expires_at < ${thresholdDate}
    LIMIT ${BATCH_SIZE}
  )
  RETURNING id
`;
```

### メリット

1. **確実性**: ORM依存を完全に除去すれば型エラーは起きない
2. **シンプル**: Cronジョブのような単純なユースケースではORMは過剰
3. **パフォーマンス**: PostgreSQLのネイティブバッチ削除を直接使える
4. **保守性**: 依存関係の競合に悩まされない
5. **軽量**: drizzle-orm依存を削除（bundle sizeが小さくなる）

### デメリット

1. **型安全性の低下**: カラム名の変更がコンパイルエラーにならない
2. **SQLインジェクションリスク**: 変数の扱いに注意が必要（postgresのテンプレートリテラルは自動エスケープするので安全）
3. **ORMの便利機能が使えない**: マイグレーション、リレーション、クエリビルダーなど

## monorepoでORMを共有する際の教訓

### 問題が起きやすいケース

1. **異なるpeer dependenciesを持つパッケージ間でORMを共有**
   - 例: better-authを使うアプリとCronジョブでDrizzle ORMを共有

2. **ソースコード（.ts）を直接エクスポート**
   - pnpmの依存解決がpeer dependenciesごとにインスタンスを分離

3. **TypeScriptの厳密な型チェック**
   - モジュールパスも型の一部として判定される

### 推奨される設計パターン

#### パターン1: 用途に応じてORMの使い分け

```
apps/household-app/       → Drizzle ORM使用（複雑なクエリ）
apps/cron-job/            → 生SQL使用（シンプルなクエリ）
packages/db-schema/       → 型定義とマイグレーションのみ提供
```

#### パターン2: ビルド済みパッケージとして配布

```
packages/db-schema/
  ├── src/           # ソースコード
  ├── dist/          # ビルド済み
  └── package.json   # "main": "./dist/index.js"
```

開発時のトレードオフ:
- ✅ 型の競合が起きない
- ❌ 変更のたびにビルドが必要

#### パターン3: API経由でデータアクセス

```
apps/household-app/       → tRPC経由でアクセス
apps/cron-job/            → REST API経由でアクセス
packages/api/             → Drizzle ORMを内部で使用
```

APIレイヤーでORMを隠蔽:
- ✅ 型の競合が起きない
- ✅ API境界が明確
- ❌ ネットワークオーバーヘッド

## 参考情報

### pnpmとpeer dependencies

- [pnpm - How peers are resolved](https://pnpm.io/how-peers-are-resolved)
  - pnpmがpeer dependenciesをどのように解決するかの公式ドキュメント
- [pnpm - .pnpm directory](https://pnpm.io/symlinked-node-modules-structure#pnpm-directory)
  - `.pnpm`ディレクトリの構造とパッケージがどのように格納されるか
- [pnpm - FAQ: Why does pnpm create hard links?](https://pnpm.io/faq#why-does-pnpm-create-hard-links)
  - pnpmが依存関係を効率的に管理する仕組み
- [npm - Peer Dependencies explained](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#peerdependencies)
  - peer dependenciesの基本概念

### TypeScriptの型システム

- [TypeScript - Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
  - TypeScriptがモジュールをどのように解決するか
- [TypeScript - Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)
  - TypeScriptの型互換性の判定方法
- [TypeScript Deep Dive - Module Resolution](https://basarat.gitbook.io/typescript/project/modules)
  - モジュール解決の詳細な解説

### monorepoとパッケージ管理

- [pnpm - Workspace](https://pnpm.io/workspaces)
  - pnpm workspacesの使い方
- [pnpm - overrides](https://pnpm.io/package_json#pnpmoverrides)
  - 依存関係を強制的に上書きする方法
- [How to Fix Module Conflicts in pnpm Monorepos](https://blog.logrocket.com/managing-full-stack-monorepo-pnpm/)
  - monorepoでの依存関係の競合を解決する方法

### 関連する問題と議論

- [Drizzle ORM - GitHub Discussions](https://github.com/drizzle-team/drizzle-orm/discussions)
  - Drizzle ORMに関する議論
- [TypeScript Issue: Nominal typing for module paths](https://github.com/microsoft/TypeScript/issues/202)
  - モジュールパスを型の一部として扱うことに関する議論
- [pnpm Issue: Peer dependencies resolution](https://github.com/pnpm/pnpm/issues?q=is%3Aissue+peer+dependencies)
  - peer dependenciesに関連するpnpmのissue

### ORM設計とベストプラクティス

- [Drizzle ORM - PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)
  - Drizzle ORMの基本的な使い方
- [When to use an ORM vs raw SQL](https://www.prisma.io/docs/concepts/overview/prisma-in-your-stack/is-prisma-an-orm)
  - ORMと生SQLの使い分け
- [Building a Type-Safe Monorepo](https://turbo.build/repo/docs/handbook/sharing-code)
  - monorepoで型安全なコード共有を実現する方法

## 日付

2026-01-07
