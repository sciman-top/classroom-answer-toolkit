# 2017-2023 实跑交付归档迁移记录

**日期**: 2026-08-23　**源基线**: commit `be07e1a`　**性质**: 证据归档迁移（非删除）

## 事实

`正式交付/` 下 2017-2023 年份的 25 个运行目录（320 个文件：163 json / 132 md / 25 pdf，共 5,861,636 字节）已迁移至仓外归档。防改保护为 **soft guard only**：全部 payload 文件设 Windows 只读属性，且 SHA-256 manifest 可发现任意漂移；这不是 ACL 或不可变存储，不能阻止有意的属性清除与改写。

- 归档根：`D:\CODE\classroom-answer-toolkit-archive\正式交付-2017-2023\`
- 逐文件清单：归档根 `ARCHIVE-MANIFEST.txt`（每行 `sha256  相对路径`，与文件内容一并校验）
- 目录摘要：归档根 `ARCHIVE-INDEX.json`（每目录的 workflow 状态、文件数、字节数、目录级 SHA-256 摘要）
- 迁移时逐文件"复制后回读哈希比对"全部通过；另以独立工具（GNU sha256sum）抽样 md/json/pdf 各 1 件，manifest、仓内副本、归档副本三方哈希一致。

这些目录在 eval/real-paper 基线、docs、src、tests、scripts、tools 中均无引用；长期回归真值由 `eval/real-paper/baselines/` 的 hash 绑定基准与保留在库的 `正式交付/2024*`、`/2025*` 承担。

## 边界声明

2017-2023 归档仅证明各目录回执所记录的运行事实（输入哈希、阶段终态、产物绑定），不外推为答案语义正确、参考答案复核完成或教师验收。

## 目录索引

| 运行目录 | 回执状态 | 文件数 | 目录摘要(SHA-256 前 16 位) |
|---|---|---|---|
| 2017广州中考-original-完整主链实跑 | succeeded | 14 | fceecf6d9329d0e6 |
| 2017广州中考-v817修复后完整复跑 | succeeded | 14 | afb0ad7db0ecd5d6 |
| 2017广州中考-v818跨图修复验证 | succeeded | 14 | 61780f404ffe304b |
| 2017广州中考-v819结构化仪表修复验证 | succeeded | 14 | 03bbc9cbcbfe9d2d |
| 2018广州中考-v819聚焦修复验证 | succeeded | 14 | f200e11788c58b4d |
| 2018广州中考-v819连续执行 | succeeded | 14 | 9de38d9d5b81df59 |
| 2018广州中考-v819盲答聚焦细化验证 | succeeded | 14 | 5f9b0f4e65f037a6 |
| 2018广州中考-v819盲答聚焦修复验证 | succeeded | 14 | aace1255cb016dbc |
| 2018广州中考-v819视觉退化修复验证 | succeeded | 14 | 419137f3c5c0fcac |
| 2018广州中考-v820确定性几何验证 | succeeded | 14 | 27b1bd4aae2816ae |
| 2019广州中考-baseline连续执行 | succeeded | 14 | 0de8f7410bf14c74 |
| 2019广州中考-v820确定性指针验证 | succeeded | 14 | 61c5c6e725783514 |
| 2020广州中考-original-xhigh-实跑 | succeeded | 14 | 7a00fd7db8914eca |
| 2020广州中考-v816冻结输入最终验证 | succeeded | 14 | e7ff7738de7fad41 |
| 2020广州中考-v816文本层修复验证 | succeeded | 14 | b5ebd783e685f63d |
| 2020广州中考-v816修复后盲答验证 | succeeded | 14 | 2a167e5c1d499ddd |
| 2021广州中考-original-xhigh-实跑 | succeeded | 14 | 77164979de78f5d8 |
| 2021广州中考-v816冻结输入最终验证 | succeeded | 14 | 8a931090c7b1b562 |
| 2021广州中考-v816文本层修复验证 | succeeded | 14 | 50111dfacac383d5 |
| 2022广州中考-GPT56Sol-xhigh-重试 | succeeded | 9 | e06daad47edcd667 |
| 2022广州中考-original-三档复跑 | succeeded | 9 | 8e86ea56d638ff69 |
| 2022广州中考-original-xhigh复跑 | succeeded | 9 | a81c5e218fe7e5b7 |
| 2023广州中考-GPT56Sol-xhigh-实跑 | succeeded | 9 | 69dd086dd50889da |
| 2023广州中考-original-三档复跑 | succeeded | 9 | 8b4abf6abcb0fa51 |
| 2023广州中考-original-xhigh复跑 | succeeded | 9 | 9b134cea29cd172d |

## 回取方式

- 优先：从归档根按 `ARCHIVE-MANIFEST.txt` 校验后复制。
- 备份：`git log --all --oneline -- "正式交付/<目录名>"` 定位本切片之前的最后提交，从 Git 历史恢复。
