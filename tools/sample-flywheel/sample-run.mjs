import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const sampleRoot = requireDirectory(path.join(repoRoot, "样例交付"), "canonical sample root");
const canonicalIndexPath = requireFile(path.join(sampleRoot, "index.json"), "canonical sample index");
const schemaRoot = path.join(repoRoot, "prompts", "shared", "schemas");
const schemas = {
  index: path.join(schemaRoot, "sample-index.schema.json"),
  package: path.join(schemaRoot, "sample-package.schema.json"),
  candidate: path.join(schemaRoot, "negative-candidate.schema.json"),
  run: path.join(schemaRoot, "sample-run-record.schema.json")
};
const scoringCandidateTypes = new Set([
  "historical_candidate",
  "generated",
  "perturbed_negative"
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const kebabIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function compileSampleRun(options = {}) {
  if (options.indexPath !== undefined || options.packagePath !== undefined) {
    throw new Error("sample index and package are canonical authorities and cannot be overridden.");
  }

  const sampleId = requireKebabId(options.sampleId, "sampleId");
  const {
    indexArtifact,
    indexEntry,
    packageArtifact,
    packageRoot,
    subjectPack
  } = readCanonicalSampleAuthority(sampleId);
  const runMode = requireEnum(options.runMode, "runMode", ["plumbing", "scoring"]);
  const truthExtractionStatus = requireEnum(
    options.truthExtractionStatus,
    "truthExtractionStatus",
    ["ok", "low_confidence", "failed"]);
  const inputAnswerLeakage = requireEnum(
    options.inputAnswerLeakage,
    "inputAnswerLeakage",
    ["none", "detected_and_stripped", "suspected_unresolved"]);
  const iteration = Number(options.iteration ?? 1);
  if (!Number.isInteger(iteration) || iteration < 1) {
    throw new Error("iteration must be a positive integer.");
  }

  const baseRecord = {
    schemaVersion: "1.0",
    kind: "sample-run-record",
    sampleId,
    subjectPack,
    runMode,
    candidateSourceType: "reference_placeholder",
    iteration,
    truthExtractionStatus,
    inputAnswerLeakage,
    sampleIndexSha256: indexArtifact.sha256,
    samplePackageSha256: packageArtifact.sha256,
    optimizationCandidateRefs: [],
    unresolvedFeedbackRefs: []
  };

  const record = runMode === "plumbing"
    ? {
        ...baseRecord,
        candidateSourceType: requireEnum(
          options.candidateSourceType ?? "reference_placeholder",
          "candidateSourceType",
          ["reference_placeholder", ...scoringCandidateTypes]),
        stopReason: "plumbing_only_no_scoring_or_optimization"
      }
    : compileScoringRecord({
        baseRecord,
        indexArtifact,
        indexEntry,
        packageArtifact,
        packageRoot,
        candidatePath: options.candidatePath
      });

  validateSampleRunRecord(record);
  return record;
}

function compileScoringRecord(context) {
  const { baseRecord, indexArtifact, indexEntry, packageArtifact, packageRoot } = context;
  if (baseRecord.truthExtractionStatus !== "ok") {
    throw new Error("scoring requires truthExtractionStatus=ok.");
  }
  if (baseRecord.inputAnswerLeakage === "suspected_unresolved") {
    throw new Error("scoring rejects inputAnswerLeakage=suspected_unresolved.");
  }

  const candidatePath = requireFile(
    path.resolve(requireText(context.candidatePath, "negative candidate")),
    "negative candidate");
  assertPathWithin(candidatePath, packageRoot, "negative candidate");
  const candidateArtifact = readJsonArtifact(candidatePath, "negative candidate");
  assertSchema("negative candidate", candidateArtifact.value, schemas.candidate);
  if (!scoringCandidateTypes.has(candidateArtifact.value.candidateSourceType)) {
    throw new Error("scoring rejects candidateSourceType=reference_placeholder.");
  }

  const indexedCandidatePaths = resolveRefs(
    indexEntry.candidateRefs,
    indexArtifact.path,
    packageRoot,
    "candidateRefs");
  if (!indexedCandidatePaths.some((candidatePath) => sameCanonicalPath(candidatePath, candidateArtifact.path))) {
    throw new Error("scoring candidate must be listed in sample-index candidateRefs.");
  }
  const candidateBinding = resolveCandidateBindings(indexEntry, indexArtifact, packageRoot)
    .find((binding) => sameCanonicalPath(binding.path, candidateArtifact.path));
  if (!candidateBinding) {
    throw new Error("scoring candidate must have a hash-bound sample-index candidateBinding.");
  }

  const candidateContent = readFileArtifact(
    resolveContainedRef(candidateArtifact.value.artifactRef, candidateArtifact.path, packageRoot, "artifactRef"),
    "candidate artifact");
  const truthPaths = resolveRefs(
    indexEntry.referenceTruth,
    indexArtifact.path,
    packageRoot,
    "referenceTruth");
  if (truthPaths.length !== 1) {
    throw new Error("minimal scoring requires exactly one referenceTruth artifact.");
  }
  const truthContent = readFileArtifact(truthPaths[0], "reference truth");
  const originPath = resolveContainedRef(
    candidateArtifact.value.originRef,
    candidateArtifact.path,
    packageRoot,
    "originRef");
  if (!truthPaths.some((truthPath) => sameCanonicalPath(truthPath, originPath))) {
    throw new Error("negative candidate originRef must reference the indexed reference truth.");
  }
  const packageNegativePaths = artifactPathsByRole(packageArtifact, packageRoot, "negative_candidate");
  if (!packageNegativePaths.some((candidatePath) => sameCanonicalPath(candidatePath, candidateContent.path))) {
    throw new Error("candidate artifact must be declared as negative_candidate in sample package.");
  }
  if (!artifactPathsByRole(packageArtifact, packageRoot, "reference_truth")
    .some((truthPath) => sameCanonicalPath(truthPath, truthContent.path))) {
    throw new Error("reference truth must be declared in sample package.");
  }

  const exactMatch = candidateContent.sha256 === truthContent.sha256;
  return {
    ...baseRecord,
    candidateSourceType: candidateArtifact.value.candidateSourceType,
    candidateArtifactRef: toPortableRelative(indexArtifact.path, candidateContent.path),
    candidateDescriptorRef: toPortableRelative(indexArtifact.path, candidateArtifact.path),
    candidateDescriptorSha256: candidateArtifact.sha256,
    diffSummary: {
      method: "sha256_exact",
      exactMatch,
      candidateSha256: candidateContent.sha256,
      referenceSha256: truthContent.sha256
    },
    rootCauseSummary: exactMatch
      ? { detected: false }
      : {
          detected: true,
          primaryErrorType: candidateArtifact.value.expectedPrimaryErrorType,
          contributingErrorTypes: candidateArtifact.value.expectedContributingErrorTypes ?? [],
          expectedDiffLayer: candidateArtifact.value.expectedDiffLayer,
          labelSource: "negative_candidate_fixture"
        },
    stopReason: "scoring_recorded_no_optimizer"
  };
}

function assertPackageMatchesIndex(packageArtifact, indexArtifact, indexEntry, packageRoot) {
  const samplePackage = packageArtifact.value;
  if (samplePackage.sampleId !== indexEntry.sampleId) {
    throw new Error("sample package sampleId does not match index entry.");
  }
  if (!isDeepStrictEqual(samplePackage.dataClassification, indexEntry.dataClassification)) {
    throw new Error("sample package dataClassification does not match index entry.");
  }
  assertUniqueNonEmpty(samplePackage.expectedQuestionRefs, "sample package expectedQuestionRefs");
  assertUniqueNonEmpty(indexEntry.expectedQuestionRefs, "sample index expectedQuestionRefs");
  if (!isDeepStrictEqual(samplePackage.expectedQuestionRefs, indexEntry.expectedQuestionRefs)) {
    throw new Error("sample package expectedQuestionRefs does not match index entry.");
  }
  const artifactIds = samplePackage.artifacts.map((artifact) => artifact.artifactId);
  assertUniqueNonEmpty(artifactIds, "sample package artifactIds");
  const allArtifactPaths = samplePackage.artifacts.map((artifact) => resolveContainedRef(
    artifact.path,
    packageArtifact.path,
    packageRoot,
    "artifact.path"));
  if (new Set(allArtifactPaths.map(normalizePath)).size !== allArtifactPaths.length) {
    throw new Error("sample package artifact paths must be unique.");
  }

  for (const [role, field] of [
    ["problem_source", "problemSource"],
    ["reference_truth", "referenceTruth"],
    ["teacher_annotation", "teacherAnnotation"]
  ]) {
    const packagePaths = artifactPathsByRole(packageArtifact, packageRoot, role);
    const indexPaths = resolveRefs(indexEntry[field], indexArtifact.path, packageRoot, field);
    if (!samePathSets(packagePaths, indexPaths)) {
      throw new Error(`sample package ${role} artifacts do not match index ${field}.`);
    }
  }

  for (const binding of resolveCandidateBindings(indexEntry, indexArtifact, packageRoot)) {
    const candidateArtifact = readJsonArtifact(binding.path, "indexed negative candidate");
    assertSchema("indexed negative candidate", candidateArtifact.value, schemas.candidate);
    if (candidateArtifact.sha256 !== binding.sha256) {
      throw new Error("indexed negative candidate SHA-256 does not match candidateBinding.");
    }
    const candidateContentPath = resolveContainedRef(
      candidateArtifact.value.artifactRef,
      candidateArtifact.path,
      packageRoot,
      "artifactRef");
    const originPath = resolveContainedRef(
      candidateArtifact.value.originRef,
      candidateArtifact.path,
      packageRoot,
      "originRef");
    const packageNegativePaths = artifactPathsByRole(packageArtifact, packageRoot, "negative_candidate");
    if (!packageNegativePaths.some((candidatePath) =>
      sameCanonicalPath(candidatePath, candidateContentPath))) {
      throw new Error("indexed candidate artifact must be declared as negative_candidate in sample package.");
    }
    const indexedTruthPaths = resolveRefs(
      indexEntry.referenceTruth,
      indexArtifact.path,
      packageRoot,
      "referenceTruth");
    if (!indexedTruthPaths.some((truthPath) => sameCanonicalPath(truthPath, originPath))) {
      throw new Error("indexed negative candidate originRef must reference indexed referenceTruth.");
    }
  }
}

export function validateSampleRunRecord(record) {
  assertSchema("SampleRunRecord", record, schemas.run);
  requireKebabId(record.sampleId, "SampleRunRecord sampleId");
  requireKebabId(record.subjectPack, "SampleRunRecord subjectPack");
  if (!Number.isInteger(record.iteration) || record.iteration < 1) {
    throw new Error("SampleRunRecord iteration must be a positive integer.");
  }
  assertSha256(record.sampleIndexSha256, "SampleRunRecord sampleIndexSha256");
  assertSha256(record.samplePackageSha256, "SampleRunRecord samplePackageSha256");
  if (record.referenceTruthSource !== undefined) {
    throw new Error("SampleRunRecord referenceTruthSource is not supported by this compiler.");
  }
  if (!Array.isArray(record.optimizationCandidateRefs)
    || record.optimizationCandidateRefs.length !== 0) {
    throw new Error("SampleRunRecord optimizationCandidateRefs must remain empty.");
  }

  if (record.runMode === "plumbing") {
    if (record.diffSummary !== undefined || record.rootCauseSummary !== undefined) {
      throw new Error("plumbing SampleRunRecord must not contain diff or root-cause signals.");
    }
    if (record.stopReason !== "plumbing_only_no_scoring_or_optimization") {
      throw new Error("plumbing SampleRunRecord has an unsupported stopReason.");
    }
    verifySampleRunRecordAuthority(record);
    return record;
  }

  if (record.runMode !== "scoring") {
    throw new Error("SampleRunRecord runMode must be plumbing or scoring.");
  }
  if (!scoringCandidateTypes.has(record.candidateSourceType)) {
    throw new Error("scoring SampleRunRecord requires an admitted candidateSourceType.");
  }
  if (record.truthExtractionStatus !== "ok") {
    throw new Error("scoring SampleRunRecord requires truthExtractionStatus=ok.");
  }
  if (record.inputAnswerLeakage === "suspected_unresolved") {
    throw new Error("scoring SampleRunRecord rejects unresolved answer leakage.");
  }
  requireText(record.candidateArtifactRef, "scoring SampleRunRecord candidateArtifactRef");
  requireText(record.candidateDescriptorRef, "scoring SampleRunRecord candidateDescriptorRef");
  assertSha256(record.candidateDescriptorSha256, "scoring SampleRunRecord candidateDescriptorSha256");
  if (record.diffSummary?.method !== "sha256_exact"
    || typeof record.diffSummary.exactMatch !== "boolean") {
    throw new Error("scoring SampleRunRecord requires a sha256_exact diff summary.");
  }
  assertSha256(record.diffSummary.candidateSha256, "diffSummary candidateSha256");
  assertSha256(record.diffSummary.referenceSha256, "diffSummary referenceSha256");
  const hashesMatch = record.diffSummary.candidateSha256 === record.diffSummary.referenceSha256;
  if (record.diffSummary.exactMatch !== hashesMatch) {
    throw new Error("diffSummary exactMatch must agree with candidate/reference SHA-256 equality.");
  }
  if (record.rootCauseSummary === null
    || typeof record.rootCauseSummary !== "object"
    || typeof record.rootCauseSummary.detected !== "boolean") {
    throw new Error("scoring SampleRunRecord requires a root-cause summary.");
  }
  if (!record.diffSummary.exactMatch
    && record.rootCauseSummary.labelSource !== "negative_candidate_fixture") {
    throw new Error("non-matching scoring records require a fixture-labelled root cause.");
  }
  if (record.rootCauseSummary.detected !== !record.diffSummary.exactMatch) {
    throw new Error("rootCauseSummary detected must be the inverse of exactMatch.");
  }
  if (record.stopReason !== "scoring_recorded_no_optimizer") {
    throw new Error("scoring SampleRunRecord has an unsupported stopReason.");
  }
  verifySampleRunRecordAuthority(record);
  return record;
}

export function validateCanonicalSampleAuthorities() {
  const indexArtifact = readJsonArtifact(canonicalIndexPath, "canonical sample index");
  assertSchema("sample index", indexArtifact.value, schemas.index);
  const sampleIds = indexArtifact.value.samples.map((entry) => entry.sampleId);
  assertUniqueNonEmpty(sampleIds, "canonical sample index sampleIds");
  for (const sampleId of sampleIds) {
    readCanonicalSampleAuthority(sampleId);
  }
  return sampleIds.length;
}

export function verifySampleRunRecordAuthority(record) {
  const authority = readCanonicalSampleAuthority(record.sampleId);
  if (record.subjectPack !== authority.subjectPack) {
    throw new Error("SampleRunRecord subjectPack does not match current canonical authority.");
  }
  if (record.sampleIndexSha256 !== authority.indexArtifact.sha256) {
    throw new Error("SampleRunRecord sampleIndexSha256 does not match current canonical authority.");
  }
  if (record.samplePackageSha256 !== authority.packageArtifact.sha256) {
    throw new Error("SampleRunRecord samplePackageSha256 does not match current canonical authority.");
  }
  if (record.runMode !== "scoring") {
    return record;
  }

  const bindings = resolveCandidateBindings(
    authority.indexEntry,
    authority.indexArtifact,
    authority.packageRoot);
  const binding = bindings.find((candidateBinding) =>
    toPortableRelative(authority.indexArtifact.path, candidateBinding.path)
      === record.candidateDescriptorRef);
  if (!binding || binding.sha256 !== record.candidateDescriptorSha256) {
    throw new Error("SampleRunRecord candidate descriptor does not match current canonical authority.");
  }
  const candidateArtifact = readJsonArtifact(binding.path, "current canonical negative candidate");
  if (candidateArtifact.sha256 !== binding.sha256) {
    throw new Error("current canonical negative candidate does not match its index binding.");
  }
  if (record.candidateSourceType !== candidateArtifact.value.candidateSourceType) {
    throw new Error("SampleRunRecord candidateSourceType does not match its bound descriptor.");
  }
  const candidateContent = readFileArtifact(
    resolveContainedRef(
      candidateArtifact.value.artifactRef,
      candidateArtifact.path,
      authority.packageRoot,
      "artifactRef"),
    "current canonical candidate artifact");
  if (record.candidateArtifactRef
    !== toPortableRelative(authority.indexArtifact.path, candidateContent.path)) {
    throw new Error("SampleRunRecord candidateArtifactRef does not match its bound descriptor.");
  }
  const truthPaths = resolveRefs(
    authority.indexEntry.referenceTruth,
    authority.indexArtifact.path,
    authority.packageRoot,
    "referenceTruth");
  if (truthPaths.length !== 1) {
    throw new Error("current canonical authority requires exactly one reference truth.");
  }
  const truthContent = readFileArtifact(truthPaths[0], "current canonical reference truth");
  if (record.diffSummary.candidateSha256 !== candidateContent.sha256
    || record.diffSummary.referenceSha256 !== truthContent.sha256) {
    throw new Error("SampleRunRecord diff hashes do not match current canonical candidate/reference bytes.");
  }
  if (!record.diffSummary.exactMatch) {
    if (record.rootCauseSummary.primaryErrorType !== candidateArtifact.value.expectedPrimaryErrorType
      || !isDeepStrictEqual(
        record.rootCauseSummary.contributingErrorTypes,
        candidateArtifact.value.expectedContributingErrorTypes ?? [])
      || record.rootCauseSummary.expectedDiffLayer !== candidateArtifact.value.expectedDiffLayer) {
      throw new Error("SampleRunRecord root cause does not match its bound negative-candidate descriptor.");
    }
  }
  return record;
}

function readCanonicalSampleAuthority(sampleId) {
  const indexArtifact = readJsonArtifact(canonicalIndexPath, "canonical sample index");
  assertSchema("sample index", indexArtifact.value, schemas.index);
  const indexEntries = indexArtifact.value.samples.filter((entry) => entry.sampleId === sampleId);
  if (indexEntries.length !== 1) {
    throw new Error(`sample index must contain exactly one entry for ${sampleId}.`);
  }

  const indexEntry = indexEntries[0];
  const subjectPack = requireKebabId(indexEntry.subjectPack, "sample index subjectPack");
  requireKebabId(indexEntry.sampleId, "sample index sampleId");
  assertSha256(indexEntry.packageSha256, "sample index packageSha256");
  const packagePath = resolveContainedRef(
    indexEntry.packageRef,
    indexArtifact.path,
    sampleRoot,
    "sample index packageRef");
  const expectedPackagePath = path.join(
    sampleRoot,
    "structured",
    subjectPack,
    sampleId,
    "sample.json");
  if (!sameCanonicalPath(packagePath, expectedPackagePath)) {
    throw new Error("sample index packageRef must resolve to structured/<subjectPack>/<sampleId>/sample.json.");
  }
  const packageArtifact = readJsonArtifact(packagePath, "canonical sample package");
  assertSchema("sample package", packageArtifact.value, schemas.package);
  if (packageArtifact.sha256 !== indexEntry.packageSha256) {
    throw new Error("sample package SHA-256 does not match sample index packageSha256.");
  }
  if (packageArtifact.value.subjectPack !== subjectPack) {
    throw new Error("sample package subjectPack does not match index entry.");
  }
  const packageRoot = requireDirectory(path.dirname(packageArtifact.path), "sample package root");
  assertPackageMatchesIndex(packageArtifact, indexArtifact, indexEntry, packageRoot);
  return { indexArtifact, indexEntry, packageArtifact, packageRoot, subjectPack };
}

function resolveCandidateBindings(indexEntry, indexArtifact, packageRoot) {
  if (!Array.isArray(indexEntry.candidateBindings)
    || indexEntry.candidateBindings.length === 0) {
    throw new Error("sample index candidateBindings must be non-empty.");
  }
  const bindings = indexEntry.candidateBindings.map((binding) => {
    if (binding === null || typeof binding !== "object") {
      throw new Error("sample index candidateBinding must be an object.");
    }
    assertSha256(binding.sha256, "sample index candidateBinding sha256");
    return {
      path: resolveContainedRef(binding.ref, indexArtifact.path, packageRoot, "candidateBinding ref"),
      ref: binding.ref,
      sha256: binding.sha256
    };
  });
  if (new Set(bindings.map((binding) => normalizePath(binding.path))).size !== bindings.length) {
    throw new Error("sample index candidateBindings must contain unique refs.");
  }
  const candidatePaths = resolveRefs(
    indexEntry.candidateRefs,
    indexArtifact.path,
    packageRoot,
    "candidateRefs");
  if (!samePathSets(candidatePaths, bindings.map((binding) => binding.path))) {
    throw new Error("sample index candidateRefs must match candidateBindings.");
  }
  return bindings;
}

function assertUniqueNonEmpty(values, label) {
  if (!Array.isArray(values)
    || values.length === 0
    || values.some((value) => typeof value !== "string" || value.trim().length === 0)
    || new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique non-empty references.`);
  }
}

function artifactPathsByRole(packageArtifact, packageRoot, role) {
  return packageArtifact.value.artifacts
    .filter((artifact) => artifact.role === role)
    .map((artifact) => resolveContainedRef(
      artifact.path,
      packageArtifact.path,
      packageRoot,
      `${role}.path`))
    .sort();
}

function resolveRefs(refs, ownerPath, allowedRoot, label) {
  if (!Array.isArray(refs) || new Set(refs).size !== refs.length) {
    throw new Error(`${label} must contain unique references.`);
  }
  return refs
    .map((reference) => resolveContainedRef(reference, ownerPath, allowedRoot, label))
    .sort();
}

export function resolveContainedRef(reference, ownerPath, allowedRoot, label = "reference") {
  const value = requireText(reference, label);
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be a relative path.`);
  }
  const resolvedPath = requireFile(path.resolve(path.dirname(ownerPath), value), label);
  assertPathWithin(resolvedPath, allowedRoot, label);
  return resolvedPath;
}

function assertPathWithin(filePath, allowedRoot, label) {
  const canonicalRoot = requireDirectory(allowedRoot, `${label} allowed root`);
  const relativePath = path.relative(canonicalRoot, requireFile(filePath, label));
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`${label} escapes its allowed root.`);
  }
}

function readJsonArtifact(filePath, label) {
  const artifact = readFileArtifact(filePath, label);
  return {
    ...artifact,
    value: JSON.parse(artifact.bytes.toString("utf8").replace(/^\uFEFF/, ""))
  };
}

function readFileArtifact(filePath, label) {
  const resolvedPath = requireFile(path.resolve(requireText(filePath, label)), label);
  const bytes = fs.readFileSync(resolvedPath);
  return {
    path: resolvedPath,
    bytes,
    sha256: sha256(bytes)
  };
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return fs.realpathSync.native(filePath);
}

function requireDirectory(directoryPath, label) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`${label} not found: ${directoryPath}`);
  }
  return fs.realpathSync.native(directoryPath);
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function requireEnum(value, label, allowed) {
  const normalized = requireText(value, label);
  if (!allowed.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return normalized;
}

function requireKebabId(value, label) {
  const normalized = requireText(value, label);
  if (!kebabIdPattern.test(normalized)) {
    throw new Error(`${label} must be a lowercase kebab-case path segment.`);
  }
  return normalized;
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function toPortableRelative(ownerPath, targetPath) {
  return path.relative(path.dirname(ownerPath), targetPath).split(path.sep).join("/");
}

function atomicWriteJson(filePath, value) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const temporaryPath = `${resolvedPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporaryPath, resolvedPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function assertOutputDoesNotAliasInputs(outputPath, options) {
  const resolvedOutputPath = path.resolve(outputPath);
  if (path.extname(resolvedOutputPath).toLowerCase() !== ".json") {
    throw new Error("--out must point to a JSON file.");
  }

  const inputPaths = collectInputPaths(options);
  const outputCanonicalPath = canonicalPath(resolvedOutputPath);
  const outputIdentity = fileIdentity(resolvedOutputPath);
  if (inputPaths.some((inputPath) =>
    canonicalPath(inputPath) === outputCanonicalPath
    || sameFileIdentity(outputIdentity, fileIdentity(inputPath)))) {
    throw new Error("--out must not alias any sample-run input artifact.");
  }
}

function collectInputPaths(options) {
  const paths = [canonicalIndexPath];
  const indexArtifact = readJsonArtifact(canonicalIndexPath, "canonical sample index");
  const indexEntry = indexArtifact.value.samples.find((entry) => entry.sampleId === options.sampleId);
  if (!indexEntry) {
    return paths;
  }

  const packagePath = resolveContainedRef(
    indexEntry.packageRef,
    indexArtifact.path,
    sampleRoot,
    "sample index packageRef");
  paths.push(packagePath);
  const packageRoot = requireDirectory(path.dirname(packagePath), "sample package root");
  for (const field of ["problemSource", "referenceTruth", "teacherAnnotation", "candidateRefs"]) {
    for (const reference of indexEntry[field] ?? []) {
      paths.push(resolveContainedRef(reference, indexArtifact.path, packageRoot, field));
    }
  }

  const packageArtifact = readJsonArtifact(packagePath, "canonical sample package");
  for (const artifact of packageArtifact.value.artifacts ?? []) {
    paths.push(resolveContainedRef(artifact.path, packageArtifact.path, packageRoot, "artifact.path"));
  }

  if (options.candidatePath) {
    const candidatePath = requireFile(
      path.resolve(requireText(options.candidatePath, "negative candidate")),
      "negative candidate");
    assertPathWithin(candidatePath, packageRoot, "negative candidate");
    const candidateArtifact = readJsonArtifact(candidatePath, "negative candidate");
    paths.push(candidateArtifact.path);
    for (const field of ["artifactRef", "originRef"]) {
      paths.push(resolveContainedRef(candidateArtifact.value[field], candidateArtifact.path, packageRoot, field));
    }
  }
  return [...new Set(paths.map((inputPath) => path.resolve(inputPath)))];
}

function canonicalPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    return normalizePath(fs.realpathSync.native(resolvedPath));
  }
  const parentPath = path.dirname(resolvedPath);
  const canonicalParent = fs.existsSync(parentPath)
    ? fs.realpathSync.native(parentPath)
    : path.resolve(parentPath);
  return normalizePath(path.join(canonicalParent, path.basename(resolvedPath)));
}

function fileIdentity(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return undefined;
  }
  const stat = fs.statSync(filePath, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
}

function sameFileIdentity(left, right) {
  return left !== undefined && right !== undefined && left === right;
}

function sameCanonicalPath(left, right) {
  return canonicalPath(left) === canonicalPath(right);
}

function samePathSets(left, right) {
  return isDeepStrictEqual(left.map(normalizePath).sort(), right.map(normalizePath).sort());
}

function normalizePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const valueFlags = {
      "--sample-id": "sampleId",
      "--run-mode": "runMode",
      "--candidate": "candidatePath",
      "--candidate-source-type": "candidateSourceType",
      "--truth-extraction-status": "truthExtractionStatus",
      "--input-answer-leakage": "inputAnswerLeakage",
      "--iteration": "iteration",
      "--out": "outPath"
    };
    if (valueFlags[arg]) {
      options[valueFlags[arg]] = requireText(argv[++index], arg);
    } else if (arg === "--help" || arg === "-h") {
      return null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    return;
  }
  const record = compileSampleRun(options);
  if (!options.outPath) {
    throw new Error("--out is required.");
  }
  assertOutputDoesNotAliasInputs(options.outPath, options);
  atomicWriteJson(options.outPath, record);
  process.stdout.write(`${path.resolve(options.outPath)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
