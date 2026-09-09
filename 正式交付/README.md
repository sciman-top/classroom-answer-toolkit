# 正式交付

本目录只存放面向使用者的最终交付物，目录结构与 `习题/` 一致：一个学科目录，按年份命名的扁平文件。

- `广州物理中考参考答案/`：每年一组 `<年份>广州中考参考答案` 三格式交付物，内容同源：
  - `.md` 为生成真源，与 `交付过程归档/` 内对应 run 目录的 Markdown 逐字节一致；
  - `.pdf` 由 latex-renderer（Markdown-It + KaTeX + 本地 Chromium）按 `classroom` profile 渲染；
  - `.docx` 由 `npm --prefix tools/latex-renderer run export:docx -- --markdown <答案.md>` 经 pandoc 生成：LaTeX 公式转为 Word 原生 OMML 公式（与 PDF 同源同内容），版式由 `tools/latex-renderer/assets/docx-reference-classroom.docx` 模板约束（A4、微软雅黑、与 PDF 一致的标题层级与颜色）。
- 生成候选、复核报告、清单、快照、运行回执和渲染检查图统一存放在仓库根目录 `交付过程归档/`。
- “正式交付物”表示选定的唯一交付文件，不自动表示已经获得教师验收；教师验收仍以对应验收记录为准。

当前 2025 年版本具有教师 `accepted` 记录；其他年份不得仅凭本目录位置外推为教师已验收。
