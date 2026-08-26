import fs from "node:fs";
import path from "node:path";

import { repoRoot } from "./validate-config.mjs";

export function resolveDefaultPromptPath() {
  const manifestPath = path.join(repoRoot, "prompts", "junior-physics-answer", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const humanSpec = manifest?.sourceOfTruth?.humanSpec;
  if (typeof humanSpec !== "string" || humanSpec.length === 0) {
    throw new Error(`Default subject pack manifest lacks sourceOfTruth.humanSpec: ${manifestPath}`);
  }
  return path.resolve(path.dirname(manifestPath), humanSpec);
}

export function resolveImageEvidenceLabels(imagePaths, role = "source") {
  const roleLabel = role === "reference"
    ? "Reference answer"
    : role === "audit"
      ? "No-reference visual audit source"
      : "Source exam";
  const manifestMaps = new Map();
  // Windows paths differ by case casing between runs and archives; entry paths in
  // a manifest may be relative to the manifest itself. Canonicalize both sides per
  // platform, then warn loudly on a miss: silently dropping measured geometry
  // labels would strip deterministic evidence from the model prompt.
  const canonicalEntryPath = (manifestDirectory, entryPath) => {
    const resolved = path.isAbsolute(entryPath)
      ? path.resolve(entryPath)
      : path.resolve(manifestDirectory, entryPath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return imagePaths.map((imagePath) => {
    const directory = path.dirname(imagePath);
    if (!manifestMaps.has(directory)) {
      const manifestPath = path.join(directory, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        manifestMaps.set(directory, null);
      } else {
        let manifest;
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch (error) {
          throw new Error(`Image evidence manifest is invalid: ${manifestPath}: ${error.message}`);
        }
        const entries = Array.isArray(manifest.pages) ? manifest.pages : [];
        manifestMaps.set(directory, new Map(entries
          .filter((entry) => typeof entry?.imagePath === "string")
          .map((entry) => [canonicalEntryPath(directory, entry.imagePath), entry])));
      }
    }
    const entry = manifestMaps.get(directory)?.get(canonicalEntryPath(directory, imagePath));
    if (!entry) {
      console.warn(`[gateway] No image-evidence manifest entry for ${imagePath}; continuing without deterministic labels.`);
      return null;
    }
    if (entry.kind === "focus-region") {
      const question = entry.questionNumber ? `; question ${entry.questionNumber}` : "";
      const analogReading = entry.analogMeterReading?.status === "measured"
        ? ` Deterministic source-pixel geometry measured range ${entry.analogMeterReading.rangeMin}-${entry.analogMeterReading.rangeMax}`
          + ` across ${entry.analogMeterReading.divisions} divisions, pointer at division ${entry.analogMeterReading.nearestDivision}`
          + ` (raw ${entry.analogMeterReading.rawDivision}), giving ${entry.analogMeterReading.value}.`
        : entry.analogMeterReading
          ? " Deterministic analog-meter geometry was uncertain; do not infer a value from it."
          : "";
      const linearScaleReading = entry.linearScaleReading?.status === "measured"
        ? ` Deterministic source-pixel linear-scale geometry measured range ${entry.linearScaleReading.rangeMin}-${entry.linearScaleReading.rangeMax}`
          + ` across ${entry.linearScaleReading.divisions} divisions, indicator at division ${entry.linearScaleReading.nearestDivision}`
          + ` (raw ${entry.linearScaleReading.rawDivision}), giving ${entry.linearScaleReading.value}.`
        : entry.linearScaleReading
          ? " Deterministic linear-scale geometry was uncertain; do not infer a value from it."
          : "";
      const opticalRayGeometry = entry.opticalRayGeometry?.status === "measured"
        ? ` Deterministic source-pixel ray geometry found the post-lens rays ${entry.opticalRayGeometry.relation.replaceAll("_", " ")}`
          + ` than the pre-lens continuation (intersection positions ${entry.opticalRayGeometry.beforeIntersectionY} and ${entry.opticalRayGeometry.afterIntersectionY}).`
        : entry.opticalRayGeometry
          ? " Deterministic optical-ray geometry was uncertain; do not infer a lens type from it."
          : "";
      return `${roleLabel} focused crop: ${entry.focusLabel}; source page ${entry.pageNumber}${question}.`
        + analogReading
        + linearScaleReading
        + opticalRayGeometry
        + " Inspect only the named visual part in this crop; all geometry is source evidence, not an answer key.";
    }
    const question = entry.questionNumber ? `; question ${entry.questionNumber}` : "";
    const tile = entry.tileIndex && entry.horizontalIndex
      ? `; region ${entry.tileIndex}/${entry.tileCount}, horizontal tile ${entry.horizontalIndex}/${entry.horizontalTileCount}`
      : "";
    return `${roleLabel} page crop: page ${entry.pageNumber}${question}${tile}.`;
  });
}

export function buildPrompt(promptFile, review = {}) {
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Prompt file not found: ${promptFile}`);
  }
  const specification = fs.readFileSync(promptFile, "utf8").trim();
  if (review.mode === "semantic_review_findings") {
    const indexedChoiceCandidate = buildIndexedChoiceCandidate(review.candidateMarkdown);
    return `${specification}\n\n---\n\n# 无参考答案语义复核任务\n\n` +
      `所附 ${review.sourcePageCount} 张图片和可选文本层来自原始试卷，不是参考答案。下面的盲答候选不可信，只能用于定位待复核题号；不得沿用其结论作为证据。\n` +
      (review.sourceText
        ? "原卷 PDF 文本层用于精确核对题干、图号、表格数据、器材名称和数值条件；图形、刻度、接线和方向仍以原卷页图为准。两者出现表面冲突时，必须回查原卷页图或标【语义证据不足，需复核】，不得凭题型惯例臆改原卷事实。\n\n"
          + `## 原卷 PDF 文本层（辅助）\n\n${review.sourceText.trim()}\n\n`
        : "") +
      "抛开候选结论，重新独立解答全部选择题，以及所有涉及状态变化、惯性方向、故障电路、能量分段、物态变化、透镜类型、受力和定性比较的小问。只输出语义复核发现报告，不得重写完整答案。\n" +
      "每个选择题必须逐项核对 A、B、C、D：分别写一句最短的成立或不成立依据，再给独立结论。过程或图像题必须按题型写出可检查的中间结构：状态题列初态—变化—终态；方向题列坐标系—相对位移—物理关系—方向；故障电路列故障前后各支路状态、仪表测量对象和比较量；图像题必须按横轴所有拐点划分每个区间，逐段写自变量趋势、因变量趋势以及由此推出的物理量变化，禁止把先变化后恒定压缩为单一趋势；透镜题先逐字确认原卷标注的透镜类型，再写入射与折射光线发散或会聚变化。电路、表格或图像数值题必须逐小问列出题目指定条件下的每个直接读数和由其计算的量；不得只校验最后一问或用前一小问的数值替代当前条件。\n" +
      "下面的逐题候选索引由程序从分组答案串确定性展开，比较时必须使用它，不得凭记忆、位置直觉或正文重建候选字母。每个选择题必须以 `### 第N题` 开头，并分别输出独立行 `独立结论：X`、`候选结论：Y` 和标签。\n" +
      `${indexedChoiceCandidate}\n\n` +
      "若独立结论与候选不同，只有同时具备【语义确认修正】、候选具体字段、原题可见事实、完整的上述题型结构和“建议修正”时才可进入合并；任一环节无法确认则标【语义证据不足，需复核】，不得猜测。标签必须与正文结论一致：正文推理一旦推出候选需要变化，禁止标【语义一致】，必须按证据充分程度标【语义确认修正】或【语义证据不足，需复核】。与候选一致的题写【语义一致】并给最短依据。\n" +
      "图片标签中的 measured 确定性几何结果属于原卷像素测量，可直接作为对应读数或几何事实；标签为 uncertain 时不得推断数值。不要输出参考答案、内部思维过程、JSON 或代码围栏。\n\n" +
      `## 盲答候选\n\n${review.candidateMarkdown.trim()}`;
  }
  if (review.mode === "semantic_review_merge") {
    return `${specification}\n\n---\n\n# 无参考答案语义复核合并任务\n\n` +
      `所附 ${review.sourcePageCount} 张图片和可选文本层来自原始试卷，不是参考答案。下面的原始盲答候选和独立语义复核发现报告都不是证据；每一项建议修正必须再次与原卷图文核对，原卷事实优先于发现报告。只应用明确标为【语义确认修正】、同时包含候选具体字段、原题可见事实、题型要求的完整可检查结构和“建议修正”、且复核后不与原卷冲突的项目。标为【语义一致】或【语义证据不足，需复核】的项目必须保留候选原文。\n` +
      (review.sourceText
        ? "原卷 PDF 文本层用于精确核对题干、图号、表格数据、器材名称和数值条件；图形、刻度、接线和方向仍以原卷页图为准。文本层与发现报告冲突时保留原卷事实，发现报告不得改写候选。\n\n"
          + `## 原卷 PDF 文本层（辅助）\n\n${review.sourceText.trim()}\n\n`
        : "") +
      "选择题若未逐项核对 A、B、C、D，不得修改；状态题缺初态—变化—终态、方向题缺坐标系或相对位移、故障电路缺前后状态、图像题缺分段、透镜题缺光线发散或会聚变化时，一律不得修改。不得利用候选与报告的多数关系猜答案。\n" +
      "保持所有题号、小问、公式和 Markdown 结构完整，仅返回合并后的完整答案 Markdown，不要输出报告、分析、JSON 或代码围栏。\n\n" +
      `## 语义复核发现报告\n\n${review.semanticFindings.trim()}\n\n` +
      `## 原始盲答候选\n\n${review.candidateMarkdown.trim()}`;
  }
  if (review.mode === "visual_audit_findings") {
    return `${specification}\n\n---\n\n# 无参考答案视觉发现任务\n\n` +
      `所附 ${review.auditImageCount} 张图片是原始试卷的高分辨率重叠视窗，不是参考答案。` +
      "请对照第一次盲答候选，逐题检查选择题和包含滑轮、仪表、刻度尺、弹簧、钩码、电路、光路或方向关系的题目，但本阶段只负责原图直接取证，不代替第二次完整物理作答。\n" +
      "只输出视觉审计发现报告，不得重写整份答案。每项发现先分类：只有候选明确陈述或依赖的标签、数字、刻度、数量、连接拓扑、几何位置等与原图直接可观察事实矛盾时，才能标【直接视觉不一致】，并写出候选中的具体字段、原图可见事实和建议修正；没有足够证据时写【视觉证据不足，需复核】。\n" +
      "凡修正必须重新运用左手定则、受力平衡、惯性、机械能守恒、物态变化、折射成像等物理规律才能得到，均标【语义复算分歧，仅供参考复核】，可以记录推理疑点，但不得写“建议修正”。选择字母或定性方向本身不是直接视觉事实。\n" +
      "选择题逐项核对题干、选项与图号绑定；滑轮逐段追踪承重绳；仪表先识别实际接线柱再按刻线间隔计数；刻度尺读取两端后相减；钩码逐个计数。" +
      "每个仪表数值必须附结构化【仪表证据链】：小问明确要求读数的目标图号；该目标图是否显示实际导线；仅在同一目标图显示导线时列每根导线连接的端子；选定量程；对应刻度圈；分度值；指针相邻刻线；从左右相邻标注刻度双向数格得到的读数；最后才给一致性计算。目标图是无连接导线的独立表盘时，端子写“不适用/未显示”，按本图印刷数字刻度和单位确定量程，禁止借用同题另一幅电路图的接线或量程。候选数值不得作为证据。若任一字段缺失，或把另一图的接线柱与目标图的指针拼接，必须写【视觉证据不足，需复核】，不得写“建议保留候选”。" +
      "电磁力方向题若要确认或修正，必须逐个目标导体明确写出电流进入端、离开端、N→S磁场方向、与题内校准图的对应变换和最终受力方向；任一项无法从图中绑定时只能写【视觉证据不足，需复核】，不得声称候选正确。\n\n" +
      `## 第一次盲答候选\n\n${review.candidateMarkdown.trim()}`;
  }
  if (review.mode === "visual_audit_merge") {
    return `${specification}\n\n---\n\n# 视觉审计合并任务\n\n` +
      "下面给出第一次盲答候选和独立视觉审计发现报告。只应用明确标为【直接视觉不一致】、同时列出候选具体字段、原图直接可观察事实和“建议修正”的项目；标记为【语义复算分歧，仅供参考复核】、无需修正或证据不足的项目必须保留候选原文，不得改写为占位文本或猜测。需要重新运用左手定则、受力平衡、惯性、机械能守恒、物态变化、折射成像等物理规律才能得出的选择字母或定性方向，即使报告写了计算链或“建议修正”，也不属于直接视觉证据，禁止在本阶段覆盖候选。仪表读数只有在完整【仪表证据链】绑定小问明确引用的目标图，并列出该图自身可见的量程、刻度圈、分度值、相邻刻线和左右双向读数时才算明确视觉证据；目标图没有导线时不得要求或借用另一图的端子。证据链缺失、跨图拼接或自相矛盾时一律视为证据不足，禁止用候选值反证审计结论。" +
      "保持所有题号、小问、公式和 Markdown 结构完整，仅返回修正后的完整 Markdown，不要输出差异说明或代码围栏。\n\n" +
      `## 视觉审计发现报告\n\n${review.auditFindings.trim()}\n\n` +
      `## 第一次盲答候选\n\n${review.candidateMarkdown.trim()}`;
  }
  if (review.mode === "visual_audit") {
    return `${specification}\n\n---\n\n# 无参考答案视觉审计任务\n\n` +
      `所附 ${review.auditImageCount} 张图片是原始试卷的高分辨率页面或局部裁图，不是参考答案，也不包含答案标注。` +
      "下面给出第一次盲答候选。必须抛开候选结论，依据原卷视觉证据和物理规律逐题独立复算，再返回修正后的完整 Markdown。\n" +
      "选择题逐项反证每个选项，特别核对物态变化、条件方向和吸放热，不得因候选已给出字母而跳过推理。\n" +
      "滑轮组必须从绳端沿同一根绳逐段追踪，数出直接支持动滑轮或重物组件的承重绳段，再计算速度、功率和效率。\n" +
    "指针式仪表必须先逐个追踪实际连接导线的接线柱，据此选择量程；再确认对应数字刻度、分度值、指针格数和读数。小格按相邻刻线之间的间隔计数，零刻线只是边界，不得把零刻线计作第一个小格；双排刻度必须分别读数并核对固定倍率关系。禁止先看指针再猜量程。电压表/电流表的确定数值必须在内部完成结构化证据链（图号、实际端子、量程、刻度圈、分度值、相邻刻线、左右双向读数、最后的计算校验）；若任一步无法从图中确认，输出【视觉证据不足，需复核】，不得用 $R=U/I$ 反推读数。\n" +
      "刻度尺和弹簧必须分别读取物体两端刻度后相减；钩码必须逐个计数，并用单个钩码重力交叉校验总拉力。\n" +
      "凡视觉证据无法可靠判读，必须在对应答案处明确标记【视觉证据不足，需复核】，不得猜测或输出伪确定数值。\n" +
      "仅返回修正后的完整 Markdown，不要输出审计报告、差异说明、代码围栏或处理过程。\n\n" +
      `## 第一次盲答候选\n\n${review.candidateMarkdown.trim()}`;
  }
  const generationTask = `${specification}\n\n---\n\n# 当前真实试卷生成任务\n\n` +
    "所附图片按文件名顺序构成同一份完整试卷。请严格按上述规范独立解答全部题目。\n" +
    (review.sourceText
      ? `下面的原卷 PDF 文本层只用于精确抄录题号、题干文字、表格数据和数量关系；原卷页图仍是图形、刻度、接线、方向和版式的最高依据。文本层与页图冲突时回查页图并标【疑】，不得用文本层猜图。\n\n## 原卷 PDF 文本层（辅助）\n\n${review.sourceText.trim()}\n\n`
      : "") +
    "解题前先在内部建立逐题覆盖清单，枚举每个题号、括号小问、圈号小问和每个待填空；" +
    "输出前按该清单逐项核对，任何小问都不得遗漏；圈号小问编号必须与原卷逐项一一对应，不得跳号、重编号或错位。不要输出这份内部清单。\n" +
    "对电路、线圈、光路、受力图和仪表盘等视觉题，必须放大核对原图并独立复核：" +
    "先绑定小问明确引用的目标图，再追踪该图内的接线或方向关系，随后确认量程、分度值和指针位置，禁止仅凭题型惯例作答。电压表/电流表的确定数值必须在内部完成结构化证据链（目标图号、该图是否显示实际导线、该图自身可见的端子或“不适用/未显示”、量程、刻度圈、分度值、相邻刻线、左右双向读数、最后的计算校验）。独立表盘按本图印刷刻度读数，禁止借用同题另一图的接线或量程；若任一步无法从目标图确认，输出【视觉证据不足，需复核】，不得用 $R=U/I$ 反推读数。\n" +
    "对概念填空先判断题目所问的物理量或能量形式，再填写对应物理术语，禁止照抄装置名称。\n" +
    "图片标签中 status=measured 的确定性 source-pixel geometry 是从原卷像素得到的测量事实：对应读数或几何关系必须采用该测量，除非同一原卷存在可明确指出的直接矛盾；status=uncertain 时不得据此猜测。\n" +
    "`$...$` 只用于真实物理量、公式或带 LaTeX 单位的量；选项字母、图中点名和中文标点必须写在正文，不得放入数学模式。\n" +
    "本阶段只生成答案 Markdown：仅返回最终 Markdown 正文，不要使用代码围栏，不要描述处理过程，" +
    "不要声称已经生成 PDF。作图题若无法直接嵌入答图，必须按规范给出精确文字描述。";
  if (!review.candidateMarkdown) {
    return generationTask;
  }
  return `${generationTask}\n\n# 权威参考答案复核任务\n\n` +
    `前 ${review.sourcePageCount} 张图片是原卷，随后 ${review.referencePageCount} 张图片是权威参考答案。` +
    "下面给出一份盲答候选。请逐题核对原卷题号、所有小问和参考答案；参考答案是答案取值的默认权威来源，原卷是题号、题意、单位、作图位置和排版结构的权威来源。修正所有选择、填空、计算、实验、作图描述和遗漏；即使参考答案文本层压缩或省略圈号小问，也必须按原卷逐项保留原有圈号编号与位置，不得重编号。" +
    "但参考答案不得静默覆盖原卷可直接复算的冲突：若同一小问的原卷题干、表格或图像直接支持候选数值/结论，而参考答案给出无法与该原卷证据同时成立的不同值，必须保留原卷支持的候选，并在完整答案末尾增加 `## 疑点清单` 和一条极简 `- 第N题（小问）：原卷……；参考答案……；待人工复核。`；不得把这种冲突改写为参考答案已确认。只有可由原卷消解或不能直接证实的普通差异才按参考答案修正。" +
    "选择题必须先在内部从参考答案逐字符抄录完整答案串，再按题号 1 到 10 逐位覆盖候选并反向核对；选择题若无原卷—参考答案直接冲突，候选与参考答案冲突时绝不保留候选。" +
    "仅返回修正后的完整 Markdown，不要输出差异说明、代码围栏或复核过程。\n\n" +
    (review.referenceText
      ? `## 参考答案 PDF 文本层\n\n${review.referenceText.trim()}\n\n` +
        "文本层用于精确核对答案字符、数字和单位；参考答案页图用于核对作图、表格和文本层缺失内容。\n\n"
      : "") +
    `## 盲答候选\n\n${review.candidateMarkdown.trim()}`;
}

export function normalizeAnswerMarkdown(value) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const match = normalized.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  const unfenced = (match ? match[1] : normalized).trim();
  const headingIndex = unfenced.search(/#\s+(?:物理试卷参考答案|参考答案|答案)(?=\s|$)/u);
  const answerOnly = headingIndex >= 0 ? unfenced.slice(headingIndex) : unfenced;
  const normalizeMathPunctuation = (match, body) => {
    const normalizedBody = body.replace(/[、，。；：]/gu, (punctuation) => `\\text{${punctuation}}`);
    return match.startsWith("$") ? `$${normalizedBody}$` : `\\(${normalizedBody}\\)`;
  };
  return answerOnly
    .replace(/\$([A-Z](?:['′])?(?:[、，][A-Z](?:['′])?)+)\$/g, "$1")
    .replace(/\$([^$\n]*)\$/gu, normalizeMathPunctuation)
    .replace(/\\\(([^\n]*?)\\\)/gu, normalizeMathPunctuation)
    .replace(/([_^]\{)([^{}]*[\u3400-\u9fff][^{}]*)(\})/gu, (_match, open, body, close) =>
      `${open}${body.replace(/[\u3400-\u9fff]+/gu, (label) => `\\text{${label}}`)}${close}`);
}

export function buildIndexedChoiceCandidate(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/u);
  const ranges = [
    { start: 1, end: 5, pattern: /^\s*1\s*[—–-]\s*5\s*[:：]/u },
    { start: 6, end: 10, pattern: /^\s*6\s*[—–-]\s*10\s*[:：]/u },
    { start: 11, end: 12, pattern: /^\s*11\s*[—–-]\s*12\s*[:：]/u }
  ];
  const indexed = [];
  for (const range of ranges) {
    const line = lines.find((candidateLine) => range.pattern.test(candidateLine));
    const answers = [...(line?.match(/[A-D](?=[、，,\s]|$)/gu) ?? [])];
    if (answers.length !== range.end - range.start + 1) {
      continue;
    }
    for (let question = range.start; question <= range.end; question += 1) {
      indexed.push(`第${question}题候选结论：${answers[question - range.start]}`);
    }
  }
  return indexed.length > 0
    ? `## 程序展开的选择题候选索引\n\n${indexed.join("\n")}`
    : "## 程序展开的选择题候选索引\n\n未检测到可安全展开的分组答案；对应题必须标【语义证据不足，需复核】。";
}

function extractNumberedChoiceAnswers(referenceText) {
  const text = String(referenceText ?? "").replace(/\r\n?/g, "\n");
  // Only treat a line-start question marker as a question boundary. Inline
  // references such as “图 2．…” occur in explanations and must not split the
  // preceding question's answer segment.
  const markers = [...text.matchAll(/(?:^|\n|\f)\s*(1[0-2]|[1-9])[\.．]\s*/gmu)];
  const answersByQuestion = new Map();
  for (let index = 0; index < markers.length; index += 1) {
    const questionNumber = Number(markers[index][1]);
    const segmentStart = markers[index].index + markers[index][0].length;
    const segmentEnd = markers[index + 1]?.index ?? text.length;
    const answerMatches = [...text.slice(segmentStart, segmentEnd).matchAll(/(?:【\s*答案\s*】|故选\s*[：:])\s*([A-D])/igu)];
    const answer = answerMatches.at(-1)?.[1]?.toUpperCase();
    if (!answer) {
      continue;
    }
    const existing = answersByQuestion.get(questionNumber);
    if (existing && existing !== answer) {
      throw new Error(`Reference text contains conflicting answers for choice question ${questionNumber}: ${existing}, ${answer}`);
    }
    answersByQuestion.set(questionNumber, answer);
  }
  if (Array.from({ length: 10 }, (_, index) => index + 1).every((number) => answersByQuestion.has(number))) {
    return Array.from({ length: 10 }, (_, index) => answersByQuestion.get(index + 1)).join("");
  }
  return null;
}

export function extractTenChoiceAnswers(referenceText) {
  const numberedAnswers = extractNumberedChoiceAnswers(referenceText);
  if (numberedAnswers) {
    return numberedAnswers;
  }
  const compact = String(referenceText ?? "").toUpperCase().replace(/\s+/g, "");
  const matches = [...compact.matchAll(/(?<![A-Z])([A-D]{5})([A-D]{5})(?![A-Z])/g)]
    .map((match) => `${match[1]}${match[2]}`);
  const answers = [...new Set(matches)];
  if (answers.length > 1) {
    throw new Error(`Reference text contains multiple conflicting ten-question choice sequences: ${answers.join(", ")}`);
  }
  return answers[0] ?? null;
}

function formatChoiceAnswers(answers) {
  return answers.split("").join("、");
}

export function applyReferenceChoiceAnswers(markdown, referenceText) {
  const answers = extractTenChoiceAnswers(referenceText);
  if (!answers) {
    return { markdown, applied: false, answers: null };
  }

  const lines = String(markdown).split("\n");
  const firstRange = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*1\s*[—–-]\s*5\s*[:：]/u.test(line));
  const secondRange = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*6\s*[—–-]\s*10\s*[:：]/u.test(line));
  if (firstRange.length !== 1 || secondRange.length !== 1) {
    throw new Error("Reference choice sequence was found, but the answer Markdown must contain exactly one 1—5 line and one 6—10 line.");
  }

  lines[firstRange[0].index] = `1—5：${formatChoiceAnswers(answers.slice(0, 5))}`;
  lines[secondRange[0].index] = `6—10：${formatChoiceAnswers(answers.slice(5))}`;
  return { markdown: lines.join("\n"), applied: true, answers };
}

export function parseSemanticChoiceFindings(findings) {
  const text = String(findings ?? "").replace(/\r\n?/g, "\n");
  const corrections = new Map();
  const blocks = [...text.matchAll(/###\s*第\s*(\d+)\s*题([\s\S]*?)(?=\n###\s*第|\n---|$)/gu)];
  for (const block of blocks) {
    const body = block[2];
    const correctionTag = /【语义确认修正】/u.test(body);
    const consistencyTag = /【语义一致】/u.test(body);
    if (!correctionTag || consistencyTag) {
      continue;
    }
    // A self-contradictory report is not a safe deterministic input. Keep the
    // baseline candidate until a fresh review resolves the contradiction.
    if (/最终建议|应标.*语义一致|需以原图.*确认|题干.*(?:显示|辨识).*应改/us.test(body)) {
      continue;
    }
    const independentMatches = [...body.matchAll(/^\s*独立结论\s*：\s*([A-D])\s*[。.]?\s*$/imgu)];
    const candidateMatches = [...body.matchAll(/^\s*候选结论\s*：\s*([A-D])\s*[。.]?\s*$/imgu)];
    const independent = independentMatches.length === 1 ? independentMatches[0][1].toUpperCase() : null;
    const candidate = candidateMatches.length === 1 ? candidateMatches[0][1].toUpperCase() : null;
    const suggestedAnswer = body.match(/建议修正\s*：[^\n]*?(?:改为\s*)?([A-D])(?:\s|[。.]|$)/iu)?.[1]?.toUpperCase() ?? null;
    if (independent && candidate && independent !== candidate && suggestedAnswer === independent) {
      corrections.set(Number(block[1]), { candidate, answer: independent });
    }
  }
  return corrections;
}

export function applySemanticChoiceFindings(markdown, findings, baselineMarkdown = markdown) {
  const corrections = parseSemanticChoiceFindings(findings);
  if (corrections.size === 0) {
    return { markdown, applied: false, questions: [] };
  }
  const lines = String(markdown).split("\n");
  const baselineLines = String(baselineMarkdown).split("\n");
  const ranges = [
    { start: 1, end: 5, pattern: /^\s*1\s*[—–-]\s*5\s*[:：]/u },
    { start: 6, end: 10, pattern: /^\s*6\s*[—–-]\s*10\s*[:：]/u },
    { start: 11, end: 12, pattern: /^\s*11\s*[—–-]\s*12\s*[:：]/u }
  ];
  const applied = [];
  for (const range of ranges) {
    const lineIndex = lines.findIndex((line) => range.pattern.test(line));
    const baselineLineIndex = baselineLines.findIndex((line) => range.pattern.test(line));
    if (lineIndex < 0 || baselineLineIndex < 0) {
      continue;
    }
    const current = [...(baselineLines[baselineLineIndex].match(/[A-D](?=[、，,\s]|$)/gu) ?? [])];
    if (current.length !== range.end - range.start + 1) {
      continue;
    }
    for (let question = range.start; question <= range.end; question += 1) {
      const correction = corrections.get(question);
      const currentAnswer = current[question - range.start];
      if (correction && currentAnswer === correction.candidate) {
        current[question - range.start] = correction.answer;
        applied.push(question);
      }
    }
    lines[lineIndex] = `${range.start}—${range.end}：${current.join("、")}`;
  }
  return { markdown: lines.join("\n"), applied: applied.length > 0, questions: applied };
}
