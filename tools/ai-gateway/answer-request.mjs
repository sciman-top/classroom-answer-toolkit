import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeTextFileAtomic } from "../atomic-write.mjs";
import { sha256File, parseArgvFlags } from "../shared.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

import {
  applyReferenceChoiceAnswers,
  applySemanticChoiceFindings,
  buildPrompt,
  extractTenChoiceAnswers,
  resolveDefaultPromptPath,
  resolveImageEvidenceLabels
} from "./answer-tasks.mjs";
import {
  buildAnswerRequestBody,
  inferAnswerMode,
  normalizeDetailForProvider,
  normalizeQualityProfile,
  requestAnswerWithFailover,
  resolveAnswerTransportPolicy,
  selectAnswerRoute
} from "./answer-transport.mjs";
import { QUALITY_PROFILE_NAMES } from "./profile-matrix.mjs";
import { loadGatewayConfig, repoRoot } from "./validate-config.mjs";

const summarySchemaPath = path.join(
  repoRoot,
  "prompts",
  "shared",
  "schemas",
  "live-answer-generation-summary.schema.json"
);

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
  --audit-images-dir <dir>  High-resolution source crops/pages for a no-reference visual audit; requires --candidate-file and --audit-findings-only
  --audit-findings-only     Emit visual findings without rewriting the candidate; requires --audit-images-dir
  --audit-findings-file <path>  Merge a prior visual findings report into the candidate without image input
  --reference-images-dir <dir>  Ordered reference-answer page images; requires --candidate-file
  --reference-text-file <path>  Optional extracted text layer from the same reference PDF
  --output <path>           Markdown output path
  --summary-out <path>      Optional atomic JSON receipt for this generation stage
  --provider <target>       primary, fallback, or all; default all
  --quality-profile <name>  auto, sol-high, sol-medium, sol-low, terra-max, terra-xhigh, terra-high, luna-max, luna-xhigh, or luna-high; default auto
  --visual-detail <mode>    low, high, or original; default original
  --max-output-tokens <n>   Maximum answer tokens; default 24000
  --timeout-ms <ms>         Per-provider timeout; default 600000
  --allow-cloud-egress      Required for live requests
`;

// Paths resolve against the caller's working directory (INIT_CWD), matching
// the npm-script invocation contract; plain values (provider, quality-profile)
// stay strings for validateOptions to police.
const CALLER_PATH_KEYS = [
  "envFile",
  "promptFile",
  "imagesDir",
  "sourceTextFile",
  "candidateFile",
  "semanticFindingsFile",
  "auditImagesDir",
  "auditFindingsFile",
  "referenceImagesDir",
  "referenceTextFile",
  "outputPath",
  "summaryPath"
];

function parseArgs(argv) {
  const options = parseArgvFlags(argv, {
    stringFlags: {
      "config-env-file": "envFile",
      "prompt-file": "promptFile",
      "images-dir": "imagesDir",
      "source-text-file": "sourceTextFile",
      "candidate-file": "candidateFile",
      "semantic-findings-file": "semanticFindingsFile",
      "audit-images-dir": "auditImagesDir",
      "audit-findings-file": "auditFindingsFile",
      "reference-images-dir": "referenceImagesDir",
      "reference-text-file": "referenceTextFile",
      output: "outputPath",
      "summary-out": "summaryPath",
      provider: true,
      "quality-profile": "qualityProfile",
      "visual-detail": "visualDetailMode",
      "max-output-tokens": "maxOutputTokens",
      "timeout-ms": "timeoutMs"
    },
    booleanFlags: {
      "semantic-findings-only": "semanticFindingsOnly",
      "audit-findings-only": "auditFindingsOnly",
      "allow-cloud-egress": "allowCloudEgress"
    },
    defaults: {
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
      outputPath: null,
      summaryPath: null,
      provider: "all",
      qualityProfile: "auto",
      visualDetailMode: "original",
      maxOutputTokens: 24000,
      timeoutMs: 600000,
      allowCloudEgress: false
    },
    help: true,
    unknownFlag: "error"
  });

  if (options.help) {
    console.log(usage);
    process.exit(0);
  }

  for (const key of CALLER_PATH_KEYS) {
    if (options[key] !== null) {
      options[key] = resolveCallerPath(options[key]);
    }
  }
  options.maxOutputTokens = Number(options.maxOutputTokens);
  options.timeoutMs = Number(options.timeoutMs);

  options.promptFile ??= resolveDefaultPromptPath();
  validateOptions(options);
  options.sourceImagePaths = options.imagesDir
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
  if (!options.imagesDir && !options.semanticFindingsFile && !options.auditImagesDir && !options.auditFindingsFile) {
    throw new Error("--images-dir, --semantic-findings-file, --audit-images-dir, or --audit-findings-file is required.");
  }
  if (!["primary", "fallback", "all"].includes(options.provider)) {
    throw new Error("--provider must be primary, fallback, or all.");
  }
  if (!QUALITY_PROFILE_NAMES.has(normalizeQualityProfile(options.qualityProfile))) {
    throw new Error(`--quality-profile must be auto or one of ${[...QUALITY_PROFILE_NAMES].filter((name) => name !== "auto").join(", ")}.`);
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
  if (options.auditImagesDir && !options.auditFindingsOnly) {
    // The whole-paper visual_audit rewrite mode was removed; audit images are
    // only valid for the findings-only pass.
    throw new Error("--audit-images-dir requires --audit-findings-only.");
  }
  if (options.semanticFindingsOnly && !options.imagesDir) {
    throw new Error("--semantic-findings-only requires --images-dir.");
  }
  if (options.semanticFindingsFile && !options.imagesDir) {
    throw new Error("Semantic merge requires --images-dir.");
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
  const imagePaths = resolveImagesFromDirectory(options.imagesDir);

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

function redactAttempt(attempt) {
  return {
    provider: attempt.provider,
    model: attempt.model ?? null,
    reasoningEffort: attempt.reasoningEffort ?? null,
    preset: attempt.preset ?? null,
    qualityProfile: attempt.qualityProfile ?? null,
    executionSlot: attempt.executionSlot ?? null,
    status: attempt.status,
    retryAfterMs: attempt.retryAfterMs ?? null,
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
  if (options.referenceTextFile) {
    // A self-contradictory reference input is a local error: reject it before any paid request.
    extractTenChoiceAnswers(fs.readFileSync(options.referenceTextFile, "utf8"));
  }
  const result = await requestAnswerWithFailover(loaded.config, { ...options, prompt });
  if (!result.ok) {
    throw new Error(`${result.error}\n${JSON.stringify(result.attempts.map(redactAttempt), null, 2)}`);
  }

  // Persist the paid raw output before any override or summary step can
  // throw; losing a completed generation to post-processing is unrecoverable.
  writeTextFileAtomic(options.outputPath, `${result.answerMarkdown}\n`);

  const semanticChoiceOverride = options.semanticFindingsFile
    ? applySemanticChoiceFindings(
        result.answerMarkdown,
        fs.readFileSync(options.semanticFindingsFile, "utf8"),
        options.candidateFile ? fs.readFileSync(options.candidateFile, "utf8") : result.answerMarkdown
      )
    : { markdown: result.answerMarkdown, applied: false, questions: [], overriddenModelLetters: 0 };
  if (options.semanticFindingsFile && !semanticChoiceOverride.applied) {
    // Confirmed corrections that match no choice line must be visible; silently
    // dropping them is indistinguishable from "the report had no corrections".
    console.error(
      "[gateway] Semantic findings file was supplied but no confirmed correction "
      + `matched a choice line (${options.semanticFindingsFile}); overrides skipped.`);
  }
  if (semanticChoiceOverride.overriddenModelLetters > 0) {
    // The merge model's own choice-line edits are never authoritative, but a
    // deterministic rebuild replacing them (e.g. a model-applied fix the
    // findings parser did not recognize) must stay visible to the operator.
    console.error(
      "[gateway] Deterministic choice rebuild replaced the merged model's letters on "
      + `${semanticChoiceOverride.overriddenModelLetters} answer line(s); `
      + "frozen baseline + confirmed corrections are authoritative.");
  }
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
    schemaVersion: "1.2",
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
      questions: semanticChoiceOverride.questions,
      overriddenModelLetters: semanticChoiceOverride.overriddenModelLetters ?? 0
    },
    attempts: result.attempts.map(redactAttempt)
  };
  const summaryErrors = validateValueAgainstSchema(summary, summarySchemaPath);
  if (summaryErrors.length > 0) {
    throw new Error(
      `Generation summary failed schema validation (${path.relative(repoRoot, summarySchemaPath)}):\n`
      + summaryErrors.map((error) => `  ${error}`).join("\n"));
  }
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
