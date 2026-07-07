import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const fixturePath = path.join(repoRoot, "eval", "junior-physics-answer", "cases", "smoke-answer.md");
const smokeDir = path.join(repoRoot, ".smoke-work");

function runNodeScript(scriptFileName, scriptArgs) {
  const result = spawnSync(
    process.execPath,
    [path.join(toolDir, scriptFileName), ...scriptArgs],
    {
      cwd: toolDir,
      stdio: "inherit",
      env: {
        ...process.env,
        INIT_CWD: repoRoot
      }
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function runNodeScriptExpectFailure(scriptFileName, scriptArgs, expectedMessage) {
  const result = spawnSync(
    process.execPath,
    [path.join(toolDir, scriptFileName), ...scriptArgs],
    {
      cwd: toolDir,
      encoding: "utf8",
      env: {
        ...process.env,
        INIT_CWD: repoRoot
      }
    }
  );

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) === 0) {
    throw new Error(`${scriptFileName} was expected to fail.`);
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!output.includes(expectedMessage)) {
    throw new Error(`${scriptFileName} failed without expected message "${expectedMessage}". Output:\n${output}`);
  }
}

function ensureCleanSmokeDir() {
  fs.rmSync(smokeDir, { recursive: true, force: true });
  fs.mkdirSync(smokeDir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertDeliveryManifestMatches(manifestPath, expectedSnapshot, expectedSnapshotPath, expectedStatus = {}) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Deliver manifest not found: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);
  const actualSnapshotPath = path.resolve(manifest.snapshotPath);

  if (manifest.snapshotId !== expectedSnapshot.snapshotId) {
    throw new Error(`Deliver manifest snapshotId mismatch: expected ${expectedSnapshot.snapshotId}, got ${manifest.snapshotId}`);
  }

  if (manifest.snapshot?.id !== expectedSnapshot.snapshotId) {
    throw new Error(`Deliver manifest snapshot.id mismatch: expected ${expectedSnapshot.snapshotId}, got ${manifest.snapshot?.id}`);
  }

  if (manifest.snapshot?.version !== expectedSnapshot.subjectPack?.version) {
    throw new Error(`Deliver manifest snapshot.version mismatch: expected ${expectedSnapshot.subjectPack?.version}, got ${manifest.snapshot?.version}`);
  }

  if (actualSnapshotPath !== expectedSnapshotPath) {
    throw new Error(`Deliver manifest snapshotPath mismatch: expected ${expectedSnapshotPath}, got ${actualSnapshotPath}`);
  }

  const status = manifest.status ?? {};
  const expectedReviewArtifactReady = Boolean(expectedStatus.reviewArtifactReady);

  if (status.toolchainPassed !== true) {
    throw new Error(`Deliver manifest status.toolchainPassed mismatch: expected true, got ${status.toolchainPassed}`);
  }

  if (status.deliveryComplete !== true) {
    throw new Error(`Deliver manifest status.deliveryComplete mismatch: expected true, got ${status.deliveryComplete}`);
  }

  if (status.reviewArtifactReady !== expectedReviewArtifactReady) {
    throw new Error(`Deliver manifest status.reviewArtifactReady mismatch: expected ${expectedReviewArtifactReady}, got ${status.reviewArtifactReady}`);
  }

  const expectedReviewState = expectedStatus.reviewState ?? (expectedReviewArtifactReady ? "ready_for_review" : "draft");
  if (manifest.review?.lifecycle?.state !== expectedReviewState) {
    throw new Error(`Deliver manifest review.lifecycle.state mismatch: expected ${expectedReviewState}, got ${manifest.review?.lifecycle?.state}`);
  }

  if (typeof manifest.review?.lifecycle?.updatedAt !== "string" || manifest.review.lifecycle.updatedAt.length === 0) {
    throw new Error("Deliver manifest review.lifecycle.updatedAt must be a non-empty string.");
  }

  if (!Array.isArray(manifest.review?.feedbackRefs) || manifest.review.feedbackRefs.length !== 0) {
    throw new Error(`Deliver manifest review.feedbackRefs mismatch: expected empty array, got ${JSON.stringify(manifest.review?.feedbackRefs)}`);
  }

  if (status.visualReviewPassed !== null) {
    throw new Error(`Deliver manifest status.visualReviewPassed mismatch: expected null, got ${status.visualReviewPassed}`);
  }

  if (status.trusted !== false) {
    throw new Error(`Deliver manifest status.trusted mismatch: expected false, got ${status.trusted}`);
  }

  if (manifest.ocr?.status !== "not-requested") {
    throw new Error(`Deliver manifest OCR status mismatch: expected not-requested, got ${manifest.ocr?.status}`);
  }

  const expectedGraphics = expectedStatus.expectedGraphics ?? [];
  const actualGraphics = (manifest.graphics?.items ?? [])
    .map((item) => item?.graphicId)
    .filter((graphicId) => typeof graphicId === "string");

  for (const graphicId of expectedGraphics) {
    if (!actualGraphics.includes(graphicId)) {
      throw new Error(`Deliver manifest graphics mismatch: expected graphic ${graphicId}, got ${actualGraphics.join(", ")}`);
    }
  }
}

function assertDeliveryManifestRejectsMismatchedGraphic(explicitSnapshot) {
  const placementPath = path.join(smokeDir, "mismatched-placed-answer-graphic.json");
  const previewPath = path.join(smokeDir, "mismatched-preview.svg");
  const manifestPath = path.join(smokeDir, "mismatched-graphic.delivery-manifest.json");

  fs.writeFileSync(previewPath, "<svg xmlns=\"http://www.w3.org/2000/svg\" />", "utf8");
  writeJson(placementPath, {
    schemaVersion: "1.0",
    kind: "placed-answer-graphic",
    placedGraphicId: "smoke-graphic-placed",
    graphicId: "smoke-graphic",
    artifactId: "smoke-graphic-artifact",
    questionRef: "11",
    placementMode: "inline-medium",
    targetBlock: "answer-body",
    figureWidthMm: 120,
    captionMode: "inline",
    pageBreakPolicy: "avoid",
    previewPath: path.basename(previewPath)
  });

  writeJson(manifestPath, {
    schemaVersion: "1.0",
    kind: "delivery-manifest",
    generatedAt: "2026-06-22T00:00:00.000Z",
    subjectPack: "junior-physics-answer",
    snapshotId: explicitSnapshot.snapshotId,
    snapshotPath: path.join(smokeDir, "resolved-snapshot.explicit.json"),
    snapshot: {
      id: explicitSnapshot.snapshotId,
      version: explicitSnapshot.subjectPack?.version ?? "unknown",
      profile: "classroom"
    },
    profile: "classroom",
    input: path.join(smokeDir, "mismatched-graphic.md"),
    output: path.join(smokeDir, "mismatched-graphic.pdf"),
    review: {
      outputDir: path.join(smokeDir, "mismatched-review"),
      manifestPath: path.join(smokeDir, "mismatched-review", "manifest.json"),
      scale: "2"
    },
    ocr: {
      status: "not-requested"
    },
    graphics: {
      items: [
        {
          placementPath,
          previewPath,
          placedGraphicId: "smoke-graphic-placed",
          graphicId: "wrong-graphic",
          artifactId: "smoke-graphic-artifact",
          questionRef: "11",
          placementMode: "inline-medium"
        }
      ]
    },
    status: {
      toolchainPassed: true,
      deliveryComplete: true,
      reviewArtifactReady: false,
      visualReviewPassed: null,
      trusted: false
    }
  });

  runNodeScriptExpectFailure(
    "validate-delivery-manifest.mjs",
    ["--manifest", path.relative(repoRoot, manifestPath)],
    "graphics.items[0].graphicId must match placement.graphicId."
  );
}

function assertDeliveryManifestRejectsIncompleteOcrMetadata(explicitSnapshot) {
  const manifestPath = path.join(smokeDir, "incomplete-ocr.delivery-manifest.json");
  writeJson(manifestPath, {
    schemaVersion: "1.0",
    kind: "delivery-manifest",
    generatedAt: "2026-06-22T00:00:00.000Z",
    subjectPack: "junior-physics-answer",
    snapshotId: explicitSnapshot.snapshotId,
    snapshotPath: path.join(smokeDir, "resolved-snapshot.explicit.json"),
    snapshot: {
      id: explicitSnapshot.snapshotId,
      version: explicitSnapshot.subjectPack?.version ?? "unknown",
      profile: "classroom"
    },
    profile: "classroom",
    input: path.join(smokeDir, "incomplete-ocr.md"),
    output: path.join(smokeDir, "incomplete-ocr.pdf"),
    review: {
      outputDir: path.join(smokeDir, "ocr-review"),
      manifestPath: path.join(smokeDir, "ocr-review", "manifest.json"),
      scale: "2"
    },
    ocr: {
      status: "ok",
      provider: "tesseract.js",
      language: "chi_sim"
    },
    graphics: {
      items: []
    },
    status: {
      toolchainPassed: true,
      deliveryComplete: true,
      reviewArtifactReady: false,
      visualReviewPassed: null,
      trusted: false
    }
  });

  runNodeScriptExpectFailure(
    "validate-delivery-manifest.mjs",
    ["--manifest", path.relative(repoRoot, manifestPath)],
    "ocr.version must be a non-empty string when OCR is ok."
  );
}

function assertDeliveryManifestRejectsMismatchedSnapshot(explicitSnapshot) {
  const referencedSnapshotPath = path.join(smokeDir, "mismatched-referenced-snapshot.json");
  const manifestPath = path.join(smokeDir, "mismatched-snapshot.delivery-manifest.json");
  writeJson(referencedSnapshotPath, {
    ...explicitSnapshot,
    snapshotId: `${explicitSnapshot.snapshotId}-different`,
    subjectPack: {
      ...explicitSnapshot.subjectPack,
      version: `${explicitSnapshot.subjectPack?.version ?? "unknown"}-different`
    }
  });

  writeJson(manifestPath, {
    schemaVersion: "1.0",
    kind: "delivery-manifest",
    generatedAt: "2026-06-22T00:00:00.000Z",
    subjectPack: "junior-physics-answer",
    snapshotId: explicitSnapshot.snapshotId,
    snapshotPath: referencedSnapshotPath,
    snapshot: {
      id: explicitSnapshot.snapshotId,
      version: explicitSnapshot.subjectPack?.version ?? "unknown",
      profile: "classroom"
    },
    profile: "classroom",
    input: path.join(smokeDir, "mismatched-snapshot.md"),
    output: path.join(smokeDir, "mismatched-snapshot.pdf"),
    review: {
      outputDir: path.join(smokeDir, "mismatched-snapshot-review"),
      manifestPath: path.join(smokeDir, "mismatched-snapshot-review", "manifest.json"),
      scale: "2"
    },
    ocr: {
      status: "not-requested"
    },
    graphics: {
      items: []
    },
    status: {
      toolchainPassed: true,
      deliveryComplete: true,
      reviewArtifactReady: false,
      visualReviewPassed: null,
      trusted: false
    }
  });

  runNodeScriptExpectFailure(
    "validate-delivery-manifest.mjs",
    ["--manifest", path.relative(repoRoot, manifestPath)],
    "snapshotId must match referenced snapshot.snapshotId."
  );
}

function assertDeliveryManifestRejectsTrustedReviewBeforeApproval(explicitSnapshot) {
  const manifestPath = path.join(smokeDir, "trusted-before-approval.delivery-manifest.json");
  writeJson(manifestPath, {
    schemaVersion: "1.0",
    kind: "delivery-manifest",
    generatedAt: "2026-06-22T00:00:00.000Z",
    subjectPack: "junior-physics-answer",
    snapshotId: explicitSnapshot.snapshotId,
    snapshotPath: path.join(smokeDir, "resolved-snapshot.explicit.json"),
    snapshot: {
      id: explicitSnapshot.snapshotId,
      version: explicitSnapshot.subjectPack?.version ?? "unknown",
      profile: "classroom"
    },
    profile: "classroom",
    input: path.join(smokeDir, "trusted-before-approval.md"),
    output: path.join(smokeDir, "trusted-before-approval.pdf"),
    review: {
      outputDir: path.join(smokeDir, "trusted-before-approval-review"),
      manifestPath: path.join(smokeDir, "trusted-before-approval-review", "manifest.json"),
      scale: "2",
      lifecycle: {
        state: "ready_for_review",
        updatedAt: "2026-06-22T00:00:00.000Z"
      },
      feedbackRefs: []
    },
    ocr: {
      status: "not-requested"
    },
    graphics: {
      items: []
    },
    status: {
      toolchainPassed: true,
      deliveryComplete: true,
      reviewArtifactReady: false,
      visualReviewPassed: true,
      trusted: true
    }
  });

  runNodeScriptExpectFailure(
    "validate-delivery-manifest.mjs",
    ["--manifest", path.relative(repoRoot, manifestPath)],
    "status.trusted=true requires review.lifecycle.state to be approved or published."
  );
}

function main() {
  ensureCleanSmokeDir();

  const reviewDir = path.join(smokeDir, "review-classroom");
  const deliverPdfPath = path.join(smokeDir, "smoke-deliver.pdf");
  const deliverManifestPath = path.join(smokeDir, "smoke-deliver.delivery-manifest.json");
  const explicitDeliverPdfPath = path.join(smokeDir, "smoke-deliver-explicit.pdf");
  const explicitDeliverManifestPath = path.join(smokeDir, "smoke-deliver-explicit.delivery-manifest.json");
  const snapshotPaths = {
    classroom: path.join(smokeDir, "resolved-snapshot.classroom.json"),
    compact: path.join(smokeDir, "resolved-snapshot.compact.json")
  };

  for (const profile of ["classroom", "compact"]) {
    console.log(`[smoke] compile snapshot ${profile}`);
    runNodeScript(path.join("..", "rule-compiler", "compile-snapshot.mjs"), [
      "--profile",
      profile,
      "--out",
      path.relative(repoRoot, snapshotPaths[profile])
    ]);
  }

  console.log("[smoke] validate classroom");
  runNodeScript("validate-answer-markdown.mjs", [
    path.relative(repoRoot, fixturePath),
    "--profile",
    "classroom",
    "--snapshot",
    path.relative(repoRoot, snapshotPaths.classroom)
  ]);

  console.log("[smoke] validate compact");
  runNodeScript("validate-answer-markdown.mjs", [
    path.relative(repoRoot, fixturePath),
    "--profile",
    "compact",
    "--snapshot",
    path.relative(repoRoot, snapshotPaths.compact)
  ]);

  console.log("[smoke] render classroom");
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, path.join(smokeDir, "smoke-classroom.pdf")),
    "--profile",
    "classroom",
    "--snapshot",
    path.relative(repoRoot, snapshotPaths.classroom)
  ]);

  console.log("[smoke] render compact");
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, path.join(smokeDir, "smoke-compact.pdf")),
    "--profile",
    "compact",
    "--snapshot",
    path.relative(repoRoot, snapshotPaths.compact)
  ]);

  console.log("[smoke] review classroom pdf");
  runNodeScript("review-source-pdf.mjs", [
    path.relative(repoRoot, path.join(smokeDir, "smoke-classroom.pdf")),
    "--out",
    path.relative(repoRoot, reviewDir),
    "--scale",
    "2"
  ]);

  console.log("[smoke] deliver classroom");
  runNodeScript("deliver-answer.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, deliverPdfPath),
    "--profile",
    "classroom",
    "--keep-review"
  ]);

  const classroomSnapshot = readJson(snapshotPaths.classroom);
  assertDeliveryManifestMatches(
    deliverManifestPath,
    classroomSnapshot,
    path.resolve(path.join(repoRoot, ".snapshot-cache", "resolved-snapshot.json")),
    { reviewArtifactReady: true }
  );

  const explicitSnapshotPath = path.join(smokeDir, "resolved-snapshot.explicit.json");
  const explicitSnapshot = {
    ...classroomSnapshot,
    snapshotId: `${classroomSnapshot.snapshotId}-explicit`,
    generatedAt: "2026-06-22T00:00:00.000Z",
    subjectPack: {
      ...classroomSnapshot.subjectPack,
      version: `${classroomSnapshot.subjectPack?.version ?? "unknown"}-explicit`
    }
  };
  writeJson(explicitSnapshotPath, explicitSnapshot);

  console.log("[smoke] deliver classroom with explicit snapshot");
  runNodeScript("deliver-answer.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, explicitDeliverPdfPath),
    "--profile",
    "classroom",
    "--snapshot-path",
    path.relative(repoRoot, explicitSnapshotPath)
  ]);

  assertDeliveryManifestMatches(
    explicitDeliverManifestPath,
    explicitSnapshot,
    explicitSnapshotPath,
    { reviewArtifactReady: false }
  );

  assertDeliveryManifestRejectsMismatchedGraphic(explicitSnapshot);
  assertDeliveryManifestRejectsIncompleteOcrMetadata(explicitSnapshot);
  assertDeliveryManifestRejectsMismatchedSnapshot(explicitSnapshot);
  assertDeliveryManifestRejectsTrustedReviewBeforeApproval(explicitSnapshot);

  console.log("[smoke] cleanup");
  fs.rmSync(smokeDir, { recursive: true, force: true });
  console.log("[smoke] passed");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(2);
}
