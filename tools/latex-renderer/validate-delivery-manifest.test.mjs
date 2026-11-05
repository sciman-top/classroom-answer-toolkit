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

test("package-relative manifest paths are accepted (2026-08-27 portability contract)", () => {
  withFixture(({ manifest, manifestPath }) => {
    // New writer emits package-internal paths relative to the manifest directory.
    manifest.input = "answer.md";
    manifest.output = "answer.pdf";
    manifest.snapshotPath = "answer.snapshot.json";
    manifest.integrity.input.path = "answer.md";
    manifest.integrity.output.path = "answer.pdf";
    manifest.integrity.snapshot.path = "answer.snapshot.json";
    manifest.review.outputDir = "answer.review";
    manifest.review.manifestPath = "answer.review/manifest.json";
    manifest.status.reviewArtifactReady = true;
    // reviewFiles anchor moved with the delivery-owned review package
    // (2026-08-27 closeout regression: absolute entries broke relocated archives).
    const reviewFixtureRoot = path.join(path.dirname(manifestPath), "answer.review");
    fs.mkdirSync(reviewFixtureRoot, { recursive: true });
    const reviewFileNames = ["manifest.json", "page-001.png"];
    fs.writeFileSync(path.join(reviewFixtureRoot, "page-001.png"), "review fixture", "utf8");
    writeJson(path.join(reviewFixtureRoot, "manifest.json"), {
      kind: "pdf-source-review",
      schemaVersion: "1.0",
      inputPath: "../answer.pdf",
      inputSha256: fileIntegrity(path.join(path.dirname(manifestPath), manifest.output)).sha256,
      inputBytes: fs.statSync(path.join(path.dirname(manifestPath), manifest.output)).size,
      pageCount: 1,
      selectedPages: [1],
      pages: [{ kind: "page-tile", pageNumber: 1, imagePath: path.join(reviewFixtureRoot, "page-001.png") }],
      ocrStatus: "not-requested"
    });
    manifest.integrity.reviewFiles = reviewFileNames.map((name) => {
      const filePath = path.join(reviewFixtureRoot, name);
      return { ...fileIntegrity(filePath), path: `answer.review/${name}` };
    });

    assert.deepEqual(validateDeliveryManifest(manifest, manifestPath), []);
  });
});

test("delivery manifest rejects an unbound extra file inside the review package", () => {
  withFixture(({ manifest, manifestPath }) => {
    manifest.status.reviewArtifactReady = true;
    const reviewRoot = path.join(path.dirname(manifestPath), "answer.review");
    fs.mkdirSync(reviewRoot, { recursive: true });
    const reviewFileNames = ["manifest.json", "page-001.png"];
    fs.writeFileSync(path.join(reviewRoot, "page-001.png"), "review fixture", "utf8");
    writeJson(path.join(reviewRoot, "manifest.json"), {
      kind: "pdf-source-review",
      schemaVersion: "1.0",
      inputPath: "../answer.pdf",
      inputSha256: fileIntegrity(manifest.output).sha256,
      inputBytes: fs.statSync(manifest.output).size,
      pageCount: 1,
      selectedPages: [1],
      pages: [{ kind: "page-tile", pageNumber: 1, imagePath: path.join(reviewRoot, "page-001.png") }],
      ocrStatus: "not-requested"
    });
    manifest.review.outputDir = "answer.review";
    manifest.review.manifestPath = "answer.review/manifest.json";
    manifest.integrity.reviewFiles = reviewFileNames.map((name) => {
      const filePath = path.join(reviewRoot, name);
      return { ...fileIntegrity(filePath), path: `answer.review/${name}` };
    });
    // A file added to the review package after the manifest was written must
    // fail validation: reviewFiles binds the exact packaged file set.
    fs.writeFileSync(path.join(reviewRoot, "stray.txt"), "not bound", "utf8");

    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(
      errors.some((error) => error.includes("integrity.reviewFiles is missing current review artifact")
        && error.includes("stray.txt")),
      errors.join("\n"));
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

test("legacy delivery manifest 1.0 is accepted without integrity metadata", () => {
  withFixture(({ manifest, manifestPath }) => {
    manifest.schemaVersion = "1.0";
    delete manifest.integrity;
    assert.deepEqual(validateDeliveryManifest(manifest, manifestPath), []);
  });
});

test("delivery manifest rejects an unsupported schemaVersion", () => {
  withFixture(({ manifest, manifestPath }) => {
    manifest.schemaVersion = "1.2";
    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(errors.some((error) => error.includes("Unsupported delivery manifest schemaVersion")));
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

test("complete 1.1 delivery cannot claim success without a review package", () => {
  withFixture(({ manifest, manifestPath }) => {
    manifest.status.reviewArtifactReady = true;
    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(errors.some((error) => error.includes("review")));
  });
});

test("1.1 schema requires integrity metadata", () => {
  withFixture(({ manifest, manifestPath }) => {
    delete manifest.integrity;
    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(errors.some((error) => error.includes("integrity")));
  });
});

test("delivery rejects a status flag that claims toolchain failure while delivery is complete", () => {
  withFixture(({ manifest, manifestPath }) => {
    manifest.status.toolchainPassed = false;
    const errors = validateDeliveryManifest(manifest, manifestPath);
    assert.ok(errors.some((error) => error.includes("toolchainPassed")));
  });
});
