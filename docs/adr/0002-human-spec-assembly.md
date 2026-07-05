# ADR 0002: Human Spec Assembly

## Status

Accepted

## Decision

完整版、调用版、`prompts/<subject-pack>/spec.md` 统一由 assembler 自动生成。

## Consequences

- 不能再手工同步 generated 文件
- 需要新增 assembly 清单与 drift 校验
