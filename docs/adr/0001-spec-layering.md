# ADR 0001: Spec Layering

## Status

Accepted

## Decision

采用 `platform -> commons -> subjects -> compiled` 的人类规范分层。

## Consequences

- 源规范更易维护
- 完整版可自动生成
- 初期会保留少量 bootstrap 重复，后续逐步抽离
