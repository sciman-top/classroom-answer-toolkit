# Spec Assembler

将 `prompts/specs/assemblies/*.json` 装配为：

- `prompts/specs/compiled/*.md`（运行时唯一 prompt 文本，经 manifest `sourceOfTruth.humanSpec` 引用）


默认命令：

```powershell
npm --prefix tools/spec-assembler run assemble:all
```
