# 样例交付

本目录是回归验证、演示和工具链示例用的合成样例区，**不是真实交付物**；真实生产交付只进 `正式交付/`。角色定义见 `prompts/specs/platform/试卷参考答案交付规范-平台总则-v1.0.md` §2。

- `index.json`：样例索引（schemaVersion 1.0），逐样例绑定 `sampleId`、`subjectPack` 与 `packageSha256`。
- `structured/<subject-pack>/<sampleId>/`：合成样例包（`sample.json`、`problem.md`、`reference.md`）及其候选与负例变体（`*.negative-candidate.json`），当前为 `math-answer/synthetic-linear-equation`。

修改样例内容必须重新计算并同步 `index.json` 的哈希绑定；不得把真实试卷或真实交付物移入本目录。
