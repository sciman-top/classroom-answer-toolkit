# Classroom Answer Delivery

本上下文定义试卷参考答案从候选生成到课堂验收的核心语言，用于避免把技术成功、参考复核和教师验收混为同一状态。

## Language

**Source Exam**:
教师提供、作为本次答案任务事实依据的原始试卷。
_Avoid_: 入库试卷、题库样本

**Blind Candidate**:
未接触权威参考答案时生成的完整答案 Markdown；它是待复核候选，不是可信答案。
_Avoid_: 标准答案、最终答案

**Visual Audit**:
只依据 Source Exam 的页面图或题目局部图，对 Blind Candidate 做独立视觉复查；完成审计不等于消除视觉错误。
_Avoid_: 视觉验收、自动正确性证明

**Reference Review**:
使用权威参考答案逐题比较并修正 Blind Candidate 的过程。
_Avoid_: Blind Audit、Teacher Acceptance

**Reference-reviewed Delivery**:
经过 Reference Review、规则校验和排版后生成的 Markdown、PDF、review 页图与 manifest；它仍不自动代表教师已验收。
_Avoid_: Trusted Delivery、Live Accepted

**Teacher Accepted**:
教师对指定 Reference-reviewed Delivery 完成实际内容与课堂使用验收的状态。
_Avoid_: Rendered、Gateway Verified、Reference Reviewed

**Delivery Manifest**:
绑定一次交付的输入、snapshot、Markdown、PDF 和 review 产物的记录；它证明产物关系，不证明答案语义正确。
_Avoid_: Acceptance Certificate、Answer Truth

**Subject Pack**:
某一学段学科的提示词、规则、排版 profile、snapshot 和回归合同集合。
_Avoid_: Question Bank、Course Database
