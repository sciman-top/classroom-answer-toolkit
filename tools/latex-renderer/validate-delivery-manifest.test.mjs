import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { compileResolvedSnapshot } from "../rule-compiler/merge-rules.mjs";
import { validateDeliveryManifest } from "./validate-delivery-manifest.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fileIntegrity(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    path: filePath,
    bytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-manifest-contract-"));
  const manifestPath = path.join(root, "answer.delivery-manifest.json");
  const inputPath = path.join(root, "answer.md");
  const outputPath = path.join(root, "answer.pdf");
  const snapshotPath = path.join(root, "answer.snapshot.json");
  const snapshot = compileResolvedSnapshot({
    subjectPack: "junior-physics-answer",
    profileName: "classroom"
  });

  fs.writeFileSync(inputPath, "# 参考答案\n", "utf8");
  fs.writeFileSync(outputPath, "pdf fixture", "utf8");
  writeJson(snapshotPath, snapshot);

  const manifest = {
    schemaVersion: "1.1",
    kind: "delivery-manifest",
    generatedAt: "2026-08-21T00:00:00.000Z",
    subjectPack: snapshot.subjectPack.assetId,
    snapshotId: snapshot.snapshotId,
    snapshotPath,
    snapshot: {
      id: snapshot.snapshotId,
      version: snapshot.subjectPack.version,
      profile: snapshot.activeProfile.name
    },
    profile: snapshot.activeProfile.name,
    input: inputPath,
    output: outputPath,
    review: {
      outputDir: path.join(root, "review"),
      manifestPath: path.join(root, "review", "manifest.json"),
      scale: "2"
    },
    ocr: {
      status: "not-requested"
    },
    graphics: {
      items: []
    },
    integrity: {
      algorithm: "sha256",
      input: fileIntegrity(inputPath),
      output: fileIntegrity(outputPath),
      snapshot: fileIntegrity(snapshotPath),
      reviewFiles: []
    },
    status: {
      toolchainPassed: true,
      deliveryComplete: true,
      reviewArtifactReady: false
    }
  };

  return { root, manifestPath, inputPath, outputPath, snapshotPath, snapshot, manifest };
}

function withFixture(run) {
  const fixture = createFixture();
  try {
    run(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

test("valid delivery manifest 1.1 is accepted", () => {
  withFixture(({ manifest, manifestPath }) => {
    assert.deepEqual(validateDeliveryManifest(manifest, manifestPath), []);
  });
});

test("delivery manifest rejects output integrity drift", () => {
  withFixture(({ manifest, manifestPath, outputPath }) => {
    fs.appendFileSync(outputPath, "tampered", "utf8");
    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(errors.includes("integrity.output.bytes does not match the current file."));
    assert.ok(errors.includes("integrity.output.sha256 does not match the current file."));
  });
});

test("delivery manifest rejects graphic metadata that disagrees with placement", () => {
  withFixture(({ manifest, manifestPath, root }) => {
    const previewPath = path.join(root, "preview.svg");
    const placementPath = path.join(root, "placed-answer-graphic.json");
    fs.writeFileSync(previewPath, "<svg xmlns=\"http://www.w3.org/2000/svg\" />", "utf8");
    writeJson(placementPath, {
      schemaVersion: "1.0",
      kind: "placed-answer-graphic",
      placedGraphicId: "graphic-placed",
      graphicId: "graphic",
      artifactId: "graphic-artifact",
      questionRef: "11",
      placementMode: "inline-medium",
      targetBlock: "answer-body",
      figureWidthMm: 120,
      captionMode: "inline",
      pageBreakPolicy: "avoid",
      previewPath: path.basename(previewPath)
    });
    manifest.graphics.items.push({
      placementPath,
      previewPath,
      placedGraphicId: "graphic-placed",
      graphicId: "wrong-graphic",
      artifactId: "graphic-artifact",
      questionRef: "11",
      placementMode: "inline-medium"
    });

    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(errors.includes("graphics.items[0].graphicId must match placement.graphicId."));
  });
});

test("delivery manifest rejects incomplete successful OCR metadata", () => {
  withFixture(({ manifest, manifestPath }) => {
    manifest.ocr = {
      status: "ok",
      provider: "tesseract.js",
      language: "chi_sim"
    };
    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(errors.includes("ocr.version must be a non-empty string when OCR is ok."));
  });
});

test("delivery manifest rejects a referenced snapshot mismatch", () => {
  withFixture(({ manifest, manifestPath, root, snapshot }) => {
    const mismatchedSnapshotPath = path.join(root, "mismatched.snapshot.json");
    writeJson(mismatchedSnapshotPath, {
      ...snapshot,
      snapshotId: `${snapshot.snapshotId}-different`,
      subjectPack: {
        ...snapshot.subjectPack,
        version: `${snapshot.subjectPack.version}-different`
      }
    });
    manifest.snapshotPath = mismatchedSnapshotPath;
    manifest.integrity.snapshot = fileIntegrity(mismatchedSnapshotPath);

    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(errors.includes("snapshotId must match referenced snapshot.snapshotId."));
    assert.ok(errors.includes("snapshot.version must match referenced snapshot.subjectPack.version."));
  });
});
