# Code Quality Gate Guideline

この文書は、コード変更をマージ可能と判断するためのQuality Gateを定義
する。目的は、主観的なレビューだけに依存せず、静的解析・テスト・依存関係
解析などの機械的に検証可能な指標で最低品質を保証することである。

このガイドラインを品質基準の正とする。`package.json`、CI、各ツール設定は
この基準を実行可能な形へ落とし込む実装であり、実装と基準が食い違う場合は
まず基準または実装のどちらが現状に適しているかを明示して同期する。

## 1. 原則

### 1.1 判定はPass / Failで行う

品質を単一の総合スコアへ変換しない。各項目の基準を定義し、必須項目を
すべて満たした場合だけQuality GateをPASSとする。

```text
All required checks passed -> Quality Gate: PASS
Any required check failed  -> Quality Gate: FAIL
```

### 1.2 新規・変更コードを優先する

既存コードに技術的負債があっても、新しい変更で品質を悪化させないことを
優先する。Static Analysis、Complexity、Duplication、Test Coverageは、
可能なプロジェクトでは新規・変更コードを基準に評価する。

既存コード全体の改善は、Quality Gateを緩める理由ではなく、別の
リファクタリング作業として扱う。

### 1.3 自動判定可能な項目をGateにする

CIから自動判定できる項目をQuality Gateに含める。設計の妥当性、要件の
解釈、可読性など、機械的に一意に判定できない事項はコードレビューと
人間の承認で扱い、Quality Gateの数値に混ぜない。

## 2. 標準Quality Gate

以下が標準基準である。`Active`は現在のQuality Gateで必須、`Not measured`は
別の測定基盤が必要、`Pending`は導入判断または安全な依存解決が残っている
項目を示す。未測定・保留の項目をPASS扱いにして隠してはならない。

| Category        | Metric                        | Gate               | このリポジトリ                                                                 |
| --------------- | ----------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| Formatting      | Formatter Error               | `= 0`              | Active: Prettier                                                               |
| Lint            | Lint Error / Warning          | `= 0`              | Active: ESLint + `--max-warnings 0`                                            |
| Type Safety     | Type Error                    | `= 0`              | Active: `tsc --noEmit`                                                         |
| Static Analysis | Critical / High Issue         | `= 0`              | Not measured: SonarQube not adopted                                            |
| Security        | SAST Finding (local)          | `= 0`              | Active: ESLint `eslint-plugin-security`                                        |
| Complexity      | Cyclomatic Complexity         | `<= 10 / function` | Active: ESLint                                                                 |
| Complexity      | Cognitive Complexity          | `<= 15 / function` | Active: ESLint SonarJS rules                                                   |
| Complexity      | Function / File Size          | see below          | Active: ESLint `max-lines*`, `max-depth`, `max-params`, `max-nested-callbacks` |
| Duplication     | Repeated Branch / Function    | `= 0`              | Active: ESLint SonarJS rules                                                   |
| Duplication     | Duplicated Lines (whole tree) | `<= 2%`            | Active: jscpd (`pnpm duplication`, whole-tree, not diff-based)                 |
| Duplication     | Duplicated Lines on New Code  | `<= 3%`            | Not measured: no line-diff tool                                                |
| Dead Code       | Unused File                   | `= 0`              | Active: Knip                                                                   |
| Dead Code       | Unused Dependency             | `= 0`              | Active: Knip                                                                   |
| Dead Code       | Unused Export / Type          | `= 0`              | Active: Knip                                                                   |
| Architecture    | Circular Dependency           | `= 0`              | Active: dependency-cruiser                                                     |
| Architecture    | Dependency Rule Violation     | `= 0`              | Active: dependency-cruiser rules                                               |
| Security        | Secret Finding                | `= 0`              | Active: Gitleaks                                                               |
| Test            | Failed Test                   | `= 0`              | Active: Vitest                                                                 |
| Coverage        | Line Coverage                 | `>= 80%`           | Active: Vitest coverage                                                        |
| Coverage        | Branch Coverage               | `>= 80%`           | Active: Vitest coverage                                                        |
| Coverage        | Function Coverage             | `>= 80%`           | Active: Vitest coverage                                                        |
| Mutation        | Mutation Score                | `>= 80%`           | Active: StrykerJS (separate)                                                   |

いずれかの必須項目がGateを満たさない場合、Quality GateはFAILである。

## 3. 現行リポジトリの実行入口

標準Quality Gateのローカル検証とCI `check` Jobの入口は次の1つに統一する。

```sh
pnpm verify
```

実行順は次のとおりである。

```text
Toolchain policy
  -> Format
  -> Lint
  -> Type Check
  -> Dead Code
  -> Architecture
  -> Duplication
  -> Secret Scan
  -> Unit / Integration Test
  -> Coverage
  -> Mutation Testing (separate required CI job)
```

CIの`check` Jobは同じ `pnpm verify` を実行する。`pnpm check` は互換エイリアス
であり、別の品質基準ではない。Mutation Testingは`mutation` Jobで
`pnpm test:mutation`を実行する。

現在の `verify` がPASSすることは、通常ゲートに含まれるActive項目を満たした
ことを示す。Mutation TestingはActiveであり、実行時間のため別Job・別ゲート
である。完全なQuality Gate判定には`pnpm test:mutation`のPASSも必要である。
「Not measured」
はPASSでもFAILでもなく、別の測定基盤を追加しない限り判定不能である。
リポジトリの標準ゲートに含めない項目を、実施済みのように表示してはならない。

## 4. 個別基準

### 4.1 Formatting

Prettierをコードフォーマットの唯一の所有者とする。CIではファイルを変更
せず、フォーマット済みかだけを検証する。

```sh
pnpm format:check
```

修正は次で行う。

```sh
pnpm format
```

GateはFormatter Error `= 0`である。

### 4.2 Lint

ESLintとtyped `typescript-eslint`で、バグパターン・保守性問題・規約違反を
検出する。Warningを放置しない。Warningを許容する設定や、チェックを通す
ためだけのdisableは追加しない。

```sh
pnpm lint
```

`pnpm lint`は`--max-warnings 0`で実行し、Lint ErrorとWarningをともに0とする。

### 4.3 Type Safety

トランスパイルの成否に依存せず、TypeScript Compilerを明示的に実行する。

```sh
pnpm typecheck
```

GateはType Error `= 0`である。`strict`、
`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`などの設定を、既存
コードの実態を確認せずに弱めてはならない。

### 4.4 Static Analysis

SonarQubeは導入しない。サーバー、認証情報、プロジェクト設定に依存しない
ローカル検査として、ESLintへ`eslint-plugin-sonarjs`と`eslint-plugin-security`
の選択ルールを組み込む。

```sh
pnpm lint
```

現在有効なルールは、Cognitive Complexity `<= 15`、重複ブランチ、同一条件、
同一式、同一関数、同一文字列の検出、および代表的なNode.js SASTパターン
(non-literal `require`、安全でない正規表現構築など)である。
`detect-object-injection`と`detect-possible-timing-attacks`は誤検知率が
高いため無効化しており、理由は`eslint.config.js`のコメントに記載する。
これらはSeverity付きのSonarQube Quality Gateではなく、ESLintのエラー0件
として扱う。

Critical / HighというSeverity分類、既存Issueとの差分管理、変更行の重複率
3%はESLintだけでは再現できない。これらを測定済みとは扱わず、必要になった
場合は別のローカルツールを選定してから導入する。

### 4.5 Cyclomatic Complexity

関数またはメソッド単位でCyclomatic Complexity `<= 10`とする。この閾値は
ESLintの`complexity`ルールで実行している。

超過時は、条件分岐の分離、Early Return、Strategy / Policyの分離、データ
構造による分岐削減を検討する。数値だけを下げるための不自然な関数分割は
行わず、責務の分離を目的とする。

### 4.6 Cognitive Complexity

関数またはメソッド単位でCognitive Complexity `<= 15`とする。深いネスト、
多段条件、複雑な制御フローを減らす。現行テンプレートではこの指標を
`eslint-plugin-sonarjs`で測定し、`pnpm lint`の必須Gateとする。

### 4.7 Duplication

新規・変更コードのDuplicated Linesを`<= 3%`とする。共通化によって依存
方向が不自然になる場合や、独立ドメインで偶然処理が一致する場合は、重複を
残す理由をレビューに記録する。重複率を下げること自体を目的に過剰な抽象化
を行わない。

現行テンプレートでは変更行単位の重複率を測定しない。その代わり、ESLintで
重複ブランチ、同一関数、同一条件、同一式、同一文字列を検出するほか、jscpd
(`pnpm duplication`)がトークン単位の重複をリポジトリ全体で`<= 2%`に
制限する。全体重複率は変更行の重複率`<= 3%`と同値ではないため、元の基準を
満たしたとは表現しない。閾値2%は導入時点の実測重複率を踏まえた基準であり、
新規の重複を追加で許容する余地ではない。

### 4.8 Dead Code

Knipで未使用ファイル、依存関係、export、exportされた型を検出する。

```sh
pnpm deadcode
```

ツールが安定して解析できる範囲では、Unused Files、Unused Dependencies、
Unused Exports、Unused Exported Typesをすべて0とする。Framework、テスト、
動的import、外部公開APIによるfalse positiveは、無差別なignoreではなく、
公式pluginや明示的なentry設定で解決する。

### 4.9 Architecture

dependency-cruiserで依存方向をコード化する。

```sh
pnpm architecture
```

循環依存、解決不能なimport、production codeからtest・tests・test-utils・
`*.test.*`・`*.spec.*`への依存を0とする。アプリケーション層がまだ存在
しないテンプレートへ、存在しないPresentation / Application / Domainなど
の境界を勝手に追加しない。実際の層ができた時点で、禁止方向を設定へ追加する。

### 4.10 Tests

自動テストの失敗を0とする。最低限Unit Testを含め、Integration TestやE2E
Testが存在するプロジェクトでは、それぞれを対応するCI stageの必須Gateに
する。

```sh
pnpm test
```

このテンプレートはWebアプリケーションではないためPlaywrightを導入して
いない。Webアプリケーションになった時点で、起動・主要ページ・最重要
ユーザーフローを検証する最小E2E基盤を追加する。

### 4.11 Test Coverage

Line、Branch、Function Coverageを使用し、各`>= 80%`とする。条件分岐を
持つコードでは正常系だけでなく、false側、境界値、エラー、Optional値、
例外経路をテストする。

```sh
pnpm test:coverage
```

現行設定はリポジトリ全体の閾値である。アプリケーションで変更差分に対する
Coverageを測れるようになった場合は、新規・変更コードにも適用する。

### 4.12 Mutation Testing

Mutation Testingはテストコード自体の検出能力を測る。Mutation Score
`>= 80%`を必須Gateとし、通常の`verify`とは分離した必須CI Jobで実行する。

StrykerJSは通常の`verify`とは分離し、`test:mutation`を別ゲートとして実行する。
現行のStrykerJS CoreはBabel経由で`semver@6.3.1`を引き込むため、既存の
`trustPolicy: no-downgrade`に対して、この正確なバージョンだけを
`trustPolicyExclude`へ追加する供給網例外を登録している。例外は全体の信頼
ポリシーを無効化せず、`semver@6.3.1`だけを対象外にする。

```sh
pnpm test:mutation
```

Mutation Scoreは`>= 80%`を必須とし、StrykerJSの`break: 80`でコマンドをFAILに
する。
現行のplaceholder実装では9 mutant中9件を殺し、100%を確認している。

## 5. CIの実行方針

低コストの検査から順に実行し、前段で失敗した場合は後続を実行しない。
標準順序は次のとおりである。

```text
Format
  -> Lint
  -> Type Check
  -> Dead Code
  -> Architecture
  -> Static Analysis
  -> Unit Test
  -> Coverage
  -> Quality Gate
```

Secret ScanはStatic Analysisと同じ早期検査として扱う。Mutation Testingは
必須の別Jobで実行する。E2Eはアプリケーションの存在を確認した上で別Jobまたは
定期実行とする。

## 6. 例外と既存負債

Quality Gateを無視する場合は、チェックを無効化するのではなく、次を記録
して個別判断する。

- 例外の理由
- 影響範囲
- 解消予定または再評価条件
- 責任者

ESLint disable、Knip ignore、dependency-cruiser除外、Coverage対象除外、
Secret scanner例外を大量に追加してGateを通してはならない。失敗の原因が
実装にある場合は原則としてコードを修正する。

## 7. 標準ツール候補

| Purpose              | Tool                           |
| -------------------- | ------------------------------ |
| Formatting           | Prettier                       |
| Lint                 | ESLint + typescript-eslint     |
| Type Check           | TypeScript Compiler            |
| Static Analysis      | ESLint + eslint-plugin-sonarjs |
| Dead Code            | Knip                           |
| Architecture         | dependency-cruiser             |
| Unit Test / Coverage | Vitest                         |
| Mutation Testing     | StrykerJS                      |
| Secret Scan          | Gitleaks                       |

Quality Gateの意味を保てる同等ツールへの置換は可能だが、置換理由と測定
方法をこの文書またはADRへ記録する。
