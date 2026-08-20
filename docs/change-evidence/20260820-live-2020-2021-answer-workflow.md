# 2020/2021 广州中考物理盲答与冻结输入验证证据

## 目标与验收边界

- 目标：对本地 2020、2021 广州中考物理原卷执行 `原卷盲答 -> 4x 无参考视觉审计 -> 权威参考答案复核 -> Markdown 校验 -> PDF 渲染/逐页检查 -> delivery manifest`，针对实测错误修复提示词和 workflow，再以 fresh run 验证。
- 原卷和参考答案均来自用户本地目录 `广州物理中考试卷/`，未修改、未纳入本次实现 write set。
- `blind_answer_trusted=false`：单次 Blind Candidate 和无参考视觉审计仍有已记录的视觉 grounding 波动。
- `reference_reviewed_delivery_complete=true`：两年均已完成权威参考复核、校验、渲染和 manifest 生成。
- `teacher_or_classroom_accepted=false`：本证据不替代教师、课堂或现场验收。

## 发现、根因与修复

首次实跑中，2020 盲答把第 19 题题干的“甲瓶中的油比乙瓶中的多”反转为质量相同，并误读第 23 题电压表；2021 盲答错答第 9 题，首次视觉审计还把正确的第 12 题 `C；向上` 改坏。后续样本又暴露 2021 第 8 题电磁力方向波动。

实测证明只增加 prompt 规则不够：2020 的 prompt-only fresh run `a7440a20528d4605b0111fa39031e3d2` 仍错答第 19、23 题，并把第 16 题从正确答案回归为 `5 dm`。根因之一是 Blind 输入只含整页位图，而原卷 PDF 已有可提取文本层；另一个根因是复杂视觉方向和刻度读数仍依赖不稳定的图形绑定。

本轮实现修复：

- 将初中物理组合规范升级到 v8.16，加入题干事实账本、开关/故障逐状态验证、模拟表双向数格、杠杆候选力矩枚举和电磁力五项显式绑定规则。
- `answer-request.mjs` 新增 `--source-text-file`；文本层只辅助题号、题干、表格数据和数量关系，图形、刻度、接线和方向仍以原卷页图为最高依据。
- `run-live-answer-workflow.ps1` 汇总原卷文本层并同时传给 Blind 和 Reference Review。
- 新增 workflow 输入冻结检查。运行开始时记录原卷、参考答案和 prompt receipt；每个 AI phase 及交付前复核 SHA，漂移即 fail closed；最终 receipt 不再重读结束时输入冒充开始时输入。

输入冻结修复来自一次真实证据缺陷：2021 的中间 run `c1294dbeaded43d8bc39671f832d8b52` 中，各 AI phase 使用 prompt SHA `48d0c772cd91fae310b9092888e807ba49b747c182d8e4b96fd1fc069056cae5`，但结束时 workflow receipt 记录了随后装配的 `b84928ea68f140b1cdf0afb30f4819ddbbc5dac3578b64f86ac48c3eb0b7b3f4`。因此该 run 只能证明文本层 seam，不能证明最终 v8.16 电磁规则；最终结论以下面的冻结输入 fresh runs 为准。

## 最终冻结输入 fresh runs

| 年份 | Run ID | Workflow | Prompt SHA-256 | 原卷 SHA-256 | 参考答案 SHA-256 | 原卷文本层 SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 2020 | `201223496dbe4fdf8ee0813e09a6b328` | `succeeded` | `b84928ea68f140b1cdf0afb30f4819ddbbc5dac3578b64f86ac48c3eb0b7b3f4` | `95b86d3ae8415ab714ff775ae34c6ff695fd30e3fd1ef14caec5689114061800` | `d73824b34e222287286cb23caf3f5900b8509fd1e5088cf1190d6de5a79fc770` | `d990a82af012aa18992d6df08477ebeaeff86cec0397ddc2caa8a50ddcc8f361` |
| 2021 | `e2df3b5e2eb64fe2a3cfd98268fd790b` | `succeeded` | `b84928ea68f140b1cdf0afb30f4819ddbbc5dac3578b64f86ac48c3eb0b7b3f4` | `d4abb8aa48663b772abb1ee5b15935b065b8931af47bd3c62d89bdef1f83989c` | `e157ab8a16233acd68000299b427f814687035ec1b76384f69f1cf446ed04578` | `4525330d28ae0e7b0e09bb399fa3e0bf2ee8a934469dd960f6fb88479798da3f` |

两次最终 run 的 workflow receipt、Blind、Visual Findings 和 Reference Review summary 均记录完全相同的 prompt SHA `b849...b3f4`，且 workflow 成功前再次通过冻结检查。

| 年份 | Blind SHA-256 | Visual Merge SHA-256 | Reference-reviewed Markdown SHA-256 | PDF SHA-256 |
| --- | --- | --- | --- | --- |
| 2020 | `a25309ee82f356516337f32cbe3284780894b8e4a45002c0182c51d624df7bf2` | `59d28711356ede384616c984742fdc1db0c1d38e59d19051fd4b8a51c4eb240f` | `bfa8e5f40ed9525acea948a212a4eab3075ccc7087f71b2d2d44ac05d92aea21` | `4a374374298f64fd9a9fa540aeec4844592c15eba7c3969aefc70f440d831c0c` |
| 2021 | `70ad8bd93a0bced86ff4dd1f5b6d87717009406a35ccb2d10d175beef1460d4b` | `70ad8bd93a0bced86ff4dd1f5b6d87717009406a35ccb2d10d175beef1460d4b` | `cdb5ee2b624bfd322d46053a17ae730800e650235ce8c906af38e50f5294198b` | `663f0618fdada29f2770f1e46f442bb16a38d3e75a17bb1de6d88bcb1f2e82a6` |

## 题目级结果

### 2020

- Blind 第 19 题正确保留了 `m_甲>m_乙` 和 `Δt_甲>Δt_乙`，证明原卷文本层对题干事实反转有 fresh 正向效果。
- Blind 第 16 题仍波动为 `5 dm`；无参考视觉审计通过力矩枚举修正为权威值 `1 dm`。
- Blind 第 23 题读为 `1.4 V`；无参考视觉审计改成 `1.6 V`，仍非权威值 `1.5 V`。Reference Review 才修正为 `1.5 V`。因此 `targeted_instrument_grounding_closed=false`。
- Reference Review 还补足第 13 题以对称点确定入射点的作图链，以及第 24 题同一份液体的量筒/电子秤读数步骤；其余大量 diff 是等价公式展开、必要条件补充或排版改写。

### 2021

- Blind 选择题完整命中权威序列 `C、A、B、D、A / B、D、D、C、C`，包括此前开放的第 8 题 `D` 和曾错答的第 9 题 `C`。
- Blind 第 12 题保持 `C；向上`，未复现首次视觉审计的错误反转。
- 4x 无参考视觉审计对第 8 题明确报告端点追线证据不足，没有猜测改判；Visual Merge SHA 与 Blind SHA 相同，证明 fail-closed merge 保留了正确候选。
- Reference Review 没有更改选择题或第 12 题，主要补足第 17 题接线极性和第 18 题器材、表格与控制变量；其余多为等价措辞和排版改写。
- 该 fresh sample 支持 `targeted_electromagnetic_prompt_improved=true`，但单次成功不支持把整卷 Blind 或通用视觉审计标为 trusted。

## PDF 渲染检查

最终两份 PDF 均为 3 页。2026-08-20 对共 6 张 2x review PNG 逐页检查：中文、题号、表格、KaTeX 公式和单位清晰，无裁切、重叠、乱码、黑块、裸 `$` / `\\frac` / `\\mathrm` 或公式溢出。

两份 PDF 的最后一页内容较少、留白明显；这是非阻断的分页密度债务，不影响可读性，也不等于教师或课堂视觉验收。

## 当前真值边界

- `repo_verified=true`：冻结 write set 后，solution build、44 项 .NET 测试、32 项 AI gateway 测试和 junior-physics Core 门禁均通过。
- `live_workflow_succeeded=true`：两年冻结输入 fresh runs 均成功。
- `reference_reviewed_delivery_complete=true`：两年 Markdown、PDF、snapshot、manifest 和差异报告齐全。
- `blind_answer_trusted=false`。
- `targeted_instrument_grounding_closed=false`：2020 第 23 题仍依赖权威参考复核。
- `targeted_electromagnetic_prompt_improved=true`：2021 第 8 题在本次 fresh Blind 中正确，视觉审计证据不足时未误改；不外推为通用闭环。
- `teacher_or_classroom_accepted=false`。

## 冻结后的最低充分验证

| 顺序 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0；0 warnings，0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build` | exit 0；44 passed，0 failed，0 skipped |
| 3 | `npm --prefix tools/ai-gateway run test:answer` | exit 0；32 passed，0 failed |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer` | exit 0；assets 与 classroom/compact snapshots 通过 |

Core 没有运行 cross-subject、delivery smoke 或三科 eval；本切片未修改 shared spec、跨学科合同或 release 面，因此不外推为 Full gate。

## 回滚

只回滚本切片的 v8.16 prompt/生成物、原卷文本层接入、workflow 输入冻结检查、对应测试、2020/2021 实跑交付和本证据文档。保留用户原卷、参考答案、`.env`、provider 配置及其他年份交付。
