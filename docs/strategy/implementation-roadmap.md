# Implementation Roadmap

## M0 文档与真值收口

- 建立 `prompts/specs/README.md`
- 建立 `docs/strategy/` 与 `docs/adr/`
- 旧根文档迁为跳转壳

## M1 规范分层与自动汇编

- 建立 `commons/`、`compiled/`、`assemblies/`
- 实现 human spec assembler
- 让 `spec.md` 与 compiled 完整版由脚本生成

## M2 多学段物理 subject-pack

- `physics-answer -> junior-physics-answer`
- 新增 `senior-physics-answer`
- 去除产品与工具中的单学科默认偏置

## M3 snapshot 与资产校验收口

- `humanSpec` 指向 compiled 完整版
- `validate-assets` 校验 generated 文件无漂移
- 按 subject-pack 校验 snapshot、eval、delivery

## M4 视觉高风险治理

- 视觉双轨
- 证据对象模型
- 高风险题与哨兵样例
- review 流程与抽检策略
