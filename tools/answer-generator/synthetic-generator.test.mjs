import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  compileSyntheticGeneration,
  validateAnswerGenerationRequestShape,
  validateAnswerGenerationResultShape,
  validateCanonicalSyntheticGenerationFixtures,
  validateSyntheticGenerationBinding,
  validateSyntheticProblemBinding
} from "./synthetic-generator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const requestRoot = path.join(repoRoot, "eval", "answer-generation", "cases");

test("three committed fixtures reproduce deterministic local outputs", () => {
  assert.equal(validateCanonicalSyntheticGenerationFixtures(), 3);
});

test("generation result is explicitly synthetic and binds raw candidate bytes", () => {
  const compiled = compileSyntheticGeneration(
    path.join(requestRoot, "synthetic-arithmetic-slip.answer-generation-request.json"));

  assert.equal(compiled.result.provenance.providerKind, "synthetic_fixture");
  assert.equal(compiled.result.provenance.liveProvider, false);
  assert.equal(compiled.result.stopReason, "synthetic_fixture_generated_no_live_provider");
  assert.match(compiled.result.rawAnswerSha256, /^[a-f0-9]{64}$/);
  assert.equal(compiled.candidateBytes.toString("utf8"), compiled.result.answerMarkdown);
});

test("request schema rejects delivery-chain fields", () => {
  const sourcePath = path.join(
    requestRoot,
    "synthetic-arithmetic-slip.answer-generation-request.json");
  const request = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  request.outputPdfPath = "answer.pdf";
  assert.throws(
    () => validateAnswerGenerationRequestShape(request),
    /schema validation failed/);
});

test("shared result contract admits a provider-neutral live result shape", () => {
  const synthetic = compileSyntheticGeneration(
    path.join(requestRoot, "synthetic-arithmetic-slip.answer-generation-request.json")).result;
  const liveShape = {
    ...synthetic,
    provenance: {
      providerKind: "model_provider",
      providerId: "configured-text-provider",
      providerVersion: "api-contract-v1",
      liveProvider: true
    },
    stopReason: "generation_completed"
  };

  assert.equal(validateAnswerGenerationResultShape(liveShape), liveShape);
});

test("shared result contract rejects contradictory live synthetic provenance", () => {
  const synthetic = compileSyntheticGeneration(
    path.join(requestRoot, "synthetic-arithmetic-slip.answer-generation-request.json")).result;
  const contradictory = {
    ...synthetic,
    provenance: {
      ...synthetic.provenance,
      liveProvider: true
    }
  };

  assert.throws(
    () => validateAnswerGenerationResultShape(contradictory),
    /synthetic_fixture provenance must be non-live/);
});

test("request problem hash drift fails closed", () => {
  const sourcePath = path.join(
    requestRoot,
    "synthetic-arithmetic-slip.answer-generation-request.json");
  const request = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  request.problemArtifactSha256 = "0".repeat(64);
  assert.throws(
    () => validateSyntheticProblemBinding(request, sourcePath),
    /problemArtifactSha256/);
});

test("generated descriptor provenance hash drift fails closed", () => {
  const packageRoot = path.join(
    repoRoot,
    "样例交付",
    "structured",
    "math-answer",
    "synthetic-linear-equation");
  const descriptorPath = path.join(
    packageRoot,
    "candidate.generated-arithmetic-slip.negative-candidate.json");
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  descriptor.generationResultSha256 = "0".repeat(64);

  assert.throws(
    () => validateSyntheticGenerationBinding(
      descriptor,
      descriptorPath,
      path.join(packageRoot, descriptor.artifactRef)),
    /SHA-256 binding drifted/);
});

test("generated descriptor must remain inside the canonical sample package", () => {
  const packageRoot = path.join(
    repoRoot,
    "样例交付",
    "structured",
    "math-answer",
    "synthetic-linear-equation");
  const descriptorPath = path.join(
    packageRoot,
    "candidate.generated-arithmetic-slip.negative-candidate.json");
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));

  assert.throws(
    () => validateSyntheticGenerationBinding(
      descriptor,
      path.join(
        requestRoot,
        "synthetic-arithmetic-slip.answer-generation-request.json"),
      path.join(packageRoot, descriptor.artifactRef)),
    /descriptor escapes its allowed root/);
});
