import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { writeTextFileAtomic } from "../atomic-write.mjs";

import {
  assertLiveEgressAllowed,
  isRetryableGatewayFailure,
  loadGatewayConfig,
  repoRoot,
  requireValue
} from "./validate-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveDefaultPromptPath() {
  const manifestPath = path.join(repoRoot, "prompts", "junior-physics-answer", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const humanSpec = manifest?.sourceOfTruth?.humanSpec;
  if (typeof humanSpec !== "string" || humanSpec.length === 0) {
    throw new Error(`Default subject pack manifest lacks sourceOfTruth.humanSpec: ${manifestPath}`);
  }
  return path.resolve(path.dirname(manifestPath), humanSpec);
}

const TRANSPORT_TIMEOUT_GRACE_MS = 5000;
let activeTransportKey = null;

export function resolveAnswerTransportPolicy(timeoutMs, nodeOptions = process.env.NODE_OPTIONS ?? "") {
  const environmentProxyEnabled = /(?:^|\s)--use-env-proxy(?:\s|$)/.test(nodeOptions);
  return {
    applicationTimeoutMs: timeoutMs,
    headersTimeoutMs: timeoutMs + TRANSPORT_TIMEOUT_GRACE_MS,
    bodyTimeoutMs: timeoutMs + TRANSPORT_TIMEOUT_GRACE_MS,
    environmentProxyEnabled
  };
}

function configureAnswerTransport(timeoutMs) {
  const policy = resolveAnswerTransportPolicy(timeoutMs);
  const transportKey = JSON.stringify(policy);
  if (transportKey !== activeTransportKey) {
    const dispatcherOptions = {
      headersTimeout: policy.headersTimeoutMs,
      bodyTimeout: policy.bodyTimeoutMs
    };
    const dispatcher = policy.environmentProxyEnabled
      ? new EnvHttpProxyAgent(dispatcherOptions)
      : new Agent(dispatcherOptions);
    setGlobalDispatcher(dispatcher);
    activeTransportKey = transportKey;
  }
  return policy;
}

const usage = `Usage:
  npm --prefix tools/ai-gateway run generate:answer -- --allow-cloud-egress --images-dir <dir> --output <answer.md>

Options:
  --config-env-file <path>  Env file to read; defaults to .env
  --prompt-file <path>      Full answer specification; defaults to the active junior-physics spec
  --images-dir <dir>        Directory containing ordered page PNG/JPEG/WebP images
  --source-text-file <path> Optional extracted text layer from the same source PDF
  --candidate-file <path>   Blind answer Markdown to review against a reference answer
  --semantic-findings-only  Independently re-solve semantic questions without a reference answer
  --semantic-findings-file <path>  Merge a prior no-reference semantic findings report
  --audit-images-dir <dir>  High-resolution source crops/pages for a no-reference visual audit; requires --candidate-file
  --audit-findings-only     Emit visual findings without rewriting the candidate; requires --audit-images-dir
  --audit-findings-file <path>  Merge a prior visual findings report into the candidate without image input
  --reference-images-dir <dir>  Ordered reference-answer page images; requires --candidate-file
  --reference-text-file <path>  Optional extracted text layer from the same reference PDF
  --image <path>            Add one page image; deprecated, use --images-dir
  --output <path>           Markdown output path
  --summary-out <path>      Optional atomic JSON receipt for this generation stage
  --provider <target>       primary, fallback, or all; default all
  --visual-detail <mode>    low, high, or original; default original
  --max-output-tokens <n>   Maximum answer tokens; default 24000
  --timeout-ms <ms>         Per-provider timeout; default 600000
  --allow-cloud-egress      Required for live requests
`;

function parseArgs(argv) {
  const options = {
    envFile: path.join(repoRoot, ".env"),
    promptFile: null,
    imagesDir: null,
    sourceTextFile: null,
    semanticFindingsOnly: false,
    semanticFindingsFile: null,
    auditImagesDir: null,
    auditFindingsOnly: false,
    auditFindingsFile: null,
    referenceImagesDir: null,
    referenceTextFile: null,
    candidateFile: null,
    imagePaths: [],
    usedDeprecatedImageFlag: false,
    outputPath: null,
    summaryPath: null,
    provider: "all",
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
    if (arg === "--source-text-file") {
      options.sourceTextFile = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--source-text-file=")) {
      options.sourceTextFile = resolveCallerPath(arg.slice("--source-text-file=".length));
      continue;
    }
    if (arg === "--image") {
      options.imagePaths.push(resolveCallerPath(requireValue(argv, ++index, arg)));
      options.usedDeprecatedImageFlag = true;
      continue;
    }
    if (arg === "--candidate-file") {
      options.candidateFile = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--semantic-findings-only") {
      options.semanticFindingsOnly = true;
      continue;
    }
    if (arg === "--semantic-findings-file") {
      options.semanticFindingsFile = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--semantic-findings-file=")) {
      options.semanticFindingsFile = resolveCallerPath(arg.slice("--semantic-findings-file=".length));
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
      options.usedDeprecatedImageFlag = true;
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
    if (arg === "--summary-out") {
      options.summaryPath = resolveCallerPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--summary-out=")) {
      options.summaryPath = resolveCallerPath(arg.slice("--summary-out=".length));
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

  options.promptFile ??= resolveDefaultPromptPath();
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
  options.imageEvidenceLabels = [
    ...resolveImageEvidenceLabels(options.sourceImagePaths, "source"),
    ...resolveImageEvidenceLabels(options.auditImagePaths, "audit"),
    ...resolveImageEvidenceLabels(options.referenceImagePaths, "reference")
  ];
  validateOutputCollision(options);
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
  if (!options.imagesDir && options.imagePaths.length === 0 && !options.semanticFindingsFile && !options.auditImagesDir && !options.auditFindingsFile) {
    throw new Error("--images-dir, --semantic-findings-file, --audit-images-dir, --audit-findings-file, or at least one --image is required.");
  }
  if (!["primary", "fallback", "all"].includes(options.provider)) {
    throw new Error("--provider must be primary, fallback, or all.");
  }
  if (!["low", "high", "original"].includes(options.visualDetailMode)) {
    throw new Error("--visual-detail must be low, high, or original.");
  }
  if (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1000) {
    throw new Error("--max-output-tokens must be an integer >= 1000.");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000.");
  }
  if ([options.semanticFindingsFile, options.auditImagesDir, options.referenceImagesDir, options.auditFindingsFile].filter(Boolean).length > 1) {
    throw new Error("--semantic-findings-file, --audit-images-dir, --audit-findings-file, and --reference-images-dir are mutually exclusive.");
  }
  const candidateMode = Boolean(options.semanticFindingsOnly || options.semanticFindingsFile
    || options.auditImagesDir || options.auditFindingsFile || options.referenceImagesDir);
  if (Boolean(options.candidateFile) !== candidateMode) {
    throw new Error("--candidate-file must be used with exactly one semantic, visual-audit, or reference-review mode.");
  }
  if (options.candidateFile && !fs.existsSync(options.candidateFile)) {
    throw new Error(`Candidate Markdown not found: ${options.candidateFile}`);
  }
  if (options.auditFindingsOnly && !options.auditImagesDir) {
    throw new Error("--audit-findings-only requires --audit-images-dir.");
  }
  if (options.semanticFindingsOnly && (!options.imagesDir && options.imagePaths.length === 0)) {
    throw new Error("--semantic-findings-only requires --images-dir or at least one --image.");
  }
  if (options.semanticFindingsOnly && (options.semanticFindingsFile || options.auditImagesDir
      || options.auditFindingsOnly || options.auditFindingsFile || options.referenceImagesDir)) {
    throw new Error("--semantic-findings-only cannot be combined with another review mode.");
  }
  if (options.semanticFindingsFile && !fs.existsSync(options.semanticFindingsFile)) {
    throw new Error(`Semantic findings file not found: ${options.semanticFindingsFile}`);
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
  if (options.sourceTextFile && !fs.existsSync(options.sourceTextFile)) {
    throw new Error(`Source text file not found: ${options.sourceTextFile}`);
  }

}

function validateOutputCollision(options) {
  const outputPath = path.resolve(options.outputPath);
  const summaryPath = options.summaryPath ? path.resolve(options.summaryPath) : null;
  const protectedInputs = [
    options.promptFile,
    options.candidateFile,
    options.semanticFindingsFile,
    options.auditFindingsFile,
    options.sourceTextFile,
    options.referenceTextFile,
    ...options.imagePaths
  ].filter(Boolean).map((inputPath) => path.resolve(inputPath));
  const normalizePath = (filePath) => process.platform === "win32" ? filePath.toLowerCase() : filePath;
  const protectedPathKeys = new Set(protectedInputs.map(normalizePath));
  if (protectedPathKeys.has(normalizePath(outputPath))) {
    throw new Error("--output must not overwrite a prompt, candidate, findings, source text, reference text, or source image input.");
  }
  if (summaryPath && (
    protectedPathKeys.has(normalizePath(summaryPath))
    || normalizePath(summaryPath) === normalizePath(outputPath)
  )) {
    throw new Error("--summary-out must not overwrite an input or the generated Markdown output.");
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

export function resolveImageEvidenceLabels(imagePaths, role = "source") {
  const roleLabel = role === "reference"
    ? "Reference answer"
    : role === "audit"
      ? "No-reference visual audit source"
      : "Source exam";
  const manifestMaps = new Map();
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
          .map((entry) => [path.resolve(entry.imagePath), entry])));
      }
    }
    const entry = manifestMaps.get(directory)?.get(path.resolve(imagePath));
    if (!entry) {
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
      "抛开候选结论，重新独立解答全部选择题，以及所有涉及状态变化、惯性方向、故障电路、能量分段、物态变化、透镜类型、受力和定性比较的小问。只输出语义复核发现报告，不得重写完整答案。\n" +
      "每个选择题必须逐项核对 A、B、C、D：分别写一句最短的成立或不成立依据，再给独立结论。过程或图像题必须按题型写出可检查的中间结构：状态题列初态—变化—终态；方向题列坐标系—相对位移—物理关系—方向；故障电路列故障前后各支路状态、仪表测量对象和比较量；图像题必须按横轴所有拐点划分每个区间，逐段写自变量趋势、因变量趋势以及由此推出的物理量变化，禁止把先变化后恒定压缩为单一趋势；透镜题先写入射与折射光线发散或会聚变化。\n" +
      "下面的逐题候选索引由程序从分组答案串确定性展开，比较时必须使用它，不得凭记忆、位置直觉或正文重建候选字母。每个选择题必须以 `### 第N题` 开头，并分别输出独立行 `独立结论：X`、`候选结论：Y` 和标签。\n" +
      `${indexedChoiceCandidate}\n\n` +
      "若独立结论与候选不同，只有同时具备【语义确认修正】、候选具体字段、原题可见事实、完整的上述题型结构和“建议修正”时才可进入合并；任一环节无法确认则标【语义证据不足，需复核】，不得猜测。标签必须与正文结论一致：正文推理一旦推出候选需要变化，禁止标【语义一致】，必须按证据充分程度标【语义确认修正】或【语义证据不足，需复核】。与候选一致的题写【语义一致】并给最短依据。\n" +
      "图片标签中的 measured 确定性几何结果属于原卷像素测量，可直接作为对应读数或几何事实；标签为 uncertain 时不得推断数值。不要输出参考答案、内部思维过程、JSON 或代码围栏。\n\n" +
      `## 盲答候选\n\n${review.candidateMarkdown.trim()}`;
  }
  if (review.mode === "semantic_review_merge") {
    return `${specification}\n\n---\n\n# 无参考答案语义复核合并任务\n\n` +
      "下面给出原始盲答候选和独立语义复核发现报告。只应用明确标为【语义确认修正】、同时包含候选具体字段、原题可见事实、题型要求的完整可检查结构和“建议修正”的项目。标为【语义一致】或【语义证据不足，需复核】的项目必须保留候选原文。\n" +
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
    const independentMatches = [...body.matchAll(/独立结论\s*：\s*([A-D])/igu)];
    const candidateMatches = [...body.matchAll(/候选结论\s*：\s*([A-D])/igu)];
    const independent = independentMatches.length === 1 ? independentMatches[0][1].toUpperCase() : null;
    const candidate = candidateMatches.length === 1 ? candidateMatches[0][1].toUpperCase() : null;
    if (independent && candidate && independent !== candidate && /建议修正\s*：/u.test(body)) {
      corrections.set(Number(block[1]), independent);
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
      const answer = corrections.get(question);
      if (answer) {
        current[question - range.start] = answer;
        applied.push(question);
      }
    }
    lines[lineIndex] = `${range.start}—${range.end}：${current.join("、")}`;
  }
  return { markdown: lines.join("\n"), applied: applied.length > 0, questions: applied };
}

function normalizeDetailForProvider(detail, visionModel) {
  if (detail !== "original") {
    return detail;
  }
  // GPT-5.6 supports the original image dimensions; older-compatible gateways
  // still receive high detail because they may reject the newer value.
  return /^gpt-5\.6(?:-|$)/iu.test(visionModel ?? "") ? "original" : "high";
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

function resolveImageDataUrls(options) {
  if (Array.isArray(options.imageDataUrls)) {
    return options.imageDataUrls;
  }
  return options.imagePaths.map(imageDataUrl);
}

function buildImageContentParts(surface, imageDataUrls, imageEvidenceLabels, detail) {
  if (imageEvidenceLabels.length > 0 && imageEvidenceLabels.length !== imageDataUrls.length) {
    throw new Error("Image evidence labels must align one-to-one with ordered images.");
  }
  return imageDataUrls.flatMap((imageUrl, index) => {
    const label = imageEvidenceLabels[index];
    if (surface === "chat_completions") {
      return [
        ...(label ? [{ type: "text", text: `[Image evidence ${index + 1}/${imageDataUrls.length}] ${label}` }] : []),
        { type: "image_url", image_url: { url: imageUrl, detail } }
      ];
    }
    return [
      ...(label ? [{ type: "input_text", text: `[Image evidence ${index + 1}/${imageDataUrls.length}] ${label}` }] : []),
      { type: "input_image", image_url: imageUrl, detail }
    ];
  });
}

export function buildAnswerRequestBody(provider, options) {
  const detail = normalizeDetailForProvider(options.visualDetailMode, provider.visionModel);
  const imageDataUrls = resolveImageDataUrls(options);
  const imageEvidenceLabels = Array.isArray(options.imageEvidenceLabels) ? options.imageEvidenceLabels : [];
  if (provider.visionSurface === "chat_completions") {
    return {
      model: provider.visionModel,
      ...(provider.reasoningEffort ? { reasoning_effort: provider.reasoningEffort } : {}),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: options.prompt },
            ...buildImageContentParts("chat_completions", imageDataUrls, imageEvidenceLabels, detail)
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
          ...buildImageContentParts("responses", imageDataUrls, imageEvidenceLabels, detail)
        ]
      }
    ],
    max_output_tokens: options.maxOutputTokens
  };
}

const TASK_MODES = new Set([
  "blind_generation",
  "semantic_review_findings",
  "semantic_review_merge",
  "visual_audit",
  "visual_audit_findings",
  "visual_audit_merge",
  "reference_review"
]);

const SOLVING_MODEL = "gpt-5.6-sol";
const SOLVING_REASONING_EFFORTS = ["xhigh", "high", "medium"];

function inferAnswerMode(options = {}) {
  if (TASK_MODES.has(options.mode)) {
    return options.mode;
  }
  if (options.semanticFindingsOnly) {
    return "semantic_review_findings";
  }
  if (options.semanticFindingsFile || options.semanticFindings) {
    return "semantic_review_merge";
  }
  if (options.auditFindingsOnly) {
    return "visual_audit_findings";
  }
  if (options.auditFindingsFile || options.auditFindings) {
    return "visual_audit_merge";
  }
  if (options.auditImagesDir || options.auditImagePaths?.length > 0) {
    return "visual_audit";
  }
  if (options.referenceImagesDir || options.referenceImagePaths?.length > 0) {
    return "reference_review";
  }
  return "blind_generation";
}

export function selectAnswerRoute(config, modeOrOptions = {}, target = "all") {
  const mode = typeof modeOrOptions === "string" ? modeOrOptions : inferAnswerMode(modeOrOptions);
  const requiresSolvingModel = mode === "blind_generation"
    || mode === "semantic_review_findings"
    || mode === "semantic_review_merge";
  const providers = config.providers
    .filter((provider) => provider.lane === "ai")
    .filter((provider) => !requiresSolvingModel
      || (provider.visionModel === SOLVING_MODEL
        && SOLVING_REASONING_EFFORTS.includes(provider.reasoningEffort)))
    .filter((provider) => target === "all"
      || (target === "primary" && provider.role === "primary")
      || (target === "fallback" && provider.role.startsWith("fallback")))
    .sort((left, right) => requiresSolvingModel
      ? SOLVING_REASONING_EFFORTS.indexOf(left.reasoningEffort) - SOLVING_REASONING_EFFORTS.indexOf(right.reasoningEffort)
        || providerOrder(left.role) - providerOrder(right.role)
      : providerOrder(left.role) - providerOrder(right.role));
  return {
    mode,
    target,
    selectedRole: providers[0]?.role ?? null,
    orderedRoles: providers.map((provider) => provider.role),
    providers
  };
}

function routingReceipt(route) {
  return {
    mode: route.mode,
    selectedRole: route.selectedRole,
    orderedRoles: route.orderedRoles,
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
  const startedAt = Date.now();
  const requestBody = JSON.stringify(buildAnswerRequestBody(provider, options));
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
      body: requestBody
    });
    const bodyText = await response.text();
    if (!response.ok) {
      return {
        provider: provider.role,
        model: provider.visionModel,
        reasoningEffort: provider.reasoningEffort || null,
        attemptNumber: options.attemptNumber ?? 1,
        durationMs: Date.now() - startedAt,
        requestBytes: Buffer.byteLength(requestBody),
        transport: options.transportPolicy,
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
        model: provider.visionModel,
        reasoningEffort: provider.reasoningEffort || null,
        attemptNumber: options.attemptNumber ?? 1,
        durationMs: Date.now() - startedAt,
        requestBytes: Buffer.byteLength(requestBody),
        transport: options.transportPolicy,
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
      attemptNumber: options.attemptNumber ?? 1,
      durationMs: Date.now() - startedAt,
      requestBytes: Buffer.byteLength(requestBody),
      transport: options.transportPolicy,
      ok: answerMarkdown.length > 0,
      retryable: false,
      status: response.status,
      answerMarkdown,
      error: answerMarkdown.length > 0 ? "" : "Provider response did not contain answer Markdown."
    };
  } catch (error) {
    return {
      provider: provider.role,
      model: provider.visionModel,
      reasoningEffort: provider.reasoningEffort || null,
      attemptNumber: options.attemptNumber ?? 1,
      durationMs: Date.now() - startedAt,
      requestBytes: Buffer.byteLength(requestBody),
      transport: options.transportPolicy,
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
  const transportPolicy = configureAnswerTransport(options.timeoutMs);
  const mode = inferAnswerMode(options);
  const route = selectAnswerRoute(config, mode, options.provider);
  const providers = route.providers;
  if (providers.length === 0) {
    if (mode === "blind_generation") {
      throw new Error(`Blind answer generation requires ${SOLVING_MODEL}/${SOLVING_REASONING_EFFORTS.join(" or ")}; no matching ${options.provider ?? "all"} provider is configured.`);
    }
    throw new Error(`No ${options.provider ?? "all"} AI provider is configured for answer generation.`);
  }

  const attempts = [];
  const requestOptions = {
    ...options,
    transportPolicy,
    imageDataUrls: resolveImageDataUrls(options)
  };
  for (const provider of providers) {
    const attempt = await callProvider(provider, { ...requestOptions, attemptNumber: 1 });
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

function redactAttempt(attempt) {
  return {
    provider: attempt.provider,
    model: attempt.model ?? null,
    reasoningEffort: attempt.reasoningEffort ?? null,
    status: attempt.status,
    ok: attempt.ok,
    retryable: attempt.retryable,
    attemptNumber: attempt.attemptNumber ?? 1,
    durationMs: attempt.durationMs ?? null,
    requestBytes: attempt.requestBytes ?? null,
    transport: attempt.transport ?? null,
    error: attempt.error ? attempt.error.slice(0, 500) : ""
  };
}

export function buildAnswerRoutingSummary(result) {
  return {
    ...result.routing,
    resolvedRole: result.provider,
    attemptedRoles: result.attempts.map((attempt) => attempt.provider)
  };
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = inferAnswerMode(options);
  if (options.usedDeprecatedImageFlag) {
    console.error("[deprecated] --image is deprecated and will be removed on 2026-09-30; use --images-dir.");
  }
  if (mode === "visual_audit") {
    console.error("[deprecated] full visual_audit rewrite mode is deprecated and will be removed on 2026-09-30; pass --audit-findings-only with --audit-images-dir.");
  }
  const loaded = loadGatewayConfig({ envFile: options.envFile, allowMissingSecrets: false });
  if (loaded.validation.errors.length > 0) {
    throw new Error(loaded.validation.errors.join("; "));
  }
  const promptContext = {
    sourceText: options.sourceTextFile ? fs.readFileSync(options.sourceTextFile, "utf8") : ""
  };
  const prompt = buildPrompt(options.promptFile, options.candidateFile ? {
    ...promptContext,
    mode,
    candidateMarkdown: fs.readFileSync(options.candidateFile, "utf8"),
    semanticFindings: options.semanticFindingsFile ? fs.readFileSync(options.semanticFindingsFile, "utf8") : "",
    auditFindings: options.auditFindingsFile ? fs.readFileSync(options.auditFindingsFile, "utf8") : "",
    referenceText: options.referenceTextFile ? fs.readFileSync(options.referenceTextFile, "utf8") : "",
    sourcePageCount: options.sourceImagePaths.length,
    auditImageCount: options.auditImagePaths.length,
    referencePageCount: options.referenceImagePaths.length
  } : promptContext);
  const result = await requestAnswerWithFailover(loaded.config, { ...options, prompt });
  if (!result.ok) {
    throw new Error(`${result.error}\n${JSON.stringify(result.attempts.map(redactAttempt), null, 2)}`);
  }

  const semanticChoiceOverride = options.semanticFindingsFile
    ? applySemanticChoiceFindings(
        result.answerMarkdown,
        fs.readFileSync(options.semanticFindingsFile, "utf8"),
        options.candidateFile ? fs.readFileSync(options.candidateFile, "utf8") : result.answerMarkdown
      )
    : { markdown: result.answerMarkdown, applied: false, questions: [] };
  // Reference Review is authoritative when a reference text is present; otherwise
  // only explicitly confirmed semantic choice corrections may be applied.
  const referenceChoiceOverride = options.referenceTextFile
    ? applyReferenceChoiceAnswers(result.answerMarkdown, fs.readFileSync(options.referenceTextFile, "utf8"))
    : { markdown: semanticChoiceOverride.markdown, applied: false, answers: null };
  const answerMarkdown = options.referenceTextFile
    ? referenceChoiceOverride.markdown
    : semanticChoiceOverride.markdown;
  writeTextFileAtomic(options.outputPath, `${answerMarkdown}\n`);
  const summary = {
    schemaVersion: "1.1",
    kind: "live-answer-generation-summary",
    generatedAt: new Date().toISOString(),
    provider: result.provider,
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    promptPath: path.relative(repoRoot, options.promptFile).replace(/\\/g, "/"),
    promptSha256: sha256File(options.promptFile),
    mode,
    sourcePageCount: options.sourceImagePaths.length,
    auditImageCount: options.auditImagePaths.length,
    referencePageCount: options.referenceImagePaths.length,
    requestedVisualDetailMode: options.visualDetailMode,
    providerVisualDetailMode: normalizeDetailForProvider(options.visualDetailMode, result.model),
    routing: buildAnswerRoutingSummary(result),
    candidatePath: options.candidateFile,
    candidateSha256: options.candidateFile ? sha256File(options.candidateFile) : null,
    semanticFindingsPath: options.semanticFindingsFile,
    semanticFindingsSha256: options.semanticFindingsFile ? sha256File(options.semanticFindingsFile) : null,
    auditFindingsPath: options.auditFindingsFile,
    auditFindingsSha256: options.auditFindingsFile ? sha256File(options.auditFindingsFile) : null,
    sourceTextPath: options.sourceTextFile,
    sourceTextSha256: options.sourceTextFile ? sha256File(options.sourceTextFile) : null,
    referenceTextPath: options.referenceTextFile,
    referenceTextSha256: options.referenceTextFile ? sha256File(options.referenceTextFile) : null,
    pageCount: options.imagePaths.length,
    pageImages: options.imagePaths.map((imagePath, index) => ({
      path: imagePath,
      sha256: sha256File(imagePath),
      evidenceLabel: options.imageEvidenceLabels[index] ?? null
    })),
    outputPath: options.outputPath,
    outputSha256: sha256File(options.outputPath),
    answerCharacters: answerMarkdown.length,
    referenceChoiceOverride: referenceChoiceOverride.applied
      ? { applied: true, answers: referenceChoiceOverride.answers }
      : { applied: false },
    semanticChoiceOverride: {
      applied: semanticChoiceOverride.applied,
      questions: semanticChoiceOverride.questions
    },
    attempts: result.attempts.map(redactAttempt)
  };
  const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;
  if (options.summaryPath) {
    writeTextFileAtomic(options.summaryPath, summaryJson);
  }
  console.log(summaryJson.trimEnd());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
