# Visual Evidence Eval

本目录记录视觉降错链路的契约级回归样例。

当前目标不是证明自动看图已经完成，而是锁住 fail-closed 规则：

- 高风险视觉题必须能追踪到 `questionRef -> figureRef -> cropRef -> evidenceRef`。
- 双轨一致但证据链缺失时，仍必须保持 `trusted=false`。
- `visualReviewPassed=null` 表示未裁定、自动降级或待复核。
- Track C validator 可以在 VLM 与 OCR/layout 一致时继续拦截证据缺口。

后续运行时落地后，本目录应扩展为可执行评测集，按 subject-pack、题型、图像质量和 `candidateSourceType` 分桶统计高风险误放行率。

`cases/delivery-aggregate/` 是合成、脱敏、禁云的交付级覆盖 fixture，用于验证：

- delivery manifest、snapshot、input 和 question inventory 的原始 bytes SHA-256 绑定；
- `sample-package.expectedQuestionRefs` 与逐题 DecisionRecord 的精确覆盖；
- 缺题、重复题、哈希漂移、阻断原因和未批准 lifecycle 保持 fail-closed；
- 完整合成覆盖可生成离线 `DeliveryDecisionAggregate.trusted=true`。

该正向 fixture 不写回 manifest，也未接入 WPF，不代表真实试卷全题识别、workflow integration 或 live acceptance。

`attach:aggregate` 在临时副本上使用该 fixture 验证受控附着：它在 canonical path + physical identity 双锁内先重算 aggregate 对应的 manifest preimage 和全部绑定源稳定快照，再写独立 receipt 记录 preimage/result SHA-256，并在最终替换前复核快照。测试同时覆盖 hardlink alias 串行化、manifest symlink 拒绝、部分锁获取与 token 清理、stale-lock 保留、receipt 后 manifest/source 漂移和回滚。当前仓库未把该能力接入 WPF 正向流程。
