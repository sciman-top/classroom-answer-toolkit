import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Hex } from "../../shared.mjs";
import { validateValueAgainstSchema } from "../../rule-compiler/schema-validator.mjs";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(toolRoot, "..", "..", "..");
const schemaDirectory = path.join(defaultRepositoryRoot, "prompts", "shared", "schemas");

const phaseSpecs = {
  blindGeneration: { mode: "blind_generation", summary: true },
  semanticFindings: { mode: "semantic_review_findings", summary: true },
  semanticMerge: { mode: "semantic_review_merge", summary: true },
  visualFindings: { mode: "visual_audit_findings", summary: true },
  visualMerge: { mode: "visual_audit_merge", summary: true },
  referenceReview: { mode: "reference_review", summary: true },
  delivery: { mode: null, summary: false }
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(value, platform) {
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function fileReceipt(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    path: path.resolve(filePath),
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes)
  };
}

function readJson(filePath, label, errors) {
  if (typeof filePath !== "string" || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    errors.push(`${label} is missing or not a file.`);
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    // UTF-8 JSON decoded through Node must not transform Chinese paths into
    // replacement characters. Such a receipt can never bind real files.
    if (JSON.stringify(value).includes("\uFFFD")) {
      errors.push(`${label} contains the Unicode replacement character.`);
    }
    return value;
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function resolveManifestPath(manifestDirectory, value) {
  return typeof value === "string" && value.trim().length > 0
    ? path.resolve(manifestDirectory, value)
    : null;
}

function resolveInputPath(manifestDirectory, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(manifestDirectory, value);
}

function compareReceipt(errors, label, expected, actual, platform) {
  if (typeof expected?.path !== "string"
      || normalizePath(expected.path, platform) !== normalizePath(actual.path, platform)) {
    errors.push(`${label} path does not match the current file.`);
  }
  if (expected?.bytes !== actual.bytes) {
    errors.push(`${label} byte length does not match the current file.`);
  }
  if (expected?.sha256 !== actual.sha256) {
    errors.push(`${label} SHA-256 does not match the current file.`);
  }
}

function validateGenerationSummary(phaseName, phase, errors) {
  const summaryPath = phase.summary?.path;
  const artifactPath = phase.artifact?.path;
  const summary = readJson(summaryPath, `${phaseName}.summary`, errors);
  const expectedSchema = path.join(schemaDirectory, "live-answer-generation-summary.schema.json");
  const schemaErrors = summary
    ? validateValueAgainstSchema(summary, expectedSchema)
    : [];
  errors.push(...schemaErrors.map((message) => `${phaseName}.summary schema: ${message}`));

  if (summary) {
    if (summary.kind !== "live-answer-generation-summary") {
      errors.push(`${phaseName}.summary has the wrong kind.`);
    }
    if (summary.mode !== phaseSpecs[phaseName].mode) {
      errors.push(`${phaseName}.summary mode does not match the phase.`);
    }
    if (summary.outputPath !== artifactPath) {
      errors.push(`${phaseName}.summary outputPath does not match its artifact.`);
    }
    if (!Number.isInteger(summary.answerCharacters) || summary.answerCharacters <= 0) {
      errors.push(`${phaseName}.summary has no answer content.`);
    }
    if (!Array.isArray(summary.attempts) || summary.attempts.length === 0
        || !summary.attempts.some((attempt) => attempt?.ok === true)) {
      errors.push(`${phaseName}.summary has no successful provider attempt.`);
    }
    if (phaseName === "blindGeneration") {
      if (summary.candidatePath !== null) {
        errors.push("blindGeneration.summary candidatePath must be null before review.");
      }
      if (summary.candidateSha256 !== null) {
        errors.push("blindGeneration.summary candidateSha256 must be null before review.");
      }
      if (summary.candidateBaselinePath !== null) {
        errors.push("blindGeneration.summary candidateBaselinePath must be null.");
      }
      if (summary.candidateBaselineSha256 !== null) {
        errors.push("blindGeneration.summary candidateBaselineSha256 must be null.");
      }
    } else if (!summary.candidateBaselinePath) {
      errors.push(`${phaseName}.summary must bind its frozen candidate baseline.`);
    }
  }

  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    errors.push(`${phaseName}.artifact is missing or not a file.`);
    return null;
  }
  if (summary && summary.outputSha256 !== fileReceipt(artifactPath).sha256) {
    errors.push(`${phaseName}.artifact SHA-256 does not match summary.outputSha256.`);
  }
  return fileReceipt(artifactPath);
}

function validateDeliveryManifest(phase, errors) {
  const outputPath = phase.artifact?.path;
  if (typeof outputPath !== "string" || !fs.existsSync(outputPath) || !fs.statSync(outputPath).isFile()) {
    errors.push("delivery.artifact is missing or not a file.");
    return null;
  }
  const manifestPath = path.join(
    path.dirname(outputPath),
    `${path.basename(outputPath, path.extname(outputPath))}.delivery-manifest.json`
  );
  const manifest = readJson(manifestPath, "delivery manifest", errors);
  const expectedSchema = path.join(schemaDirectory, "delivery-manifest.schema.json");
  const schemaErrors = manifest ? validateValueAgainstSchema(manifest, expectedSchema) : [];
  errors.push(...schemaErrors.map((message) => `delivery manifest schema: ${message}`));
  if (!manifest) {
    return null;
  }

  const manifestDirectory = path.dirname(manifestPath);
  const manifestOutput = resolveManifestPath(manifestDirectory, manifest.output);
  if (manifest.kind !== "delivery-manifest"
      || manifest.schemaVersion !== "1.1"
      || manifest.status?.deliveryComplete !== true
      || manifest.status?.toolchainPassed !== true) {
    errors.push("delivery manifest is not a complete, successful 1.1 delivery.");
  }
  if (!manifestOutput || manifestOutput !== path.resolve(outputPath)) {
    errors.push("delivery manifest output does not match delivery.artifact.");
  }

  for (const [label, value, integrity] of [
    ["input", manifest.input, manifest.integrity?.input],
    ["output", manifest.output, manifest.integrity?.output],
    ["snapshot", manifest.snapshotPath, manifest.integrity?.snapshot]
  ]) {
    const filePath = resolveManifestPath(manifestDirectory, value);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      errors.push(`delivery ${label} is missing or not a file.`);
      continue;
    }
    const actual = fileReceipt(filePath);
    if (integrity?.bytes !== actual.bytes || integrity?.sha256 !== actual.sha256) {
      errors.push(`delivery integrity.${label} does not match the current bytes.`);
    }
  }

  const reviewDirectory = resolveManifestPath(manifestDirectory, manifest.review?.outputDir);
  const reviewManifestPath = resolveManifestPath(manifestDirectory, manifest.review?.manifestPath);
  if (!reviewDirectory || !reviewManifestPath || !fs.existsSync(reviewManifestPath)
      || !fs.statSync(reviewManifestPath).isFile()) {
    errors.push("delivery review manifest is missing.");
  } else {
    const review = readJson(reviewManifestPath, "review manifest", errors);
    if (review) {
      const outputDirectory = resolveManifestPath(manifestDirectory, manifest.output);
      if (review.kind !== "pdf-source-review" || !outputDirectory
          || typeof review.inputPath !== "string"
          || resolveInputPath(path.dirname(reviewManifestPath), review.inputPath) !== outputDirectory) {
        errors.push("review manifest is not bound to the delivery PDF.");
      } else if (review.inputSha256 !== sha256Hex(fs.readFileSync(outputDirectory))
          || review.inputBytes !== fs.statSync(outputDirectory).size) {
        errors.push("review manifest source bytes do not match the delivery PDF.");
      } else if (Array.isArray(review.selectedPages)
          && review.selectedPages.length === review.pageCount
          && Array.isArray(review.pages)
          && review.pages.some((page) => !Number.isInteger(page?.pageNumber)
            || !review.selectedPages.includes(page.pageNumber))) {
        errors.push("review page images do not cover their recorded PDF pages.");
      }
      const selectedPages = review.selectedPages;
      if (!Array.isArray(selectedPages)
          || !Number.isInteger(review.pageCount)
          || selectedPages.some((page) => !Number.isInteger(page) || page < 1 || page > review.pageCount)) {
        errors.push("review manifest has invalid page coverage.");
      }
      const reviewImages = Array.isArray(review.pages)
        ? review.pages.filter((page) => isObject(page) && typeof page.imagePath === "string")
        : [];
      if (reviewImages.length === 0) {
        errors.push("review manifest has no page images.");
      }
      for (const page of reviewImages) {
        const imagePath = path.isAbsolute(page.imagePath)
          ? page.imagePath
          : path.resolve(path.dirname(reviewManifestPath), page.imagePath);
        if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()
            || !isPathInside(reviewDirectory, imagePath)) {
          errors.push(`review page image is missing: ${page.imagePath}`);
        }
      }
    }
  }
  if (!Array.isArray(manifest.integrity?.reviewFiles) || manifest.integrity.reviewFiles.length === 0) {
    errors.push("delivery manifest has no review integrity entries.");
  }
  for (const entry of manifest.integrity?.reviewFiles ?? []) {
    const filePath = resolveManifestPath(manifestDirectory, entry?.path);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      errors.push(`delivery review file is missing: ${entry?.path ?? "<unknown>"}`);
      continue;
    }
    const actual = fileReceipt(filePath);
    if (entry.bytes !== actual.bytes || entry.sha256 !== actual.sha256) {
      errors.push(`delivery review integrity does not match: ${entry.path}`);
    }
  }

  return { output: fileReceipt(outputPath), manifest: fileReceipt(manifestPath) };
}

function isPathInside(directoryPath, filePath) {
  const relative = path.relative(directoryPath, filePath);
  return relative !== ""
    && !path.isAbsolute(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`);
}

export function validateWorkflowReceipt(receipt, receiptPath, options = {}) {
  const platform = options.platform ?? process.platform;
  const errors = [];
  if (!isObject(receipt)) {
    return ["workflow receipt must be a JSON object."];
  }
  const schemaPath = path.join(schemaDirectory, "live-answer-workflow-run.schema.json");
  errors.push(...validateValueAgainstSchema(receipt, schemaPath));
  if (receipt.kind !== "live-answer-workflow-run") {
    errors.push('workflow kind must be "live-answer-workflow-run".');
  }
  if (receipt.status === "succeeded") {
    if (receipt.error !== null) {
      errors.push("succeeded workflow must have a null error.");
    }
    if (!receipt.phases?.blindGeneration
        || receipt.phases.blindGeneration.status !== "completed") {
      errors.push("succeeded workflow must have a completed blindGeneration phase.");
    }
    if (receipt.phases?.delivery?.status !== "completed") {
      errors.push("succeeded workflow must have a completed delivery phase.");
    }
  }
  if (receipt.status === "succeeded" && options.validateStages === true) {
    const summaryModes = new Set(
      Object.values(receipt.phases ?? {})
        .filter((phase) => isObject(phase) && phase.status === "completed" && phase.summary?.path)
        .map((phase) => {
          try {
            return JSON.parse(fs.readFileSync(phase.summary.path, "utf8")).mode;
          } catch {
            return null;
          }
        })
    );
    if (receipt.options?.skipVisualAudit === false && !summaryModes.has("visual_audit_findings")) {
      errors.push("succeeded workflow requested visual audit without completed visual findings.");
    }
    if (receipt.inputs?.referencePdf && !summaryModes.has("reference_review")) {
      errors.push("succeeded workflow supplied a reference but skipped reference review.");
    }

    const deliveryArtifact = receipt.phases?.delivery?.artifact?.path;
    if (typeof deliveryArtifact === "string") {
      const manifestPath = path.join(
        path.dirname(deliveryArtifact),
        `${path.basename(deliveryArtifact, path.extname(deliveryArtifact))}.delivery-manifest.json`
      );
      const deliveryManifest = fs.existsSync(manifestPath)
        ? readJson(manifestPath, "delivery manifest", errors)
        : null;
      if (deliveryManifest) {
        const deliveryInput = resolveInputPath(path.dirname(manifestPath), deliveryManifest.input);
        const boundInput = receipt.artifacts?.find((entry) =>
          isObject(entry) && typeof entry.path === "string"
          && normalizePath(boundInputPath(entry.path), platform) === normalizePath(deliveryInput, platform)
        );
        if (!boundInput) {
          errors.push("workflow artifacts is missing the delivery Markdown input.");
        }
        const finalSha = boundInput?.sha256;
        const completedReceipts = new Set();
        let referenceBaselineSha = null;
        for (const phase of Object.values(receipt.phases ?? {})) {
          if (!isObject(phase) || phase.status !== "completed" || !phase.summary?.path) {
            continue;
          }
          const summary = readJson(phase.summary.path, "generation summary", errors);
          if (!summary) {
            continue;
          }
          const outputPath = summary.outputPath;
          if (typeof outputPath === "string") {
            completedReceipts.add(summary.outputSha256);
          }
          if (phase === receipt.phases.referenceReview) {
            referenceBaselineSha = summary.candidateBaselineSha256;
            if (!summary.candidateBaselineSha256
                || (summary.candidatePath && !fs.existsSync(summary.candidatePath))) {
              errors.push("reference review must bind the frozen candidate as its comparison baseline.");
            }
            if (summary.candidateBaselineSha256
                && !completedReceipts.has(summary.candidateBaselineSha256)) {
              errors.push("reference review candidate baseline is not a completed prior stage.");
            }
          }
        }
        if (deliveryManifest.input && finalSha
            && !(receipt.artifacts ?? []).some((entry) => entry.sha256 === finalSha)) {
          errors.push("workflow artifacts is missing the final reviewed Markdown.");
        }
        if (referenceBaselineSha && finalSha === referenceBaselineSha
            && receipt.phases?.referenceReview?.status === "completed") {
          errors.push("reference review did not produce a final Markdown checkpoint.");
        }
      }
    }
  }

  for (const [phaseName, spec] of Object.entries(phaseSpecs)) {
    const phase = receipt.phases?.[phaseName];
    if (!isObject(phase)) {
      errors.push(`workflow phase is missing: ${phaseName}`);
      continue;
    }
    if (phase.status !== "completed") {
      continue;
    }
    if (spec.summary) {
      if (typeof phase.summaryPath !== "string"
          || normalizePath(phase.summaryPath, platform) !== normalizePath(phase.summary?.path ?? "", platform)) {
        errors.push(`${phaseName}.summaryPath does not match its bound summary.`);
      }
      const artifact = validateGenerationSummary(phaseName, phase, errors);
      if (artifact) {
        compareReceipt(errors, `${phaseName}.artifact`, phase.artifact, artifact, platform);
        if (typeof phase.artifactPath !== "string"
            || normalizePath(phase.artifactPath, platform) !== normalizePath(artifact.path, platform)) {
          errors.push(`${phaseName}.artifactPath does not match its bound artifact.`);
        }
      }
    }
    if (phaseName === "delivery") {
      const delivery = validateDeliveryManifest(phase, errors);
      if (delivery) {
        compareReceipt(errors, "delivery.artifact", phase.artifact, delivery.output, platform);
        if (typeof phase.artifactPath !== "string"
            || normalizePath(phase.artifactPath, platform) !== normalizePath(delivery.output.path, platform)) {
          errors.push("delivery.artifactPath does not match delivery.artifact.");
        }
        const boundManifest = receipt.artifacts?.find((entry) =>
          isObject(entry) && typeof entry.path === "string"
          && normalizePath(entry.path, platform) === normalizePath(delivery.manifest.path, platform)
        );
        if (!boundManifest) {
          errors.push("workflow artifacts is missing its delivery manifest.");
        } else {
          compareReceipt(errors, "delivery manifest", boundManifest, delivery.manifest, platform);
        }
      }
    }
  }

  if (receipt.status === "succeeded") {
    if (receipt.diagnostics?.retainedWorkRoot !== null) {
      errors.push("succeeded workflow must not retain a failure diagnostics root.");
    }
    if (receipt.phases?.visualFindings?.status === "skipped"
        && receipt.options?.skipVisualAudit !== true) {
      errors.push("visual audit was skipped without the explicit option.");
    }
    if (options.validateStages === true) {
      for (const [phaseName, phase] of Object.entries(receipt.phases ?? {})) {
        if (!phaseSpecs[phaseName]?.summary || phase.status !== "completed") {
          continue;
        }
        const summary = readJson(phase.summary.path, `${phaseName}.summary`, errors);
        if (summary?.mode !== phaseSpecs[phaseName].mode) {
          errors.push(`${phaseName}.summary mode does not match the phase.`);
        }
        if (!summary?.attempts?.some((attempt) => attempt?.ok === true)) {
          errors.push(`${phaseName} has no successful provider attempt.`);
        }
        if (!Number.isInteger(summary?.answerCharacters) || summary.answerCharacters <= 0) {
          errors.push(`${phaseName} has no answer content.`);
        }
      }
    }
  } else if (receipt.status === "failed") {
    if (typeof receipt.error !== "string" || receipt.error.trim().length === 0) {
      errors.push("failed workflow must record an error.");
    }
    if (typeof receipt.diagnostics?.retainedWorkRoot !== "string") {
      errors.push("failed workflow must point at its retained diagnostics.");
    }
  }
  return [...new Set(errors)];
}

function boundInputPath(value) {
  return path.resolve(value);
}

export function validateWorkflowReceiptFile(receiptPath, options = {}) {
  const errors = [];
  const receipt = readJson(receiptPath, "workflow receipt", errors);
  return [...errors, ...(receipt ? validateWorkflowReceipt(receipt, receiptPath, options) : [])];
}

