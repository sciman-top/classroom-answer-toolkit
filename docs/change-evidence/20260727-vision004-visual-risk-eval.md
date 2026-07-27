# VISION-004 高风险视觉诊断闭环证据

## Goal

在不接 WPF、不启用 cloud egress、不使用真实试卷或 live provider 的前提下，建立可版本化、
可重放、按 subject-pack 独立统计的 synthetic visual-risk 难例闭环。

## Changes

- 新增严格分离的 `VisualRiskCaseInventory / VisualRiskDiagnosticReport` schema。
- 新增 6 个明确标记 `synthetic_fixture`、`allowCloud=false` 的 canonical cases；
  `math-answer / junior-physics-answer / senior-physics-answer` 各 2 个。
- inventory 绑定 evidence、track、expected DecisionRecord 的 raw-byte SHA-256；loader 验证
  schema、hash、realpath containment、递归 exact coverage、canonical path 与 `dev/ino` identity。
- `.gitattributes` 固定 visual-risk canonical JSON 为 LF，避免 Windows checkout 改写 hash authority。
- diagnostic compiler 重放当前 DecisionRecord，以 two-space JSON + trailing LF 比较 expected
  bytes，并按学科统计 false release、correct flag、binding 与 replay 指标。
- `ocr_image_conflict` 与 `binding_unstable` 成为显式 DecisionRecord reasons；结构化 OCR/image
  conflict 即使 `humanApproved=true` 也保持 fail closed，否定自由文本不会误判。
- `validate:assets` 对 committed report 做 semantic recompile，并强制三个学科分别满足阈值；
  `check-toolchain.ps1` 接入独立 visual-risk hotspot。

## Canonical Metrics

| subjectPack | cases | falseReleaseRate | correctFlagRecall | bindingAccuracy | replayPassRate |
| --- | ---: | ---: | ---: | ---: | ---: |
| math-answer | 2 | 0 | 1 | 1 | 1 |
| junior-physics-answer | 2 | 0 | 1 | 1 | 1 |
| senior-physics-answer | 2 | 0 | 1 | 1 | 1 |
| all-subject-packs | 6 | 0 | 1 | 1 | 1 |

Canonical report 继续固定：

- `readinessBoundary.toolchainControl=not_verified`
- `readinessBoundary.restrictedEgressControl=not_verified`
- `readinessBoundary.eligible=false`
- `optimizationCandidateRefs=[]`
- `stopReason=synthetic_visual_risk_diagnostic_only_no_optimizer`

## Independent Review

- reviewer verdict: `APPROVE`
- final findings: `0 Critical / 0 Required`
- 已修复：OCR conflict 未进入 review gate、自由文本否定误判、expected/actual conflict 未绑定、
  nested authority coverage 缺口、hardlink physical identity 复用。
- Optional：CLI repo-external output 的 junction/symlink ancestor 与 hardlink alias 可后续增加专项
  regression；当前实现已有 canonical missing-ancestor containment 与 `nlink` guard，不阻断本切片。

## Verification

固定顺序执行，全部 exit code `0`：

1. `dotnet build ClassroomToolkit.sln -c Debug`
   - `0 warnings / 0 errors`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
   - `116 passed / 0 failed / 0 skipped`
3. `npm --prefix tools/rule-compiler run validate:assets`
   - `91 asset files / 3 subject packs / 3 snapshots`
4. `npm --prefix tools/rule-compiler run validate:cross-subject`
   - contract passed with `snapshot-fb15fdf69827ecf1`
5. `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`
   - visual-risk `12/12`
   - DecisionRecord `14/14`
   - gateway synthetic vision contract `6/6`
   - delivery aggregate `59/59`
   - sample-flywheel `72 passed / 1 capability skip`
   - answer-generator `8/8`
   - junior/senior physics 与 math answer eval 全部通过
   - latex renderer smoke、OCR imports、snapshot compile 与 cross-subject hotspot 全部通过
   - `.env.example` gateway config validated with cloud egress disabled and missing secrets explicitly allowed

未单独追加 `npm --prefix tools/ai-gateway run validate:config`，因为本切片未修改 gateway；同一
config validation 已由最终 `check-toolchain.ps1` 实际执行并通过，不是以 N/A 替代验证。

## N/A Records

### sample-flywheel symlink capability

- classification: `platform_na`
- reason: 当前 Windows host 创建测试 symlink 返回 `EPERM`，该单例被 Node test 标记 skip。
- alternative_verification: canonical path escape、nested coverage、hardlink identity 与 junction 相关既有测试继续执行；visual-risk hardlink negative test 本机通过。
- evidence_link: `docs/change-evidence/20260727-vision004-visual-risk-eval.md#verification`
- expires_at: `2026-08-27`
- recovery_condition: host 开放非管理员 symlink 创建能力或在具备该能力的 CI 上执行时恢复该用例。

### answer-graphics default smoke

- classification: `gate_na`
- reason: `answer-graphics` 仍是明确的 experimental surface，不属于默认产品门禁或 VISION-004 write set。
- alternative_verification: visual evidence schemas、DecisionRecord、visual-risk report、renderer smoke 与三学科 answer eval 均已执行。
- evidence_link: `docs/change-evidence/20260727-vision004-visual-risk-eval.md#verification`
- expires_at: `2026-08-27`
- recovery_condition: answer-graphics 经决策记录升级为默认承诺，或后续切片实际修改该工具时恢复真实 smoke gate。

## Truth Boundary

- repo-side done: VISION-004 synthetic visual-risk contracts、fixtures、diagnostic report、assets/hotspot
  与 evidence 已形成可验证闭环。
- gateway verified: 仅既有 config + synthetic request/failover contracts 在 toolchain 中通过；本切片
  未执行 live probe，也未新增 live authority。
- workflow integrated: `false`，未接 WPF 或真实生成/复核工作流。
- live accepted: `false`，未使用真实试卷、教师/学生数据或 live provider。
- still open: 真实 visual/OCR/VLM 质量、合法 historical/live authority、trusted controls、restricted
  egress attestation、WPF workflow integration 与 workstation/live acceptance。

## Rollback

回滚 VISION-004 实现提交，删除 visual-risk schemas/compiler/tests/fixtures/report，并恢复
DecisionRecord reason 投影、assets/hotspot、eval README/dataset、visual-risk LF attribute 与本证据文件。不得回滚
VISION-003/005/006、文档设计提交 `1b3c956` 之前的既有视觉链，也不得修改 `.env`、仓外 receipt
或 cloud-egress 配置。
