import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateAnswerGenerationRequestShape, validateAnswerGenerationResultShape } from "./synthetic-generator.mjs";
import { loadGatewayConfig, repoRoot, requestTextWithFailover, requireValue } from "../ai-gateway/validate-config.mjs";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_ANSWER_BYTES = 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readFile(filePath, label) {
  const resolved = fs.realpathSync.native(path.resolve(filePath));
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) {
    throw new Error(`${label} must be a file no larger than ${MAX_INPUT_BYTES} bytes.`);
  }
  return { path: resolved, bytes: fs.readFileSync(resolved) };
}

function assertWithin(filePath, rootPath, label) {
  const relative = path.relative(normalize(rootPath), normalize(filePath));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its authority root.`);
  }
}

function normalize(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertOutside(outputDir, roots) {
  const resolved = path.resolve(outputDir);
  for (const root of roots) {
    const relative = path.relative(normalize(root), normalize(resolved));
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("Provider generation output must be outside workspace and repository authority.");
    }
  }
  const parent = fs.realpathSync.native(path.dirname(resolved));
  for (const root of roots) {
    const relative = path.relative(normalize(root), normalize(parent));
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("Provider generation output must be outside workspace and repository authority.");
    }
  }
  if (fs.existsSync(resolved)) {
    throw new Error("Provider generation output directory must not already exist.");
  }
  return resolved;
}

function buildPrompt(subjectPack, instructionBytes, problemBytes) {
  return [
    "Generate a classroom reference answer in Markdown.",
    "Return only answer Markdown. Do not include wrapper fences or commentary about the request.",
    `Subject pack: ${subjectPack}`,
    "",
    "## Instruction authority",
    instructionBytes.toString("utf8"),
    "",
    "## Problem authority",
    problemBytes.toString("utf8")
  ].join("\n");
}

function validateProviderResultBoundary(result) {
  validateAnswerGenerationResultShape(result);
  const fixed = {
    reviewRequired: true,
    trusted: false,
    acceptanceDisposition: "pending_review",
    workflowDisposition: "not_integrated"
  };
  if (result.provenance.providerKind !== "model_provider"
    || result.provenance.liveProvider !== true
    || result.provenance.cloudEgress !== true
    || JSON.stringify(result.generationDisposition) !== JSON.stringify(fixed)) {
    throw new Error("Provider generation result boundary drifted.");
  }
}

export async function runProviderGeneration(options) {
  const workspaceRoot = fs.realpathSync.native(path.resolve(options.workspaceRoot));
  const instructionRoot = fs.realpathSync.native(path.resolve(options.instructionRoot ?? repoRoot));
  const requestArtifact = readFile(options.requestPath, "AnswerGenerationRequest");
  assertWithin(requestArtifact.path, workspaceRoot, "AnswerGenerationRequest");
  const request = JSON.parse(requestArtifact.bytes.toString("utf8").replace(/^\uFEFF/, ""));
  validateAnswerGenerationRequestShape(request);
  if (request.dataClassification?.level !== "public") {
    throw new Error("Provider generation currently admits public data only.");
  }
  if (request.egressPolicy?.allowCloud !== true) {
    throw new Error("Provider generation request egress policy must explicitly allow cloud.");
  }
  if (options.allowCloudEgress !== true) {
    throw new Error("Provider generation requires explicit runtime cloud-egress authorization.");
  }
  if (!request.instructionAuthority) {
    throw new Error("Provider generation requires instruction authority.");
  }

  const problem = readFile(path.resolve(path.dirname(requestArtifact.path), request.problemArtifactRef), "problem artifact");
  assertWithin(problem.path, workspaceRoot, "problem artifact");
  if (sha256(problem.bytes) !== request.problemArtifactSha256) {
    throw new Error("Problem authority drifted.");
  }
  const expectedInstructionRef = `prompts/${request.subjectPack}/spec.md`;
  if (request.instructionAuthority.artifactRef.replaceAll("\\", "/") !== expectedInstructionRef) {
    throw new Error("Instruction authority must bind the subject-pack spec.");
  }
  const instruction = readFile(path.resolve(instructionRoot, request.instructionAuthority.artifactRef), "instruction authority");
  assertWithin(instruction.path, instructionRoot, "instruction authority");
  if (sha256(instruction.bytes) !== request.instructionAuthority.rawByteSha256) {
    throw new Error("Instruction authority drifted.");
  }

  const outputDir = assertOutside(options.outputDir, [workspaceRoot, fs.realpathSync.native(repoRoot)]);
  if (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 256 || options.maxOutputTokens > 16384) {
    throw new Error("maxOutputTokens must be an integer from 256 through 16384.");
  }
  const snapshots = new Map([
    [requestArtifact.path, requestArtifact.bytes],
    [problem.path, problem.bytes],
    [instruction.path, instruction.bytes],
    ...(options.additionalSnapshots ?? [])
  ]);
  const providerResult = await requestTextWithFailover(options.config, {
    allowCloudEgress: true,
    prompt: buildPrompt(request.subjectPack, instruction.bytes, problem.bytes),
    timeoutMs: options.timeoutMs,
    maxOutputTokens: options.maxOutputTokens
  });
  if (!providerResult.ok) {
    throw new Error(`Provider generation failed: ${providerResult.error ?? "no provider returned output"}`);
  }
  for (const [inputPath, bytes] of snapshots) {
    if (!fs.readFileSync(inputPath).equals(bytes)) {
      throw new Error("Provider generation input drifted during execution.");
    }
  }

  const markdown = providerResult.output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd() + "\n";
  const candidateBytes = Buffer.from(markdown, "utf8");
  if (candidateBytes.length === 1 || candidateBytes.length > MAX_ANSWER_BYTES || markdown.includes("\u0000")) {
    throw new Error("Provider answer Markdown is empty, oversized, or contains NUL.");
  }
  const provider = options.config.providers.find((item) => item.lane === "ai" && item.role === providerResult.provider);
  if (!provider) {
    throw new Error("Successful provider provenance is missing from current config.");
  }
  const result = {
    schemaVersion: "1.0",
    kind: "answer-generation-result",
    requestId: request.requestId,
    subjectPack: request.subjectPack,
    sourceRequestSha256: sha256(requestArtifact.bytes),
    answerMarkdown: markdown,
    candidateArtifactRef: "answer.md",
    rawAnswerSha256: sha256(candidateBytes),
    dataClassification: request.dataClassification,
    provenance: {
      providerKind: "model_provider",
      providerId: provider.role,
      providerVersion: provider.textModel,
      liveProvider: true,
      providerSurface: provider.textSurface,
      attemptCount: providerResult.attempts.length,
      cloudEgress: true
    },
    generationDisposition: {
      reviewRequired: true,
      trusted: false,
      acceptanceDisposition: "pending_review",
      workflowDisposition: "not_integrated"
    },
    stopReason: "provider_generated_pending_review"
  };
  validateProviderResultBoundary(result);
  const resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8");
  const stage = fs.mkdtempSync(path.join(path.dirname(outputDir), `.${path.basename(outputDir)}-`));
  try {
    fs.writeFileSync(path.join(stage, "answer.md"), candidateBytes, { flag: "wx" });
    fs.writeFileSync(path.join(stage, "answer-generation-result.json"), resultBytes, { flag: "wx" });
    if (!fs.readFileSync(path.join(stage, "answer.md")).equals(candidateBytes)
      || !fs.readFileSync(path.join(stage, "answer-generation-result.json")).equals(resultBytes)) {
      throw new Error("Provider generation staged output drifted.");
    }
    fs.renameSync(stage, outputDir);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return { result, outputDir };
}

function parseArgs(argv) {
  const options = { instructionRoot: repoRoot, envFile: path.join(repoRoot, ".env"), timeoutMs: 30000, maxOutputTokens: 4096, allowCloudEgress: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-cloud-egress") { options.allowCloudEgress = true; continue; }
    const keys = { "--request": "requestPath", "--workspace-root": "workspaceRoot", "--instruction-root": "instructionRoot", "--out": "outputDir", "--config-env-file": "envFile", "--timeout-ms": "timeoutMs", "--max-output-tokens": "maxOutputTokens" };
    if (keys[arg]) { options[keys[arg]] = requireValue(argv, ++index, arg); continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ["requestPath", "workspaceRoot", "outputDir"]) {
    if (!options[key]) throw new Error(`Provider generation requires ${key}.`);
  }
  options.timeoutMs = Number(options.timeoutMs);
  options.maxOutputTokens = Number(options.maxOutputTokens);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envSnapshot = fs.readFileSync(path.resolve(options.envFile));
  const loaded = loadGatewayConfig({ envFile: path.resolve(options.envFile), allowMissingSecrets: false });
  if (loaded.validation.errors.length) throw new Error(loaded.validation.errors.join("\n"));
  const completed = await runProviderGeneration({
    ...options,
    config: loaded.config,
    additionalSnapshots: [[fs.realpathSync.native(path.resolve(options.envFile)), envSnapshot]]
  });
  process.stdout.write(`${JSON.stringify({ status: "ok", outputDir: completed.outputDir, result: completed.result }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
