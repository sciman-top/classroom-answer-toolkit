import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  compileDecisionRecord,
  validateDecisionRecord
} from "../visual-evidence/decision-record.mjs";
import { verifyDeliveryDecisionAggregate } from "../visual-evidence/delivery-decision-aggregate.mjs";
import {
  loadCanonicalTeacherFeedbackReplayAuthority,
  validateTeacherFeedbackParseResult
} from "../sample-flywheel/teacher-feedback-parse.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const outputSchemaPath = path.join(
  repoRoot,
  "prompts",
  "shared",
  "schemas",
  "review-queue-projection.schema.json");
const queueOrder = new Map([
  ["needs_human_label", 0],
  ["high_risk_approval", 1],
  ["truth_needs_review", 2]
]);

export function projectReviewQueue(artifactPaths) {
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    throw new Error("At least one --artifact path is required.");
  }

  const seenCanonicalPaths = new Set();
  const seenPhysicalIdentities = new Set();
  const verifiedItems = [];
  const rejectedSources = [];

  for (const selectedPath of artifactPaths) {
    try {
      const artifact = readSelectedArtifact(selectedPath);
      const normalizedPath = normalizePath(artifact.path);
      const physicalIdentity = `${artifact.stat.dev}:${artifact.stat.ino}`;
      if (seenCanonicalPaths.has(normalizedPath)) {
        throw new Error("duplicate canonical source path");
      }
      if (seenPhysicalIdentities.has(physicalIdentity)) {
        throw new Error("duplicate physical source identity");
      }
      seenCanonicalPaths.add(normalizedPath);
      seenPhysicalIdentities.add(physicalIdentity);
      const item = verifyAndProject(artifact);
      if (item !== null) {
        verifiedItems.push(item);
      }
    } catch (error) {
      rejectedSources.push({
        sourcePath: safeAbsolutePath(selectedPath),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  rejectedSources.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "en"));
  if (rejectedSources.length > 0) {
    return validateOutput({
      schemaVersion: "1.0",
      kind: "review-queue-projection-result",
      succeeded: false,
      authority: "local_verified_projection",
      sourceCount: artifactPaths.length,
      counts: emptyCounts(),
      items: [],
      rejectedSources
    });
  }

  verifiedItems.sort((left, right) => {
    const queueDifference = queueOrder.get(left.queue) - queueOrder.get(right.queue);
    return queueDifference || left.sourcePath.localeCompare(right.sourcePath, "en");
  });
  return validateOutput({
    schemaVersion: "1.0",
    kind: "review-queue-projection-result",
    succeeded: true,
    authority: "local_verified_projection",
    sourceCount: artifactPaths.length,
    counts: {
      needsHumanLabel: verifiedItems.filter((item) => item.queue === "needs_human_label").length,
      highRiskApproval: verifiedItems.filter((item) => item.queue === "high_risk_approval").length,
      truthNeedsReview: verifiedItems.filter((item) => item.queue === "truth_needs_review").length
    },
    items: verifiedItems,
    rejectedSources: []
  });
}

function verifyAndProject(artifact) {
  switch (artifact.value.kind) {
    case "feedback-parse-result":
      return verifyFeedbackParseResult(artifact);
    case "decision-record":
      return verifyDecisionRecord(artifact);
    case "delivery-decision-aggregate":
      return verifyAggregate(artifact);
    default:
      throw new Error("unsupported review artifact kind");
  }
}

function verifyFeedbackParseResult(artifact) {
  const authority = loadCanonicalTeacherFeedbackReplayAuthority();
  const entry = authority.entries.find((candidate) =>
    normalizePath(candidate.expectedResultPath) === normalizePath(artifact.path));
  if (!entry) {
    throw new Error("feedback result is not admitted by canonical synthetic teacher authority");
  }
  validateTeacherFeedbackParseResult(
    artifact.value,
    entry.sourceRunPath,
    entry.submissionPath);
  if (artifact.value.parseDisposition !== "needs_human_label"
    || artifact.value.humanQueue !== "needs_human_label") {
    return null;
  }
  return createItem(
    "needs_human_label",
    artifact,
    artifact.value.sourceFeedbackId,
    artifact.value.reasonCode);
}

function verifyDecisionRecord(artifact) {
  const validationErrors = validateDecisionRecord(artifact.value);
  if (validationErrors.length > 0) {
    throw new Error(`DecisionRecord schema validation failed: ${validationErrors.join("; ")}`);
  }
  const siblings = readSiblingJsonArtifacts(path.dirname(artifact.path), artifact.path);
  const evidence = findUniqueById(
    siblings,
    "problem-evidence-bundle",
    "evidenceBundleId",
    artifact.value.evidenceBundleRef);
  const tracks = artifact.value.trackResultRefs.map((trackId) =>
    findUniqueById(siblings, "track-result", "trackResultId", trackId).value);
  const matchingRecompilations = [false, true]
    .map((humanApproved) => compileDecisionRecord({
      evidenceBundle: evidence.value,
      trackResults: tracks,
      generatedAt: artifact.value.generatedAt,
      humanApproved
    }))
    .filter((expected) => isDeepStrictEqual(expected, artifact.value));
  if (matchingRecompilations.length !== 1) {
    throw new Error("DecisionRecord does not match recomputed sibling source artifacts");
  }
  if (artifact.value.reviewQueue === "none") {
    return null;
  }
  return createItem(
    artifact.value.reviewQueue,
    artifact,
    artifact.value.decisionId,
    artifact.value.decisionReasons.join(", "));
}

function verifyAggregate(artifact) {
  const siblings = readSiblingJsonArtifacts(path.dirname(artifact.path), artifact.path);
  const manifestSha256 = artifact.value.deliveryBinding?.manifestSha256;
  const manifests = siblings.filter((candidate) =>
    candidate.value.kind === "delivery-manifest" && candidate.sha256 === manifestSha256);
  if (manifests.length !== 1) {
    throw new Error("expected exactly one sibling delivery manifest matching deliveryBinding.manifestSha256");
  }
  verifyDeliveryDecisionAggregate({
    aggregatePath: artifact.path,
    manifestPath: manifests[0].path
  });
  if (artifact.value.reviewQueue === "none") {
    return null;
  }
  return createItem(
    artifact.value.reviewQueue,
    artifact,
    artifact.value.aggregateId,
    artifact.value.decisionReasons.join(", "));
}

function createItem(queue, artifact, artifactId, reason) {
  if (!queueOrder.has(queue)) {
    throw new Error(`unsupported review queue ${queue}`);
  }
  return {
    queue,
    artifactKind: artifact.value.kind,
    artifactId,
    subjectPack: artifact.value.subjectPack,
    sourcePath: artifact.path,
    sourceSha256: artifact.sha256,
    reason: reason || "review requested by verified source artifact"
  };
}

function readSelectedArtifact(selectedPath) {
  const absolutePath = path.resolve(selectedPath);
  if (path.extname(absolutePath).toLowerCase() !== ".json") {
    throw new Error("review artifact must be a JSON file");
  }
  const canonicalPath = fs.realpathSync.native(absolutePath);
  const stat = fs.statSync(canonicalPath);
  if (!stat.isFile()) {
    throw new Error("review artifact must be a regular file");
  }
  const bytes = fs.readFileSync(canonicalPath);
  return {
    path: canonicalPath,
    stat,
    bytes,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

function readSiblingJsonArtifacts(directory, selectedPath) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
    .map((entry) => path.join(directory, entry.name))
    .filter((candidatePath) => normalizePath(candidatePath) !== normalizePath(selectedPath))
    .map((candidatePath) => {
      try {
        return readSelectedArtifact(candidatePath);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function findUniqueById(artifacts, kind, idField, expectedId) {
  const matches = artifacts.filter((artifact) =>
    artifact.value.kind === kind && artifact.value[idField] === expectedId);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one sibling ${kind} for ${expectedId}`);
  }
  return matches[0];
}

function validateOutput(output) {
  const errors = validateValueAgainstSchema(output, outputSchemaPath);
  if (errors.length > 0) {
    throw new Error(`review queue output schema validation failed: ${errors.join("; ")}`);
  }
  return output;
}

function emptyCounts() {
  return { needsHumanLabel: 0, highRiskApproval: 0, truthNeedsReview: 0 };
}

function normalizePath(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function safeAbsolutePath(value) {
  try {
    return path.resolve(value);
  } catch {
    return String(value);
  }
}

function parseArgs(argv) {
  const artifactPaths = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--artifact") {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--artifact requires a path");
    }
    artifactPaths.push(value);
    index += 1;
  }
  return artifactPaths;
}

function main() {
  const result = projectReviewQueue(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
