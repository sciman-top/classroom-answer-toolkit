# Visual Structure Extraction Runtime Plan

## 1. 目标

`VISION-008` 在 VISION-007 的 canonical 2x crop 上建立首个 provider-neutral、deterministic local structure extraction runtime。它只产生可重验的像素级候选图元，为后续 OCR/layout/Track B 提供输入底座，不把几何检测冒充文本识别、学科语义或解题能力。

## 2. 领域合同

- `VisualStructureExtractionRequest`：绑定 committed VISION-007 preprocessing result、选定 2x crop 的 raw-byte/decoded RGB pixel SHA-256、`synthetic_fixture/public`、固定 extraction policy 和 `allowCloud=false`。
- `VisualStructureExtractionResult`：绑定 request/preprocessing/crop bytes，输出 `LineSegmentCandidate[]`、`ConnectedRegionCandidate[]`、`TextRegionCandidate[]`、algorithm parameters 和 OpenCV provenance。
- `LineSegmentCandidate`：Hough line detector 的规范化像素端点，不是 axis、wire、tick 或几何关系。
- `ConnectedRegionCandidate`：binary foreground connected component 的 bbox/area，不是元件、字符或题目区域。
- `TextRegionCandidate`：只满足固定像素尺寸/面积启发式的 connected region；`recognizedText` 不存在，不能解释为 OCR output。

结果固定 `ocrDisposition=not_attempted`、`semanticDisposition=not_inferred`、`trackDisposition=not_integrated`。不得复用或生成 `FigureUnderstandingResult`、`ProblemEvidenceBundle` 或 `TrackResult` authority。

committed case inventory 是唯一 runtime admission authority，精确覆盖 `math-answer / junior-physics-answer / senior-physics-answer` 各一个 case，并以 raw-byte SHA-256 绑定 request、VISION-007 preprocessing result 和 expected extraction result。

## 3. Deterministic runtime

- 输入固定为 VISION-007 result 中 `scale=2` 的 canonical PNG crop。
- Pillow decode 为 RGB 并重验 pixel hash；OpenCV 转 grayscale。
- foreground 使用固定 binary threshold `200` 与 `THRESH_BINARY_INV`。
- connected regions 使用 8-connectivity、minimum area `8`，按 `y/x/width/height/area` 排序并稳定编号。
- line candidates 使用 Canny `50/150` 与 `HoughLinesP(rho=1, theta=pi/180, threshold=30, minLineLength=20, maxLineGap=4)`；端点规范化、去重、排序后稳定编号。
- text region candidates 只从 connected regions 通过冻结的 bbox/area bounds 派生，并保留 `heuristic_only=true`。
- stable JSON 固定 two-space indentation 与 trailing LF；CLI 只允许仓外新目录并原子发布。
- schema、canonical path、physical alias、inventory coverage、source/request/result hash、pixel hash、algorithm parameters、排序/id、counts 或 computed fields 漂移均 fail closed。

## 4. 验收

1. 三个 case 都产生非空 line/connected-region candidates，并 byte-exact 重放 expected result。
2. request 不能选择 1x/未知 crop，不能自报另一个 preprocessing result 或 caller-selected inventory。
3. text candidates 没有 recognized text；任何尝试升级 `ocrDisposition/semanticDisposition/trackDisposition` 都被 schema/runtime 拒绝。
4. schemas 与 fixtures 纳入 `validate:assets`，focused runtime tests 纳入 `check-toolchain`。
5. 固定顺序项目门禁全部通过。

## 5. 排除项与真值边界

本切片不运行 RapidOCR/Tesseract/VLM，不识别文字，不判断坐标轴/刻度/图例/电路元件，不自动绑定题号/图号，不生成 `FigureUnderstandingResult / ProblemEvidenceBundle / TrackResult / DecisionRecord / OptimizationCandidate`，不接 WPF、gateway、readiness、trust/approval 或 cloud egress，不消费真实试卷、教师或学生数据。

完成只表示 repo-side structural primitive extraction contracts 与 synthetic fixtures 已验证。Gateway 仍只有 config/synthetic contract verified；workflow 未集成；live 未验收。`ReadinessControlReceipt` 保持 `unattested_local_record`，controls 保持 `not_verified`，`eligible=false`。

## 6. 回滚

回滚 `VISION-008` 实现提交，只删除本切片 schemas、tool、request/result/inventory fixtures、validator/hotspot wiring、strategy 增量和 evidence。不得修改 VISION-007 PNG/preprocessing authority、`.env`、`tools/ocr/.venv`、gateway、readiness receipt 或其他 canonical samples。
