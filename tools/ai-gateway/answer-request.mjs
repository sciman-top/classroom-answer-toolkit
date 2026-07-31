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
  --reference-images-dir <dir>  Ordered reference-answer page images; requires --candidate-file
  --reference-text-file <path>  Optional extracted text layer from the same reference PDF
  --image <path>            Add one page image; repeat for multiple pages
  --output <path>           Markdown output path
  --provider <target>       primary, fallback, or all; default all
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
    referenceImagesDir: null,
    referenceTextFile: null,
    candidateFile: null,
    imagePaths: [],
    outputPath: null,
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
    if (arg === "--image") {
      options.imagePaths.push(resolveCallerPath(requireValue(argv, ++index, arg)));
      continue;
    }
    if (arg === "--candidate-file") {
      options.candidateFile = resolveCallerPath(requireValue(argv, ++index, arg));
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
  options.sourceImagePaths = resolveOrderedImages(options);
  options.referenceImagePaths = options.referenceImagesDir
    ? resolveImagesFromDirectory(options.referenceImagesDir)
    : [];
  options.imagePaths = [...options.sourceImagePaths, ...options.referenceImagePaths];
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
  if (!options.imagesDir && options.imagePaths.length === 0) {
    throw new Error("--images-dir or at least one --image is required.");
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
  if (Boolean(options.candidateFile) !== Boolean(options.referenceImagesDir)) {
    throw new Error("--candidate-file and --reference-images-dir must be used together.");
  }
  if (options.candidateFile && !fs.existsSync(options.candidateFile)) {
    throw new Error(`Candidate Markdown not found: ${options.candidateFile}`);
  }
  if (options.referenceTextFile && !options.candidateFile) {
    throw new Error("--reference-text-file requires --candidate-file.");
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
  return unfenced.replace(/\$([A-D](?:['′])?(?:[、，][A-D](?:['′])?)*)\$/g, "$1");
}

function extractTenChoiceAnswers(referenceText) {
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

function orderedProviders(config, target = "all") {
  return config.providers
    .filter((provider) => provider.lane === "ai")
    .filter((provider) => target === "all"
      || (target === "primary" && provider.role === "primary")
      || (target === "fallback" && provider.role.startsWith("fallback")))
    .sort((left, right) => providerOrder(left.role) - providerOrder(right.role));
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
      error: error instanceof Error ? error.message : String(error)
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
  const providers = orderedProviders(config, options.provider);
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
        attempts
      };
    }
    if (!attempt.retryable) {
      return { ok: false, provider: provider.role, answerMarkdown: "", attempts, error: attempt.error };
    }
  }
  return {
    ok: false,
    provider: attempts.at(-1)?.provider ?? null,
    answerMarkdown: "",
    attempts,
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
    candidateMarkdown: fs.readFileSync(options.candidateFile, "utf8"),
    referenceText: options.referenceTextFile ? fs.readFileSync(options.referenceTextFile, "utf8") : "",
    sourcePageCount: options.sourceImagePaths.length,
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
    mode: options.candidateFile ? "reference_review" : "blind_generation",
    sourcePageCount: options.sourceImagePaths.length,
    referencePageCount: options.referenceImagePaths.length,
    candidatePath: options.candidateFile,
    candidateSha256: options.candidateFile ? sha256File(options.candidateFile) : null,
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
