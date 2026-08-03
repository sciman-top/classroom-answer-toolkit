# Visual Preprocessing Runtime Plan

## 1. 目标

`VISION-007` 建立首个 provider-neutral、确定性的本地图像预处理 runtime。它把用户显式选择的 synthetic source image 和 integer `page_pixel` bbox 转换成 hash-bound 1x/2x crops，供后续 Track A/Track B 消费，但不把预处理冒充视觉理解。

## 2. 合同

`VisualPreprocessingRequest` 与 OCR、layout、答案生成和交付请求严格分离，并绑定：

- `fixtureKind=synthetic_fixture` 与 `dataClassification.level=public`
- 仓库相对 source path、source raw-byte SHA-256 和 decoded RGB pixel SHA-256
- 完整包含在 decoded image 内的 integer `page_pixel` bbox
- 精确 scales `[1, 2]`
- `egressPolicy.allowCloud=false`

`VisualPreprocessingResult` 绑定 request raw-byte SHA-256、source authority、一个 `NormalizedPage` 和一个 `VisualRegion`。crop artifacts 必须记录 canonical path、raw-byte SHA-256、decoded RGB pixel SHA-256、dimensions、scale、interpolation 和 local engine provenance。

committed case inventory 是 canonical admission authority。它必须精确覆盖三个公开 synthetic fixtures，`math-answer`、`junior-physics-answer`、`senior-physics-answer` 各一个，并以 raw-byte SHA-256 绑定每个 request 和 expected result。

## 3. Runtime

- 使用既有 `tools/ocr/.venv` Python runtime 与 OpenCV/Pillow；不得运行 bootstrap。
- 统一 decode 为 deterministic RGB 后再计算 pixel hash。
- 1x crop 保持 source pixels；2x crop 使用一种固定 interpolation 并写入 result。
- stable JSON 固定 two-space indentation 与 trailing LF。
- image/JSON 均原子写入。CLI output 只允许位于仓库外的新目录，且不得 alias source 或 canonical authority file。
- reverify 必须拒绝 schema、inventory coverage、path containment、physical alias、source/request/output raw-byte hash、decoded-pixel hash、bbox、scale、dimension、interpolation、provenance 或 computed-field drift。

## 4. 验收

1. 三个脱敏 synthetic bitmaps 分别表达 instrument scale、circuit/experiment label 和 coordinate/function graph。
2. 每个 case 都可确定性重放 byte-bound 1x/2x crops 与 expected result。
3. bbox 越界、unsupported scales、cloud egress、non-public/non-synthetic data、path escape/alias 和 authority drift 均 fail closed。
4. shared schemas 纳入 `validate:assets`；focused runtime tests 纳入 `check-toolchain`。
5. 固定顺序项目门禁全部通过。

## 5. 排除项与真值边界

本切片不做 OCR/layout 语义、自动 region detection、deskew/denoise 推断、Track A/B/C 求解、WPF 集成、gateway 调用、cloud egress、trust/approval 变更、readiness 更新或优化。它不消费真实试卷、教师或学生数据，且永不生成 `OptimizationCandidate`。

完成只表示 repo-side preprocessing contracts 与 deterministic synthetic fixtures 已验证。Gateway 仍只有 config/synthetic contract verified；workflow 未集成；live 未验收。`ReadinessControlReceipt` 保持 `unattested_local_record`，toolchain/restricted-egress controls 保持 `not_verified`，`eligible=false`。

## 6. 回滚

回滚 `VISION-007` 实现提交，只删除本切片 schemas、tool、synthetic fixtures、generated expected artifacts、validator/hotspot wiring、strategy 增量和 evidence。不得修改 `.env`、OCR environment、gateway configuration、既有 visual evidence authorities、readiness receipts 或其他 canonical sample assets。
