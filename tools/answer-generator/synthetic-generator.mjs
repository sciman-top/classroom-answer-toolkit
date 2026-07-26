import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolRoot, "..", "..");
const requestRoot = path.join(repoRoot, "eval", "answer-generation", "cases");
const sampleRoot = fs.realpathSync.native(path.join(repoRoot, "样例交付"));
const packageRoot = path.join(
  sampleRoot,
  "structured",
  "math-answer",
  "synthetic-linear-equation");
const schemaRoot = path.join(repoRoot, "prompts", "shared", "schemas");
const requestSchema = path.join(schemaRoot, "answer-generation-request.schema.json");
const resultSchema = path.join(schemaRoot, "answer-generation-result.schema.json");

const fixtureDefinitions = new Map([
  [
    "synthetic-arithmetic-slip",
    {
      requestFile: "synthetic-arithmetic-slip.answer-generation-request.json",
      candidateFile: "candidate.generated-arithmetic-slip.md",
      resultFile: "candidate.generated-arithmetic-slip.answer-generation-result.json",
      answerMarkdown: "# Synthetic generated answer\n\n`2x + 3 = 11`\n\n`2x = 4`\n\n`x = 2`\n"
    }
  ],
  [
    "synthetic-transposition-slip",
    {
      requestFile: "synthetic-transposition-slip.answer-generation-request.json",
      candidateFile: "candidate.generated-transposition-slip.md",
      resultFile: "candidate.generated-transposition-slip.answer-generation-result.json",
      answerMarkdown: "# Synthetic generated answer\n\n`2x + 3 = 11`\n\n`2x = 10`\n\n`x = 5`\n"
    }
  ],
  [
    "synthetic-format-omission",
    {
      requestFile: "synthetic-format-omission.answer-generation-request.json",
      candidateFile: "candidate.generated-format-omission.md",
      resultFile: "candidate.generated-format-omission.answer-generation-result.json",
      answerMarkdown: "**Answer:** `x = 4`\n"
    }
  ]
]);

export function compileSyntheticGeneration(requestPath) {
  const requestArtifact = readJsonArtifact(requestPath, "AnswerGenerationRequest");
  assertPathWithin(requestArtifact.path, requestRoot, "AnswerGenerationRequest");
  validateAnswerGenerationRequestShape(requestArtifact.value);
  const request = requestArtifact.value;
  const definition = fixtureDefinitions.get(request.requestId);
  if (!definition || path.basename(requestArtifact.path) !== definition.requestFile) {
    throw new Error("AnswerGenerationRequest fixture identity is not admitted.");
  }
  if (request.subjectPack !== "math-answer") {
    throw new Error("AnswerGenerationRequest identity does not match the synthetic fixture.");
  }
  if (request.dataClassification.level !== "public"
    || !request.dataClassification.notes.includes("Fully synthetic")) {
    throw new Error("Synthetic generation requires an explicit public synthetic classification.");
  }

  validateSyntheticProblemBinding(request, requestArtifact.path);

  const candidateBytes = Buffer.from(definition.answerMarkdown, "utf8");
  const result = {
    schemaVersion: "1.0",
    kind: "answer-generation-result",
    requestId: request.requestId,
    subjectPack: request.subjectPack,
    sourceRequestSha256: requestArtifact.sha256,
    answerMarkdown: definition.answerMarkdown,
    candidateArtifactRef: `structured/math-answer/synthetic-linear-equation/${definition.candidateFile}`,
    rawAnswerSha256: sha256(candidateBytes),
    dataClassification: request.dataClassification,
    provenance: {
      providerKind: "synthetic_fixture",
      providerId: "deterministic-local-generator",
      providerVersion: "1.0.0",
      liveProvider: false
    },
    stopReason: "synthetic_fixture_generated_no_live_provider"
  };
  validateAnswerGenerationResultShape(result);
  return {
    requestPath: requestArtifact.path,
    candidatePath: path.join(packageRoot, definition.candidateFile),
    resultPath: path.join(packageRoot, definition.resultFile),
    candidateBytes,
    result
  };
}

export function validateAnswerGenerationRequestShape(request) {
  assertSchema("AnswerGenerationRequest", request, requestSchema);
  return request;
}

export function validateAnswerGenerationResultShape(result) {
  assertSchema("AnswerGenerationResult", result, resultSchema);
  if (result?.provenance?.providerKind === "synthetic_fixture"
    && result.provenance.liveProvider !== false) {
    throw new Error("AnswerGenerationResult synthetic_fixture provenance must be non-live.");
  }
  return result;
}

export function validateSyntheticProblemBinding(request, requestPath) {
  const problemPath = resolveContainedRef(
    request.problemArtifactRef,
    requestPath,
    sampleRoot,
    "problemArtifactRef");
  const expectedProblemPath = path.join(packageRoot, "problem.md");
  if (!sameCanonicalPath(problemPath, expectedProblemPath)) {
    throw new Error("Synthetic generation request must bind the canonical synthetic problem.");
  }
  const problemBytes = fs.readFileSync(problemPath);
  if (sha256(problemBytes) !== request.problemArtifactSha256) {
    throw new Error("AnswerGenerationRequest problemArtifactSha256 does not match raw problem bytes.");
  }
  return problemPath;
}

export function validateCanonicalSyntheticGenerationFixtures() {
  for (const definition of fixtureDefinitions.values()) {
    const compiled = compileSyntheticGeneration(path.join(requestRoot, definition.requestFile));
    const candidateBytes = fs.readFileSync(requireFile(compiled.candidatePath, "candidate artifact"));
    if (!candidateBytes.equals(compiled.candidateBytes)) {
      throw new Error(`${definition.candidateFile} does not match deterministic generator bytes.`);
    }
    const result = readJsonArtifact(compiled.resultPath, "AnswerGenerationResult").value;
    validateAnswerGenerationResultShape(result);
    if (!isDeepStrictEqual(result, compiled.result)) {
      throw new Error(`${definition.resultFile} does not match deterministic generator output.`);
    }
    if (sha256(candidateBytes) !== result.rawAnswerSha256
      || candidateBytes.toString("utf8") !== result.answerMarkdown) {
      throw new Error(`${definition.resultFile} does not bind exact candidate bytes.`);
    }
  }
  return fixtureDefinitions.size;
}

export function validateSyntheticGenerationBinding(
  descriptor,
  descriptorPath,
  candidatePath) {
  assertPathWithin(
    requireFile(path.resolve(descriptorPath), "generated candidate descriptor"),
    packageRoot,
    "generated candidate descriptor");
  if (descriptor.candidateSourceType !== "generated") {
    throw new Error("Synthetic generation binding requires candidateSourceType=generated.");
  }
  for (const field of [
    "generationRequestRef",
    "generationRequestSha256",
    "generationResultRef",
    "generationResultSha256"
  ]) {
    if (typeof descriptor[field] !== "string" || descriptor[field].trim().length === 0) {
      throw new Error(`Generated candidate ${field} is required.`);
    }
  }
  const requestPath = resolveRepoRef(
    descriptor.generationRequestRef,
    requestRoot,
    "generationRequestRef");
  const resultPath = resolveRepoRef(
    descriptor.generationResultRef,
    packageRoot,
    "generationResultRef");
  const requestArtifact = readJsonArtifact(requestPath, "AnswerGenerationRequest");
  const resultArtifact = readJsonArtifact(resultPath, "AnswerGenerationResult");
  if (requestArtifact.sha256 !== descriptor.generationRequestSha256
    || resultArtifact.sha256 !== descriptor.generationResultSha256) {
    throw new Error("Generated candidate request/result SHA-256 binding drifted.");
  }
  const compiled = compileSyntheticGeneration(requestPath);
  if (compiled.result.provenance.providerKind !== "synthetic_fixture"
    || compiled.result.provenance.providerId !== "deterministic-local-generator"
    || compiled.result.provenance.providerVersion !== "1.0.0"
    || compiled.result.provenance.liveProvider !== false
    || compiled.result.stopReason !== "synthetic_fixture_generated_no_live_provider") {
    throw new Error("Generated candidate provenance is not an admitted deterministic synthetic fixture.");
  }
  if (!sameCanonicalPath(compiled.resultPath, resultArtifact.path)
    || !sameCanonicalPath(compiled.candidatePath, candidatePath)
    || !isDeepStrictEqual(compiled.result, resultArtifact.value)) {
    throw new Error("Generated candidate does not match deterministic generation provenance.");
  }
  const candidateBytes = fs.readFileSync(candidatePath);
  if (!candidateBytes.equals(compiled.candidateBytes)
    || sha256(candidateBytes) !== resultArtifact.value.rawAnswerSha256) {
    throw new Error("Generated candidate raw bytes do not match AnswerGenerationResult.");
  }
  return {
    requestPath: requestArtifact.path,
    resultPath: resultArtifact.path,
    resultSha256: resultArtifact.sha256,
    provenance: resultArtifact.value.provenance
  };
}

function materializeFixtures() {
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const definition of fixtureDefinitions.values()) {
    const compiled = compileSyntheticGeneration(path.join(requestRoot, definition.requestFile));
    atomicWrite(compiled.candidatePath, compiled.candidateBytes);
    atomicWrite(
      compiled.resultPath,
      Buffer.from(`${JSON.stringify(compiled.result, null, 2)}\n`, "utf8"));
  }
}

function resolveContainedRef(reference, ownerPath, allowedRoot, label) {
  if (typeof reference !== "string" || reference.trim().length === 0 || path.isAbsolute(reference)) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const resolved = requireFile(path.resolve(path.dirname(ownerPath), reference), label);
  assertPathWithin(resolved, allowedRoot, label);
  return resolved;
}

function resolveRepoRef(reference, allowedRoot, label) {
  if (typeof reference !== "string" || reference.trim().length === 0 || path.isAbsolute(reference)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const resolved = requireFile(path.resolve(repoRoot, reference), label);
  assertPathWithin(resolved, allowedRoot, label);
  return resolved;
}

function assertPathWithin(filePath, allowedRoot, label) {
  const canonicalFile = fs.realpathSync.native(filePath);
  const canonicalRoot = fs.realpathSync.native(allowedRoot);
  const relative = path.relative(normalizePath(canonicalRoot), normalizePath(canonicalFile));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its allowed root.`);
  }
}

function sameCanonicalPath(left, right) {
  return normalizePath(fs.realpathSync.native(left)) === normalizePath(fs.realpathSync.native(right));
}

function normalizePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function readJsonArtifact(filePath, label) {
  const resolved = requireFile(path.resolve(filePath), label);
  const bytes = fs.readFileSync(resolved);
  return {
    path: resolved,
    sha256: sha256(bytes),
    value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  };
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
  return filePath;
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function atomicWrite(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, bytes, { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function main() {
  const option = process.argv[2];
  if (option === "--materialize") {
    materializeFixtures();
    process.stdout.write(`materialized ${fixtureDefinitions.size} synthetic fixtures\n`);
    return;
  }
  if (option === "--validate") {
    process.stdout.write(`validated ${validateCanonicalSyntheticGenerationFixtures()} synthetic fixtures\n`);
    return;
  }
  throw new Error("Usage: node synthetic-generator.mjs --materialize|--validate");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
