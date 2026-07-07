# Visual-First Answering Architecture

## 1. 核心判断

跨学科、跨学段的最大错误源不是文本推理，而是看图。

因此视觉链不是渲染细节，而是产品主轴之一。系统必须把“视觉证据优先、双轨并行比对、高风险复核”做成真实工作流。

## 2. 输入与证据对象

### 输入统一对象

- `NormalizedPage`
- `VisualRegion`

### 聚合证据对象

- `ProblemEvidenceBundle`
- `TrackResult`
- `DecisionRecord`

### 既有视觉真值对象

- `problem-figure-asset`
- `figure-understanding-result`

`ProblemEvidenceBundle` 只聚合和引用既有对象，不复制、不替代。

## 3. 双轨定义

### Track A

多模态视觉直答：

- 高分辨率输入
- 多尺度 crop
- self-consistency 采样
- 直接产出候选答案与置信

### Track B

结构化证据求解：

- OCR
- 图元抽取
- 结构化证据
- 专用求解或规则校验

## 4. 默认门禁

1. 双轨不一致：必复核
2. 双轨一致但命中高风险视觉分类：强制复核或抽检
3. 证据链缺失、低置信、图号绑定不稳：不得自动放行
4. 局部图像模糊或视觉理解不确定时，默认不中断整份流程；先产出可确定部分，并把对应小问转入 `【疑】/待复核`
5. 只有当不确定性阻断大范围求解或影响主交付结论时，才暂停向用户提问

## 5. 高风险视觉题

- 刻度/仪表读数题
- 几何关系与坐标图
- 函数图像读图
- 作图题
- 实验装置图与电路图
- 多图多问绑定题
- 模糊、倾斜、遮挡、低清晰度题图

## 6. review 回写

视觉链必须能把结果回写为：

- `DecisionRecord`
- `review.visualDecisionRef`
- `review.feedbackRefs[]`

同时保留三种去向：

- 自动通过
- review 队列
- 局部 downgrade

## 7. 与其他文档的边界

- 产品目标与范围：见 [product-prd.md](./product-prd.md)
- 权威实施规格：见 [final-implementation-baseline.md](./final-implementation-baseline.md)
- 规范治理：见 [spec-evolution-adaptation-plan.md](./spec-evolution-adaptation-plan.md)
