# Visual Evidence Eval

本目录记录视觉降错链路的契约级回归样例。

当前目标不是证明自动看图已经完成，而是锁住 fail-closed 规则：

- 高风险视觉题必须能追踪到 `questionRef -> figureRef -> cropRef -> evidenceRef`。
- 双轨一致但证据链缺失时，仍必须保持 `trusted=false`。
- `visualReviewPassed=null` 表示未裁定、自动降级或待复核。
- Track C validator 可以在 VLM 与 OCR/layout 一致时继续拦截证据缺口。

后续运行时落地后，本目录应扩展为可执行评测集，按 subject-pack、题型、图像质量和 `candidateSourceType` 分桶统计高风险误放行率。
