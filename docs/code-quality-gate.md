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
| Dead Code       | Orphan Module                 | `= 0`              | Active: dependency-cruiser `no-orphans`                                        |
| Architecture    | Circular Dependency           | `= 0`              | Active: dependency-cruiser                                                     |
| Architecture    | Dependency Rule Violation     | `= 0`              | Active: dependency-cruiser rules                                               |
| Supply Chain    | Known Vulnerability           | `= 0` unaccepted   | Active: `pnpm check:deps` (`pnpm audit`)                                       |
| Supply Chain    | Disallowed Licence            | `= 0`              | Active: `pnpm check:deps` (`pnpm licenses list`)                               |
| Supply Chain    | Release Cooldown              | `>= 5 days`        | Active: pnpm `minimumReleaseAge` + `pnpm check:toolchain`                      |
| Supply Chain    | Unpinned CI Action            | `= 0`              | Active: `pnpm check:workflows`                                                 |
| Supply Chain    | Dependency Update Proposal    | weekly             | Active: Dependabot (`.github/dependabot.yml`)                                  |
| CI Policy       | Workflow Policy Violation     | `= 0`              | Active: `pnpm check:workflows`                                                 |
| Gate Integrity  | Gate Contract Violation       | `= 0`              | Active: `pnpm check:gate-contract` (`scripts/lib/gate-contract.ts`)            |
| Gate Integrity  | Unlisted Template-Owned File  | `= 0`              | Active: `pnpm check:manifest` (`scripts/lib/template-manifest.ts`)             |
| Gate Integrity  | Scope Matching No File        | `= 0`              | Active: `pnpm check:scope` (`scripts/lib/scope-contract.ts`)                   |
| Security        | Secret Finding (working tree) | `= 0`              | Active: Gitleaks `dir`                                                         |
| Security        | Secret Finding (history)      | `= 0`              | Active: Gitleaks `git`                                                         |
| Test            | Failed Test                   | `= 0`              | Active: Vitest                                                                 |
| Test            | Skipped / Focused Test        | `= 0`              | Active: ESLint `vitest/no-focused-tests`, `vitest/no-disabled-tests`           |
| Test            | Test Without Assertion        | `= 0`              | Active: ESLint `vitest/expect-expect`                                          |
| Coverage        | Line Coverage (per file)      | `>= 95%`           | Active: Vitest coverage `perFile`                                              |
| Coverage        | Branch Coverage (per file)    | `>= 95%`           | Active: Vitest coverage `perFile`                                              |
| Coverage        | Function Coverage (per file)  | `>= 95%`           | Active: Vitest coverage `perFile`                                              |
| Coverage        | Coverage on New Code          | `>= 95%`           | Approximated by the per-file threshold; see 4.11                               |
| Mutation        | Mutation Score                | `>= 95%`           | Active: StrykerJS (separate job)                                               |
| Review          | Human Approval                | not required       | Active: `main` ruleset keeps CI and thread-resolution gates                    |
| Review          | Protected-file Notice         | informational      | Active: CI `protected-file-notice`                                             |
| Shell           | Shell Lint Finding            | `= 0`              | Not measured: ShellCheck not in the pinned toolchain                           |

いずれかの必須項目がGateを満たさない場合、Quality GateはFAILである。

## 3. 現行リポジトリの実行入口

標準Quality Gateのローカル検証とCI `check` Jobの入口は次の1つに統一する。

```sh
pnpm verify
```

実行順は次のとおりである。

```text
Toolchain policy
  -> Workflow policy
  -> Gate contract (this document vs. package.json / vitest.config.ts /
     stryker.config.json / eslint.config.js / .dependency-cruiser.json /
     ci.yml / rulesets/main.json)
  -> Format
  -> Lint
  -> Type Check
  -> Dead Code
  -> Architecture
  -> Duplication
  -> Secret Scan (working tree + history)
  -> Dependency policy (vulnerabilities + licences)
  -> Unit / Integration Test
  -> Coverage (per file)
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

Line、Branch、Function Coverageを使用し、各`>= 95%`とする。条件分岐を
持つコードでは正常系だけでなく、false側、境界値、エラー、Optional値、
例外経路をテストする。

```sh
pnpm test:coverage
```

閾値は`perFile: true`でファイル単位に適用する。リポジトリ全体の平均では、
テストが充実したモジュールが未テストのモジュールを埋め合わせてしまい、
レビュアーが本来懸念するファイルこそ平均に隠れる。

変更行単位のCoverageを測るツールはこのツールチェーンに含まれないが、
ファイル単位の閾値がその代替として機能する。新規ファイルは95%未満では
リポジトリに入れられず、既存ファイルも95%を下回る変更を加えられない。
差分そのものを測っているわけではないため、`Coverage on New Code`は
「Active」ではなく「Approximated」と表記する。

Coverageの対象は`src/**`と`scripts/lib/**`である。`scripts/lib/**`を含める
のは、そこに品質ゲート自身の判定ロジックがあるためで、未テストの
Enforcement Layerはゲートのないゲートである。`scripts/*.ts`は
argv・I/O・exitのみを担うEntry Pointとして対象外とし、そこにロジックが
逃げないようESLintで120行に制限する。

### 4.12 Mutation Testing

Mutation Testingはテストコード自体の検出能力を測る。Mutation Score
`>= 95%`を必須Gateとし、通常の`verify`とは分離した必須CI Jobで実行する。

StrykerJSは通常の`verify`とは分離し、`test:mutation`を別ゲートとして実行する。
現行のStrykerJS CoreはBabel経由で`semver@6.3.1`を引き込むため、既存の
`trustPolicy: no-downgrade`に対して、この正確なバージョンだけを
`trustPolicyExclude`へ追加する供給網例外を登録している。例外は全体の信頼
ポリシーを無効化せず、`semver@6.3.1`だけを対象外にする。

```sh
pnpm test:mutation
```

Mutation Scoreは`>= 95%`を必須とし、StrykerJSの`break: 95`でコマンドをFAILに
する。PRでは変更された本番コードだけを対象とし、該当ファイルがない場合は
正常終了する。mainへのpushとスケジュール実行では`src/**`と`scripts/lib/**`の
全体を対象とする。Enforcement Layer
のテストが「実行はしているが検出はしていない」状態を許さないため、品質
ゲート自身のロジックもMutation Testingの対象とする。

### 4.13 Supply Chain

依存関係は差分を読んでも判断できない。バージョン表記が妥当に見えても、
そのパッケージに公開済みの脆弱性があるか、受け入れられないライセンスか、
公開直後の版かは、人間のレビューでは分からない。したがって機械的な
Gateとして扱う。

```sh
pnpm check:deps
```

- **Known Vulnerability**: `pnpm audit`の全Advisoryを対象とし、Severityで
  除外しない。`moderate`だから無視するという判断は、依存の到達経路を見て
  初めて可能であり、閾値では表現できない。
- **Disallowed Licence**: `pnpm licenses list`の全パッケージを
  `infra/policy/dependency-policy.json`のAllow Listと照合する。
- **例外**: 上記いずれも同じ形式の例外で通す。対象を正確に特定し
  (Advisory ID + パッケージ名、あるいはパッケージ名 + ライセンス)、理由と
  責任者を必須とする。脆弱性の例外にはさらに`reviewBy`(再評価期限)を必須と
  し、期限を過ぎた例外は抑制をやめてFAILになる。
- **陳腐化した例外もFAILである**。該当する所見が消えた例外はファイルに
  残せない。これにより、すでに解消した問題への承認が蓄積しない。

`infra/policy/dependency-policy.json`はCODEOWNERSの対象である。既知の
脆弱性やライセンスを受け入れる判断は、機械が単独で行ってはならない。

Release Cooldown (5日) は`pnpm-workspace.yaml`の`minimumReleaseAge`と
`scripts/check-toolchain-age.ts`が担う。前者はnpm依存、後者はmise管理の
Node・pnpm本体を対象とする。

### 4.14 CI / Workflow Policy

GitHub Actionsのworkflowは、このリポジトリで最も高い権限で動くコードで
あり、その失敗様態はESLintが探すものとは違う。したがって別のGateとする。

```sh
pnpm check:workflows
```

現在の必須ルールは次のとおりである。

- すべての`uses:`をfull commit shaで固定する。tagやbranchはレビュー後に
  別のコードへ差し替えられる。
- `uses:`でReusable Workflowを呼び出すjob以外は`timeout-minutes`を設定し、
  上限を30分とする。Reusable Workflowのtimeoutは呼び出し先で設定する。
- workflowはtop-levelで`permissions`を宣言する。
- 外部Reusable Workflowはfull commit shaで固定し、local workflowは
  `.github/workflows/`配下に置く。OIDCの`id-token: write`はjob単位だけ許可する。
- `pull_request_target`を使用しない。
- `run:`に`${{ }}`を直接展開しない。値はshell実行前に貼り込まれるため、
  それに影響できる者はコマンドを実行できる。`env:`経由で渡す。
- `actions/checkout`は`persist-credentials: false`を指定する。

### 4.15 Gate Contract

Quality Gateを構成するファイル自体が、この文書の基準からずれていないかを
検証する。ESLintルールを`warn`へ弱める、Coverage対象から`scripts/lib`を
除外する、CoverageまたはMutation Scoreの閾値を95未満へ下げる、`pnpm check`から必須Stepを
削除する、Rulesetのrequired status checkとCI Job名が食い違う、といった変更は
コードレビューを経ずにマージされ得る。この文書はGateの意図を記述するが、
実行はしない。

```sh
pnpm check:gate-contract
```

対象は`package.json`のscript一覧、`vitest.config.ts`のcoverage対象と閾値、
`stryker.config.json`のmutate対象と閾値、`eslint.config.js`の主要ルールが
`error`であること、`.dependency-cruiser.json`の必須forbidden ruleと
severity、`ci.yml`の必須Job(`check`、`mutation`)がif条件・
`continue-on-error`・path filterで無効化されていないこと、および
`infra/github/rulesets/main.json`のrequired status checkとci.ymlのJob名が
一致することである。判定ロジックは`scripts/lib/gate-contract.ts`にあり、
他のEnforcement Layer同様、Coverage・Mutation Testingの対象である。

Gateを構成するファイルが「存在するか」は別の問題であり、
`pnpm check:manifest`が担当する。`infra/template-manifest.json`は
Templateが所有するファイルの唯一の一覧であり、`scripts/diff-upstream.sh`と
移行手順はこれを読む。宣言されたroot配下にありながら一覧にないファイル、
および一覧にありながら存在しないパスは、いずれもGate失敗として扱う。
一覧が古びると、次にTemplateを導入するリポジトリはそのファイルを
持たないままGateが緑になる。判定ロジックは
`scripts/lib/template-manifest.ts`にある。

同様に、`pnpm check:scope`はMutation Testingの`mutate`、Coverageの
`include`、jscpdの`path`、`architecture` scriptが走査するディレクトリを
実際のファイルに対して解決し、1件も一致しないScopeをGate失敗とする。
移行元のディレクトリ構成のまま残った`src/application/**/*.ts`のような
指定は、Strykerであれば実行が止まるため気付けるが、jscpdやCoverageの
`include`は何も測らずに成功を報告する。判定ロジックは
`scripts/lib/scope-contract.ts`にある。

この検査は各ファイルの**宣言された形**を読むだけで、実行時の値は見ない。
したがって「Gateが正しく動くこと」自体の証明ではなく、他のCheckがそれを
担う。この検査が証明するのは、Gateを構成する設定が壊れた状態のまま
マージされないことである。

### 4.16 承認なしのマージ保護

Quality Gateが「人的レビューの卒業」を意味するのは、機械的に判定できる
範囲についてだけである。Enforcement Layer自体の変更も、保護ファイル通知
で可視化しつつ、個人開発で承認待ちにならないよう承認を必須にしない。この
判断は個人開発である間の意図的な設計であり、設定漏れではない。複数開発者・
本番運用・高リスク資産を扱う場合の移行条件を含め、
[ADR 0008](decisions/0008-no-required-human-approval-solo-repo.md)に記録する。

境界は二重になっており、役割が異なる。

| 仕組み                     | 何を保証するか                                                   |
| -------------------------- | ---------------------------------------------------------------- |
| CI `protected-file-notice` | 変更パスをPRコメントに記録する情報通知                           |
| `main` ruleset             | `check`、`mutation`、`github-settings`、スレッド解決を必須にする |

前者は制御ではなく情報通知であり、PRのtitleやlabelも要求しない。実際の
承認は要求しない。`.github/CODEOWNERS`は、必要なプロジェクトが後から
code-owner reviewを有効化するためのメタデータとして残している。

## 5. CIの実行方針

低コストの検査から順に実行し、前段で失敗した場合は後続を実行しない。
標準順序は次のとおりである。

```text
Workflow Policy
  -> Gate Contract
  -> Format
  -> Lint
  -> Type Check
  -> Dead Code
  -> Architecture
  -> Static Analysis
  -> Secret Scan
  -> Supply Chain
  -> Unit Test
  -> Coverage
  -> Quality Gate
```

Secret ScanとWorkflow PolicyはStatic Analysisと同じ早期検査として扱う。
Supply Chainはネットワークを要するため、ローカルで完結する検査の後に置く。
Mutation Testingは必須の別Jobで実行する。E2Eはアプリケーションの存在を
確認した上で別Jobまたは定期実行とする。

ネットワークを要する検査 (`check:toolchain`、`check:deps`) はfail closedで
ある。到達できない場合は、検証できない状態を未承認として扱いFAILにする。

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
| Vulnerability Scan   | `pnpm audit`                   |
| Licence Compliance   | `pnpm licenses list`           |
| Workflow Policy      | `scripts/check-workflows.ts`   |
| Dependency Updates   | Dependabot                     |

Quality Gateの意味を保てる同等ツールへの置換は可能だが、置換理由と測定
方法をこの文書またはADRへ記録する。
