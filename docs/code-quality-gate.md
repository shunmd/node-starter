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

以下が標準基準である。`Conditional`は、対象ツールと対象アプリが存在する
プロジェクトでは必須とし、このテンプレートのようにまだ適用対象がない場合
は「未適用」と明記する。未適用の項目をPASS扱いにして隠してはならない。

| Category        | Metric                       | Gate                 | このリポジトリ                      |
| --------------- | ---------------------------- | -------------------- | ----------------------------------- |
| Formatting      | Formatter Error              | `= 0`                | Active: Prettier                    |
| Lint            | Lint Error / Warning         | `= 0`                | Active: ESLint + `--max-warnings 0` |
| Type Safety     | Type Error                   | `= 0`                | Active: `tsc --noEmit`              |
| Static Analysis | Critical Issue               | `= 0`                | Conditional: SonarQube CLI          |
| Static Analysis | High Severity Issue          | `= 0`                | Conditional: SonarQube CLI          |
| Complexity      | Cyclomatic Complexity        | `<= 10 / function`   | Active: ESLint                      |
| Complexity      | Cognitive Complexity         | `<= 15 / function`   | Conditional: SonarQube CLI          |
| Duplication     | Duplicated Lines on New Code | `<= 3%`              | Conditional: SonarQube CLI          |
| Dead Code       | Unused File                  | `= 0`                | Active: Knip                        |
| Dead Code       | Unused Dependency            | `= 0`                | Active: Knip                        |
| Dead Code       | Unused Export / Type         | `= 0`                | Active: Knip                        |
| Architecture    | Circular Dependency          | `= 0`                | Active: dependency-cruiser          |
| Architecture    | Dependency Rule Violation    | `= 0`                | Active: dependency-cruiser rules    |
| Security        | Secret Finding               | `= 0`                | Active: Gitleaks                    |
| Test            | Failed Test                  | `= 0`                | Active: Vitest                      |
| Coverage        | Line Coverage                | `>= 80%`             | Active: Vitest coverage             |
| Coverage        | Branch Coverage              | `>= 80%`             | Active: Vitest coverage             |
| Coverage        | Function Coverage            | `>= 80%`             | Active: Vitest coverage             |
| Mutation        | Mutation Score               | recommended `>= 80%` | Deferred: StrykerJS                 |

いずれかの必須項目がGateを満たさない場合、Quality GateはFAILである。

## 3. 現行リポジトリの実行入口

通常のローカル検証とCIの入口は次の1つに統一する。

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
  -> Secret Scan
  -> Unit / Integration Test
  -> Coverage
```

CIは同じ `pnpm verify` を実行する。`pnpm check` は互換エイリアスであり、
別の品質基準ではない。

現在の `verify` がPASSすることは、上表のActive項目を満たしたことを示す。
SonarのConditional項目を有効化したアプリケーションでは、それらもCIへ
追加してから「標準Quality Gate PASS」と扱う。

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

Static Analysisの標準ツールはSonarQube CLIとする。Critical IssueとHigh
Severity Issueは新規・変更コードで0とする。既存Issueを理由に新規Issueを
許容しない。

このテンプレートではSonarの認証・プロジェクト設定・CI接続先が未定義で
あるため、`pnpm verify`には組み込んでいない。アプリケーション化した時点
で、外部認証情報をリポジトリへ保存せずにCIへ追加する。

ローカルの差分解析は次を標準コマンドとする。

```sh
sonar analyze --staged
sonar analyze --base main
```

### 4.5 Cyclomatic Complexity

関数またはメソッド単位でCyclomatic Complexity `<= 10`とする。この閾値は
ESLintの`complexity`ルールで実行している。

超過時は、条件分岐の分離、Early Return、Strategy / Policyの分離、データ
構造による分岐削減を検討する。数値だけを下げるための不自然な関数分割は
行わず、責務の分離を目的とする。

### 4.6 Cognitive Complexity

関数またはメソッド単位でCognitive Complexity `<= 15`とする。深いネスト、
多段条件、複雑な制御フローを減らす。現行テンプレートではこの指標を
Sonarなしで測定できないため、Sonar有効化時のConditional Gateとする。

### 4.7 Duplication

新規・変更コードのDuplicated Linesを`<= 3%`とする。共通化によって依存
方向が不自然になる場合や、独立ドメインで偶然処理が一致する場合は、重複を
残す理由をレビューに記録する。重複率を下げること自体を目的に過剰な抽象化
を行わない。

現行テンプレートでは新規コード差分の重複率を測るSonar設定がないため、
Conditional Gateとして明記する。

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

Mutation Testingはテストコード自体の検出能力を測る。通常のverifyには
含めず、Scheduled CIまたは重要なDomain Logicに限定した別Jobで実行する。

推奨基準はMutation Score `>= 80%`、`60%`未満は改善対象とする。実行時間が
Pull Requestの許容範囲に収まる場合だけ、必須Gateへの昇格を検討する。

現行テンプレートではStrykerJSの依存が、既存の
`trustPolicy: no-downgrade`により拒否されるため未導入である。信頼ポリシー
を無効化して導入することはしない。互換リリースが解決した時点で
`test:mutation`と別CI Jobを追加する。

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

Secret ScanはStatic Analysisと同じ早期検査として扱う。Mutation Testingと
E2Eは、実行時間とアプリケーションの存在を確認した上で別Jobまたは定期実行
とする。

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

| Purpose              | Tool                       |
| -------------------- | -------------------------- |
| Formatting           | Prettier                   |
| Lint                 | ESLint + typescript-eslint |
| Type Check           | TypeScript Compiler        |
| Static Analysis      | SonarQube CLI              |
| Dead Code            | Knip                       |
| Architecture         | dependency-cruiser         |
| Unit Test / Coverage | Vitest                     |
| Mutation Testing     | StrykerJS                  |
| Secret Scan          | Gitleaks                   |

Quality Gateの意味を保てる同等ツールへの置換は可能だが、置換理由と測定
方法をこの文書またはADRへ記録する。
