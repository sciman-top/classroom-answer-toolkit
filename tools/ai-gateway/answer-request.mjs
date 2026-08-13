import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertLiveEgressAllowed,
  isRetryableGatewayFailure,
  loadGatewayConfig,
  repoRoot,
  requireValue
} from "./validate-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPromptPath = path.join(repoRoot, "prompts", "junior-physics-answer", "spec.md");

const usage = `Usage:
  npm --prefix tools/ai-gateway run generate:answer -- --allow-cloud-egress --images-dir <dir> --output <answer.md>

Options:
  --config-env-file <path>  Env file to read; defaults to .env
  --prompt-file <path>      Full answer specification; defaults to the active junior-physics spec
  --images-dir <dir>        Directory containing ordered page PNG/JPEG/WebP images
  --candidate-file <path>   Blind answer Markdown to review against a reference answer
  --audit-images-dir <dir>  High-resolution source crops/pages for a no-reference visual audit; requires --candidate-file
  --audit-findings-only     Emit visual findings without rewriting the candidate; requires --audit-images-dir
  --audit-findings-file <path>  Merge a prior visual findings report into the candidate without image input
  --reference-images-dir <dir>  Ordered reference-answer page images; requires --candidate-file
  --reference-text-file <path>  Optional extracted text layer from the same reference PDF
  --image <path>            Add one page image; repeat for multiple pages
  --output <path>           Markdown output path
  --provider <target>       primary, fallback, or all; default all
  --risk-signal <signal>    Add an evidence-backed routing risk signal; repeat as needed
  --visual-detail <mode>    low, high, or original; default original
  --max-output-tokens <n>   Maximum answer tokens; default 24000
  --timeout-ms <ms>         Per-provider timeout; default 600000
  --allow-cloud-egress      Required for live requests
`;

function parseArgs(argv) {
  const options = {
    envFile: path.join(repoRoot, ".env"),
    promptFile: defaultPromptPath,
    imagesDir: null,
    auditImagesDir: null,
    auditFindingsOnly: false,
    auditFindingsFile: null,
    referenceImagesDir: null,
    referenceTextFile: null,
    candidateFile: null,
    imagePaths: [],
    outputPath: null,
    provider: "all",
    riskSignals: [],
    visualDetailMode: "original",
    maxOutputTokens: 24000,
    timeoutMs: 600000,
    allowCloudEgress: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config-env-file") {
      options.envFile = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--config-env-file=")) {
      options.envFile = resolveCallerPath(arg.slice("--config-env-file=".length));
      continue;
    }
    if (arg === "--prompt-file") {
      options.promptFile = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--prompt-file=")) {
      options.promptFile = resolveCallerPath(arg.slice("--prompt-file=".length));
      continue;
    }
    if (arg === "--images-dir") {
      options.imagesDir = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--images-dir=")) {
      options.imagesDir = resolveCallerPath(arg.slice("--images-dir=".length));
      continue;
    }
    if (arg === "--image") {
      options.imagePaths.push(resolveCallerPath(requireValue(argv, ++index, arg)));
      continue;
    }
    if (arg === "--candidate-file") {
      options.candidateFile = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--audit-images-dir") {
      options.auditImagesDir = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--audit-images-dir=")) {
      options.auditImagesDir = resolveCallerPath(arg.slice("--audit-images-dir=".length));
      continue;
    }
    if (arg === "--audit-findings-only") {
      options.auditFindingsOnly = true;
      continue;
    }
    if (arg === "--audit-findings-file") {
      options.auditFindingsFile = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--audit-findings-file=")) {
      options.auditFindingsFile = resolveCallerPath(arg.slice("--audit-findings-file=".length));
      continue;
    }
    if (arg.startsWith("--candidate-file=")) {
      options.candidateFile = resolveCallerPath(arg.slice("--candidate-file=".length));
      continue;
    }
    if (arg === "--reference-images-dir") {
      options.referenceImagesDir = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--reference-images-dir=")) {
      options.referenceImagesDir = resolveCallerPath(arg.slice("--reference-images-dir=".length));
      continue;
    }
    if (arg === "--reference-text-file") {
      options.referenceTextFile = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--reference-text-file=")) {
      options.referenceTextFile = resolveCallerPath(arg.slice("--reference-text-file=".length));
      continue;
    }
    if (arg.startsWith("--image=")) {
      options.imagePaths.push(resolveCallerPath(arg.slice("--image=".length)));
      continue;
    }
    if (arg === "--output") {
      options.outputPath = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.outputPath = resolveCallerPath(arg.slice("--output=".length));
      continue;
    }
    if (arg === "--provider") {
      options.provider = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--provider=")) {
      options.provider = arg.slice("--provider=".length);
      continue;
    }
    if (arg === "--risk-signal") {
      options.riskSignals.push(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--risk-signal=")) {
      options.riskSignals.push(arg.slice("--risk-signal=".length));
      continue;
    }
    if (arg === "--visual-detail") {
      options.visualDetailMode = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--visual-detail=")) {
      options.visualDetailMode = arg.slice("--visual-detail=".length);
      continue;
    }
    if (arg === "--max-output-tokens") {
      options.maxOutputTokens = Number(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--max-output-tokens=")) {
      options.maxOutputTokens = Number(arg.slice("--max-output-tokens=".length));
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
      continue;
    }
    if (arg === "--allow-cloud-egress") {
      options.allowCloudEgress = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
  }

  validateOptions(options);
  options.sourceImagePaths = options.imagesDir || options.imagePaths.length > 0
    ? resolveOrderedImages(options)
    : [];
  options.auditImagePaths = options.auditImagesDir
    ? resolveImagesFromDirectory(options.auditImagesDir)
    : [];
  options.referenceImagePaths = options.referenceImagesDir
    ? resolveImagesFromDirectory(options.referenceImagesDir)
    : [];
  options.imagePaths = [
    ...options.sourceImagePaths,
    ...options.auditImagePaths,
    ...options.referenceImagePaths
  ];
  return options;
}

function resolveCallerPath(value) {
  return path.resolve(process.env.INIT_CWD || process.cwd(), value);
}

function validateOptions(options) {
  if (!options.outputPath) {
    throw new Error(`--output is required.\n\n${usage}`);
  }
  if (options.imagesDir && options.imagePaths.length > 0) {
    throw new Error("Use --images-dir or repeated --image values, not both.");
  }
  if (!options.imagesDir && options.imagePaths.length === 0 && !options.auditImagesDir && !options.auditFindingsFile) {
    throw new Error("--images-dir, --audit-images-dir, --audit-findings-file, or at least one --image is required.");
  }
  if (!["primary", "fallback", "all"].includes(options.provider)) {
    throw new Error("--provider must be primary, fallback, or all.");
  }
  const invalidRiskSignals = options.riskSignals.filter((signal) => !ROUTING_RISK_SIGNALS.has(signal));
  if (invalidRiskSignals.length > 0) {
    throw new Error(`Unsupported --risk-signal: ${invalidRiskSignals.join(", ")}.`);
  }
  options.riskSignals = [...new Set(options.riskSignals)];
  if (!["low", "high", "original"].includes(options.visualDetailMode)) {
    throw new Error("--visual-detail must be low, high, or original.");
  }
  if (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1000) {
    throw new Error("--max-output-tokens must be an integer >= 1000.");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000.");
  }
  if ([options.auditImagesDir, options.referenceImagesDir, options.auditFindingsFile].filter(Boolean).length > 1) {
    throw new Error("--audit-images-dir, --audit-findings-file, and --reference-images-dir are mutually exclusive.");
  }
  const candidateMode = Boolean(options.auditImagesDir || options.auditFindingsFile || options.referenceImagesDir);
  if (Boolean(options.candidateFile) !== candidateMode) {
    throw new Error("--candidate-file must be used with exactly one of --audit-images-dir or --reference-images-dir.");
  }
  if (options.candidateFile && !fs.existsSync(options.candidateFile)) {
    throw new Error(`Candidate Markdown not found: ${options.candidateFile}`);
  }
  if (options.auditFindingsOnly && !options.auditImagesDir) {
    throw new Error("--audit-findings-only requires --audit-images-dir.");
  }
  if (options.auditFindingsFile && !fs.existsSync(options.auditFindingsFile)) {
    throw new Error(`Visual audit findings file not found: ${options.auditFindingsFile}`);
  }
  if (options.referenceTextFile && !options.referenceImagesDir) {
    throw new Error("--reference-text-file requires --reference-images-dir.");
  }
  if (options.referenceTextFile && !fs.existsSync(options.referenceTextFile)) {
    throw new Error(`Reference text file not found: ${options.referenceTextFile}`);
  }
}

function resolveOrderedImages(options) {
  const imagePaths = options.imagesDir
    ? resolveImagesFromDirectory(options.imagesDir)
    : [...options.imagePaths];

  if (imagePaths.length === 0) {
    throw new Error("No supported page images were found.");
  }
  for (const imagePath of imagePaths) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Page image not found: ${imagePath}`);
    }
  }
  return imagePaths;
}

function resolveImagesFromDirectory(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Image directory not found: ${directory}`);
  }
  const imagePaths = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  if (imagePaths.length === 0) {
    throw new Error(`No supported page images were found: ${directory}`);
  }
  return imagePaths;
}

export function buildPrompt(promptFile, review = {}) {
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Prompt file not found: ${promptFile}`);
  }
  const specification = fs.readFileSync(promptFile, "utf8").trim();
  if (review.mode === "visual_audit_findings") {
    return `${specification}\n\n---\n\n# 无参考答案视觉发现任务\n\n` +
      `所附 ${review.auditImageCount} 张图片是原始试卷的高分辨率重叠视窗，不是参考答案。` +
      "请对照第一次盲答候选，逐题独立检查所有选择题和包含滑轮、仪表、刻度尺、弹簧、钩码、电路、光路或方向关系的题目。\n" +
      "只输出视觉审计发现报告，不得重写整份答案。每项发现必须包含题号、候选结论、可见证据、独立计算或逐段追踪结果、建议修正；没有足够证据时写【视觉证据不足，需复核】。\n" +
      "选择题逐项反证；滑轮逐段追踪承重绳；仪表先识别实际接线柱再按刻线间隔计数；刻度尺读取两端后相减；钩码逐个计数。\n\n" +
      `## 第一次盲答候选\n\n${review.candidateMarkdown.trim()}`;
  }
  if (review.mode === "visual_audit_merge") {
    return `${specification}\n\n---\n\n# 视觉审计合并任务\n\n` +
      "下面给出第一次盲答候选和独立视觉审计发现报告。只应用同时具有明确视觉证据、计算链和“建议修正”的项目；标记为“无需修正”或证据不足的项目必须保留候选原文，不得改写为占位文本或猜测。" +
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
      "指针式仪表必须先逐个追踪实际连接导线的接线柱，据此选择量程；再确认对应数字刻度、分度值、指针格数和读数。小格按相邻刻线之间的间隔计数，零刻线只是边界，不得把零刻线计作第一个小格；双排刻度必须分别读数并核对固定倍率关系。禁止先看指针再猜量程。\n" +
      "刻度尺和弹簧必须分别读取物体两端刻度后相减；钩码必须逐个计数，并用单个钩码重力交叉校验总拉力。\n" +
      "凡视觉证据无法可靠判读，必须在对应答案处明确标记【视觉证据不足，需复核】，不得猜测或输出伪确定数值。\n" +
      "仅返回修正后的完整 Markdown，不要输出审计报告、差异说明、代码围栏或处理过程。\n\n" +
      `## 第一次盲答候选\n\n${review.candidateMarkdown.trim()}`;
  }
  const generationTask = `${specification}\n\n---\n\n# 当前真实试卷生成任务\n\n` +
    "所附图片按文件名顺序构成同一份完整试卷。请严格按上述规范独立解答全部题目。\n" +
    "解题前先在内部建立逐题覆盖清单，枚举每个题号、括号小问、圈号小问和每个待填空；" +
    "输出前按该清单逐项核对，任何小问都不得遗漏；圈号小问编号必须与原卷逐项一一对应，不得跳号、重编号或错位。不要输出这份内部清单。\n" +
    "对电路、线圈、光路、受力图和仪表盘等视觉题，必须放大核对原图并独立复核：" +
    "先追踪接线或方向关系，再确认量程、接线柱、分度值和指针位置，禁止仅凭题型惯例作答。\n" +
    "对概念填空先判断题目所问的物理量或能量形式，再填写对应物理术语，禁止照抄装置名称。\n" +
    "`$...$` 只用于真实物理量、公式或带 LaTeX 单位的量；选项字母、图中点名和中文标点必须写在正文，不得放入数学模式。\n" +
    "本阶段只生成答案 Markdown：仅返回最终 Markdown 正文，不要使用代码围栏，不要描述处理过程，" +
    "不要声称已经生成 PDF。作图题若无法直接嵌入答图，必须按规范给出精确文字描述。";
  if (!review.candidateMarkdown) {
    return generationTask;
  }
  return `${generationTask}\n\n# 权威参考答案复核任务\n\n` +
    `前 ${review.sourcePageCount} 张图片是原卷，随后 ${review.referencePageCount} 张图片是权威参考答案。` +
    "下面给出一份盲答候选。请逐题核对原卷题号、所有小问和参考答案；参考答案是答案取值的权威来源，" +
    "原卷是题号、题意、单位、作图位置和排版结构的权威来源。修正所有选择、填空、计算、实验、作图描述和遗漏；即使参考答案文本层压缩或省略圈号小问，也必须按原卷逐项保留原有圈号编号与位置，不得重编号。" +
    "选择题必须先在内部从参考答案逐字符抄录完整答案串，再按题号 1 到 10 逐位覆盖候选并反向核对；候选与参考答案冲突时绝不保留候选。" +
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
  return answerOnly.replace(/\$([A-D](?:['′])?(?:[、，][A-D](?:['′])?)*)\$/g, "$1");
}

function extractNumberedChoiceAnswers(referenceText) {
  const text = String(referenceText ?? "").replace(/\r\n?/g, "\n");
  const markers = [...text.matchAll(/(?<!\d)(10|[1-9])\.\s+/gu)];
  const answersByQuestion = new Map();
  for (let index = 0; index < markers.length; index += 1) {
    const questionNumber = Number(markers[index][1]);
    const segmentStart = markers[index].index + markers[index][0].length;
    const segmentEnd = markers[index + 1]?.index ?? text.length;
    const answer = text.slice(segmentStart, segmentEnd).match(/【\s*答案\s*】\s*([A-D])/iu)?.[1]?.toUpperCase();
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

function extractTenChoiceAnswers(referenceText) {
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

function normalizeDetailForProvider(detail) {
  return detail === "original" ? "high" : detail;
}

function imageDataUrl(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = extension === ".png"
    ? "image/png"
    : extension === ".webp"
      ? "image/webp"
      : "image/jpeg";
  return `data:${mimeType};base64,${fs.readFileSync(imagePath).toString("base64")}`;
}

export function buildAnswerRequestBody(provider, options) {
  const detail = normalizeDetailForProvider(options.visualDetailMode);
  if (provider.visionSurface === "chat_completions") {
    return {
      model: provider.visionModel,
      ...(provider.reasoningEffort ? { reasoning_effort: provider.reasoningEffort } : {}),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: options.prompt },
            ...options.imagePaths.map((imagePath) => ({
              type: "image_url",
              image_url: { url: imageDataUrl(imagePath), detail }
            }))
          ]
        }
      ],
      max_tokens: options.maxOutputTokens
    };
  }

  return {
    model: provider.visionModel,
    ...(provider.reasoningEffort ? { reasoning: { effort: provider.reasoningEffort } } : {}),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: options.prompt },
          ...options.imagePaths.map((imagePath) => ({
            type: "input_image",
            image_url: imageDataUrl(imagePath),
            detail
          }))
        ]
      }
    ],
    max_output_tokens: options.maxOutputTokens
  };
}

const TASK_MODES = new Set([
  "blind_generation",
  "visual_audit",
  "visual_audit_findings",
  "visual_audit_merge",
  "reference_review"
]);

export const ROUTING_RISK_SIGNALS = new Set([
  "multi_part",
  "visual_binding",
  "unit_conflict",
  "validator_conflict",
  "prior_regression_failure",
  "reference_conflict"
]);

const HIGH_RISK_SIGNALS = new Set([
  "visual_binding",
  "unit_conflict",
  "validator_conflict",
  "prior_regression_failure",
  "reference_conflict"
]);

const ROUTE_ORDERS = Object.freeze({
  general: ["fallback_1", "primary", "fallback_2", "fallback_3"],
  semantic: ["primary", "fallback_2", "fallback_1", "fallback_3"],
  visual: ["primary", "fallback_2", "fallback_1", "fallback_3"],
  visual_batch: ["fallback_2", "primary", "fallback_3", "fallback_1"],
  structured: ["fallback_3", "fallback_1", "fallback_2", "primary"],
  structured_batch: ["fallback_2", "fallback_3", "primary", "fallback_1"]
});

function countOption(options, name, fallback = 0) {
  const value = Number(options?.[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function inferAnswerMode(options = {}) {
  if (TASK_MODES.has(options.mode)) {
    return options.mode;
  }
  if (options.auditFindingsOnly) {
    return "visual_audit_findings";
  }
  if (options.auditFindingsFile || options.auditFindings) {
    return "visual_audit_merge";
  }
  if (options.auditImagesDir || countOption(options, "auditImageCount") > 0 || options.auditImagePaths?.length > 0) {
    return "visual_audit";
  }
  if (options.referenceImagesDir || countOption(options, "referencePageCount") > 0 || options.referenceImagePaths?.length > 0) {
    return "reference_review";
  }
  return "blind_generation";
}

/**
 * Classify the existing workflow facts into a small, deterministic routing task.
 * The caller only supplies facts already known by answer-request; model details
 * and failover policy stay behind this module's seam.
 */
export function classifyAnswerTask(options = {}) {
  const mode = inferAnswerMode(options);
  const sourcePageCount = countOption(
    options,
    "sourcePageCount",
    options.sourceImagePaths?.length ?? (mode === "blind_generation" ? options.imagePaths?.length ?? 0 : 0)
  );
  const auditImageCount = countOption(options, "auditImageCount", options.auditImagePaths?.length ?? 0);
  const referencePageCount = countOption(options, "referencePageCount", options.referenceImagePaths?.length ?? 0);
  const visualPageCount = sourcePageCount + auditImageCount + referencePageCount;
  const hasVisualInput = visualPageCount > 0 || (options.imagePaths?.length ?? 0) > 0;
  const reasons = [`mode=${mode}`];
  const riskSignals = [...new Set(options.riskSignals ?? [])].filter((signal) => ROUTING_RISK_SIGNALS.has(signal));
  const highRiskSignals = riskSignals.filter((signal) => HIGH_RISK_SIGNALS.has(signal));
  if (sourcePageCount > 0) reasons.push(`source_pages=${sourcePageCount}`);
  if (auditImageCount > 0) reasons.push(`audit_pages=${auditImageCount}`);
  if (referencePageCount > 0) reasons.push(`reference_pages=${referencePageCount}`);
  if (hasVisualInput) reasons.push("visual_input=true");

  let taskType = mode;
  let complexity = "medium";
  let routeFamily = "general";
  if (mode === "blind_generation") {
    complexity = sourcePageCount <= 2 ? "low" : sourcePageCount >= 10 ? "high" : "medium";
    routeFamily = complexity === "high" ? "semantic" : "general";
  } else if (mode === "reference_review") {
    const reviewPages = sourcePageCount + referencePageCount;
    complexity = reviewPages >= 16 || referencePageCount >= 8 ? "high" : "medium";
    routeFamily = complexity === "high" ? "semantic" : "general";
  } else if (mode === "visual_audit") {
    complexity = auditImageCount >= 8 || sourcePageCount >= 8 ? "high" : auditImageCount <= 2 ? "low" : "medium";
    routeFamily = complexity === "high" ? "visual" : complexity === "medium" ? "visual_batch" : "structured";
    taskType = "visual_verification";
  } else if (mode === "visual_audit_findings") {
    complexity = auditImageCount >= 8 ? "high" : "medium";
    routeFamily = complexity === "high" ? "structured_batch" : "structured";
    taskType = "visual_findings_extraction";
  } else if (mode === "visual_audit_merge") {
    complexity = "medium";
    routeFamily = "structured";
    taskType = "visual_findings_merge";
  }
  if (riskSignals.includes("multi_part") && complexity === "low") {
    complexity = "medium";
    routeFamily = mode === "visual_audit" ? "visual_batch" : "general";
  }
  if (highRiskSignals.length > 0) {
    complexity = "high";
    routeFamily = mode === "visual_audit"
      ? "visual"
      : mode === "visual_audit_findings" || mode === "visual_audit_merge"
        ? "structured_batch"
        : "semantic";
  }
  for (const signal of riskSignals) reasons.push(`risk_signal=${signal}`);
  reasons.push(`complexity=${complexity}`);
  reasons.push(`route_family=${routeFamily}`);
  const orderedRoles = ROUTE_ORDERS[routeFamily];
  return {
    mode,
    taskType,
    complexity,
    routeFamily,
    sourcePageCount,
    auditImageCount,
    referencePageCount,
    visualPageCount,
    hasVisualInput,
    riskSignals,
    riskEscalated: highRiskSignals.length > 0,
    preferredRole: orderedRoles[0],
    orderedRoles: [...orderedRoles],
    reasons
  };
}

export function selectAnswerRoute(config, task, target = "all") {
  const classified = task?.orderedRoles ? task : classifyAnswerTask(task ?? {});
  const roleRank = new Map(classified.orderedRoles.map((role, index) => [role, index]));
  const providers = config.providers
    .filter((provider) => provider.lane === "ai")
    .filter((provider) => target === "all"
      || (target === "primary" && provider.role === "primary")
      || (target === "fallback" && provider.role.startsWith("fallback")))
    .sort((left, right) => {
      const leftRank = roleRank.get(left.role) ?? 1000 + providerOrder(left.role);
      const rightRank = roleRank.get(right.role) ?? 1000 + providerOrder(right.role);
      return leftRank - rightRank;
    });
  return {
    ...classified,
    target,
    selectedRole: providers[0]?.role ?? null,
    orderedRoles: providers.map((provider) => provider.role),
    providers
  };
}

function routingReceipt(route) {
  return {
    taskType: route.taskType,
    mode: route.mode,
    complexity: route.complexity,
    preferredRole: route.preferredRole,
    selectedRole: route.selectedRole,
    routeFamily: route.routeFamily,
    orderedRoles: route.orderedRoles,
    reasons: route.reasons,
    riskSignals: route.riskSignals,
    riskEscalated: route.riskEscalated,
    target: route.target
  };
}

function providerOrder(role) {
  if (role === "primary") {
    return 0;
  }
  const match = role.match(/^fallback_(\d+)$/);
  return match ? Number(match[1]) : 999;
}

function extractTextOutput(parsed) {
  if (typeof parsed.output_text === "string") {
    return parsed.output_text;
  }
  if (Array.isArray(parsed.output)) {
    const parts = [];
    for (const item of parsed.output) {
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        if (typeof part?.text === "string") {
          parts.push(part.text);
        }
      }
    }
    if (parts.length > 0) {
      return parts.join("");
    }
  }
  const content = Array.isArray(parsed.choices) ? parsed.choices[0]?.message?.content : null;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? "").join("");
  }
  return "";
}

function summarizeBody(bodyText) {
  try {
    return JSON.stringify(JSON.parse(bodyText)).slice(0, 500);
  } catch {
    return bodyText.slice(0, 500);
  }
}

function summarizeRequestError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === "object" ? error.cause : null;
  if (!cause || typeof cause !== "object") {
    return message;
  }
  const causeCode = typeof cause.code === "string" ? cause.code : "";
  const causeMessage = typeof cause.message === "string" ? cause.message : "";
  const detail = [causeCode, causeMessage].filter(Boolean).join(": ");
  return detail ? `${message} (${detail})` : message;
}

async function callProvider(provider, options) {
  const endpointPath = provider.visionSurface === "chat_completions" ? "chat/completions" : "responses";
  const endpoint = `${provider.baseUrl.replace(/\/+$/, "")}/${endpointPath}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "classroom-answer-toolkit-answer-generation/1.0"
      },
      body: JSON.stringify(buildAnswerRequestBody(provider, options))
    });
    const bodyText = await response.text();
    if (!response.ok) {
      return {
        provider: provider.role,
        ok: false,
        retryable: isRetryableGatewayFailure(response.status),
        status: response.status,
        error: summarizeBody(bodyText)
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (error) {
      return {
        provider: provider.role,
        ok: false,
        retryable: false,
        status: response.status,
        error: `Provider response was not JSON: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    const answerMarkdown = normalizeAnswerMarkdown(extractTextOutput(parsed));
    return {
      provider: provider.role,
      model: provider.visionModel,
      reasoningEffort: provider.reasoningEffort || null,
      ok: answerMarkdown.length > 0,
      retryable: false,
      status: response.status,
      answerMarkdown,
      error: answerMarkdown.length > 0 ? "" : "Provider response did not contain answer Markdown."
    };
  } catch (error) {
    return {
      provider: provider.role,
      ok: false,
      retryable: true,
      status: null,
      error: summarizeRequestError(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestAnswerWithFailover(config, options) {
  assertLiveEgressAllowed(config, options.allowCloudEgress);
  if (typeof fetch !== "function") {
    throw new Error("This Node.js runtime does not provide fetch.");
  }
  const task = classifyAnswerTask(options);
  const route = selectAnswerRoute(config, task, options.provider);
  const providers = route.providers;
  if (providers.length === 0) {
    throw new Error(`No ${options.provider ?? "all"} AI provider is configured for answer generation.`);
  }

  const attempts = [];
  for (const provider of providers) {
    const attempt = await callProvider(provider, options);
    attempts.push(attempt);
    if (attempt.ok) {
      return {
        ok: true,
        provider: provider.role,
        model: attempt.model,
        reasoningEffort: attempt.reasoningEffort,
        answerMarkdown: attempt.answerMarkdown,
        attempts,
        routing: routingReceipt(route)
      };
    }
    if (!attempt.retryable) {
      return {
        ok: false,
        provider: provider.role,
        answerMarkdown: "",
        attempts,
        routing: routingReceipt(route),
        error: attempt.error
      };
    }
  }
  return {
    ok: false,
    provider: attempts.at(-1)?.provider ?? null,
    answerMarkdown: "",
    attempts,
    routing: routingReceipt(route),
    error: "All configured AI providers failed with retryable errors."
  };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function redactAttempt(attempt) {
  return {
    provider: attempt.provider,
    model: attempt.model ?? null,
    reasoningEffort: attempt.reasoningEffort ?? null,
    status: attempt.status,
    ok: attempt.ok,
    retryable: attempt.retryable,
    error: attempt.error ? attempt.error.slice(0, 500) : ""
  };
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  const loaded = loadGatewayConfig({ envFile: options.envFile, allowMissingSecrets: false });
  if (loaded.validation.errors.length > 0) {
    throw new Error(loaded.validation.errors.join("; "));
  }
  const prompt = buildPrompt(options.promptFile, options.candidateFile ? {
    mode: options.auditFindingsOnly
      ? "visual_audit_findings"
      : options.auditFindingsFile
        ? "visual_audit_merge"
        : options.auditImagesDir
          ? "visual_audit"
          : "reference_review",
    candidateMarkdown: fs.readFileSync(options.candidateFile, "utf8"),
    auditFindings: options.auditFindingsFile ? fs.readFileSync(options.auditFindingsFile, "utf8") : "",
    referenceText: options.referenceTextFile ? fs.readFileSync(options.referenceTextFile, "utf8") : "",
    sourcePageCount: options.sourceImagePaths.length,
    auditImageCount: options.auditImagePaths.length,
    referencePageCount: options.referenceImagePaths.length
  } : {});
  const result = await requestAnswerWithFailover(loaded.config, { ...options, prompt });
  if (!result.ok) {
    throw new Error(`${result.error}\n${JSON.stringify(result.attempts.map(redactAttempt), null, 2)}`);
  }

  const choiceOverride = options.referenceTextFile
    ? applyReferenceChoiceAnswers(result.answerMarkdown, fs.readFileSync(options.referenceTextFile, "utf8"))
    : { markdown: result.answerMarkdown, applied: false, answers: null };
  const answerMarkdown = choiceOverride.markdown;
  writeAtomic(options.outputPath, `${answerMarkdown}\n`);
  const summary = {
    kind: "live-answer-generation-summary",
    provider: result.provider,
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    promptPath: path.relative(repoRoot, options.promptFile).replace(/\\/g, "/"),
    promptSha256: sha256File(options.promptFile),
    mode: options.auditFindingsOnly
      ? "visual_audit_findings"
      : options.auditFindingsFile
        ? "visual_audit_merge"
        : options.auditImagesDir
          ? "visual_audit"
          : options.candidateFile
            ? "reference_review"
            : "blind_generation",
    sourcePageCount: options.sourceImagePaths.length,
    auditImageCount: options.auditImagePaths.length,
    referencePageCount: options.referenceImagePaths.length,
    requestedVisualDetailMode: options.visualDetailMode,
    providerVisualDetailMode: normalizeDetailForProvider(options.visualDetailMode),
    routing: result.routing,
    candidatePath: options.candidateFile,
    candidateSha256: options.candidateFile ? sha256File(options.candidateFile) : null,
    auditFindingsPath: options.auditFindingsFile,
    auditFindingsSha256: options.auditFindingsFile ? sha256File(options.auditFindingsFile) : null,
    referenceTextPath: options.referenceTextFile,
    referenceTextSha256: options.referenceTextFile ? sha256File(options.referenceTextFile) : null,
    pageCount: options.imagePaths.length,
    pageImages: options.imagePaths.map((imagePath) => ({
      path: imagePath,
      sha256: sha256File(imagePath)
    })),
    outputPath: options.outputPath,
    outputSha256: sha256File(options.outputPath),
    answerCharacters: answerMarkdown.length,
    referenceChoiceOverride: choiceOverride.applied
      ? { applied: true, answers: choiceOverride.answers }
      : { applied: false },
    attempts: result.attempts.map(redactAttempt)
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
