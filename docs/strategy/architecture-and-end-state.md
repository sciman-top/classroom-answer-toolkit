# Architecture And End State

## 结构

```text
PowerShell workflow / WPF
        |
        +-> spec assembler + rule compiler
        +-> AI gateway
        +-> Markdown validator + PDF renderer
        +-> review images + delivery manifest
```

PowerShell 是批处理主入口，WPF 是同一工具链的桌面入口。两者不复制生成或排版算法。

## 模块职责

- spec assembler：从平台、通用和学科源规范生成完整提示词。
- rule compiler：合并 subject-pack 规则和 profile，生成不可变 snapshot。
- AI gateway：读取有序试卷页图，以显式云出网调用模型并写入答案 Markdown。
- latex renderer：校验 Markdown，渲染 PDF，生成 review 页图和 manifest。
- WPF：选择输入、运行交付、展示日志和打开产物。

## 终态原则

- 不建立题库数据模型；输入文件只是本次任务输入。
- 不用复杂治理对象替代真实逐题比对。
- 语义正确性与排版正确性分开验收。
- 参考答案存在时优先做可审计比对；不存在时保留人工复核边界。
- 任何新模块必须直接缩短主链、提高答案正确率或提高 PDF 交付稳定性。
