# 历史证据与归档目录

本目录是历史产物的唯一归宿，按 `<kind>/<date-or-id>/` 分层，例如：

```text
history/
  delivery-runs/20260827-<run-id>/
  diagnostics/20260827-<run-id>/
```

只有明确需要长期保留、具备来源和真值边界的证据才进入这里。临时调试输出应放在 `artifacts/work/`，交付候选应放在 `artifacts/deliveries/<version>/`；三类内容不得混放。当前没有需要保留的历史归档，目录保留此说明作为固定路径锚点。
