# Senior Physics Answer Sentinel Suite

本目录只证明 `senior-physics-answer` subject-pack 的独立 snapshot、两种 profile、首屏视觉输出
和高中物理特异 validator 规则。共享 Markdown、renderer、图形插入和 delivery 合同由主产品包
`eval/junior-physics-answer/` 运行一次，不在这里机械复制。

保留的 sentinel：

- `smoke-answer`：classroom/compact validator、render、review、visual 和 delivery；
- `figure-binding`：多图小问绑定；
- `instrument-reading-priority` 与 `instrument-range-scale-check`：仪表读数规则；
- `necessary-derivation`：必要推导规则。

运行入口仍为 Full verifier；本套件不是对 Junior 结果的隐式继承，所有 sentinel 都使用
Senior 自己的 manifest、规则、profile 和 compiled snapshot。
