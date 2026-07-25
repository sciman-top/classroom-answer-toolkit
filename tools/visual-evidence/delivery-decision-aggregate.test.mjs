import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  compileDeliveryDecisionAggregate,
  validateDeliveryDecisionAggregateShape,
  verifyDeliveryDecisionAggregate
} from "./delivery-decision-aggregate.mjs";

const compilerPath = path.join(import.meta.dirname, "delivery-decision-aggregate.mjs");
const fixtureRoot = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "eval",
  "visual-evidence",
  "cases",
  "delivery-aggregate");

function createWorkspace(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-toolkit-delivery-aggregate-"));
  const snapshotPath = path.join(root, "snapshot.json");
  const inputPath = path.join(root, "answer.md");
  const manifestPath = path.join(root, "delivery-manifest.json");
  const inventoryPath = path.join(root, "sample-package.json");
  const coveragePath = path.join(root, "coverage.json");
  const decisionPaths = [
    path.join(root, "decision-q1.json"),
    path.join(root, "decision-q2.json")
  ];
  const reviewDir = path.join(root, "review");
  fs.mkdirSync(reviewDir);
  fs.writeFileSync(path.join(root, "answer.pdf"), "%PDF-1.4\n% synthetic test artifact\n", "utf8");
  writeJson(path.join(reviewDir, "manifest.json"), {
    kind: "synthetic-review-manifest",
    generatedAt: "2026-07-25T00:00:00Z"
  });

  writeJson(snapshotPath, {
    snapshotId: "snapshot-aggregate-test",
    generatedAt: "2026-07-25T00:00:00Z",
    layers: {
      platformCore: "v1.0",
      subjectPack: "v0.1"
    },
    subjectPack: {
      schemaVersion: "1.0",
      assetId: "math-answer",
      displayName: "Synthetic Math",
      version: "v0.1",
      status: "experimental",
      locale: "zh-CN",
      kind: "subject-pack",
      sourceOfTruth: {}
    },
    activeProfile: { name: "classroom" },
    rules: [],
    profiles: {
      classroom: { name: "classroom" }
    },
    toolchain: {
      compiler: "synthetic"
    },
    inputRefs: {
      subjectManifest: "synthetic-manifest.json",
      subjectConfig: "synthetic-config.json"
    },
    meta: {
      ruleCount: 0,
      profileCount: 1
    }
  });
  fs.writeFileSync(inputPath, "# Synthetic answer\n", "utf8");
  writeJson(manifestPath, createManifest({
    lifecycleState: options.lifecycleState ?? "approved",
    toolchainPassed: options.toolchainPassed ?? true,
    snapshotPath,
    inputPath
  }));
  writeJson(inventoryPath, createInventory());

  const binding = {
    snapshotId: "snapshot-aggregate-test",
    snapshotSha256: sha256File(snapshotPath),
    inputSha256: sha256File(inputPath),
    manifestSha256: sha256File(manifestPath)
  };
  writeJson(coveragePath, {
    schemaVersion: "1.0",
    kind: "delivery-question-coverage",
    coverageId: "coverage-aggregate-test",
    subjectPack: "math-answer",
    deliveryBinding: binding,
    questionInventory: {
      ref: path.basename(inventoryPath),
      sha256: sha256File(inventoryPath)
    },
    expectedQuestionRefs: ["Q1", "Q2"],
    coverageComplete: options.coverageComplete ?? true,
    generatedAt: "2026-07-25T00:00:00Z"
  });
  writeJson(decisionPaths[0], createDecision("Q1", binding));
  writeJson(decisionPaths[1], createDecision("Q2", binding, options.secondDecision));

  return {
    root,
    snapshotPath,
    inputPath,
    manifestPath,
    inventoryPath,
    coveragePath,
    decisionPaths,
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function createManifest(context) {
  return {
    schemaVersion: "1.0",
    kind: "delivery-manifest",
    generatedAt: "2026-07-25T00:00:00Z",
    subjectPack: "math-answer",
    snapshotId: "snapshot-aggregate-test",
    snapshotPath: context.snapshotPath,
    snapshot: {
      id: "snapshot-aggregate-test",
      version: "v0.1",
      profile: "classroom"
    },
    profile: "classroom",
    input: context.inputPath,
    output: path.join(path.dirname(context.inputPath), "answer.pdf"),
    review: {
      outputDir: path.join(path.dirname(context.inputPath), "review"),
      manifestPath: path.join(path.dirname(context.inputPath), "review", "manifest.json"),
      scale: "2",
      lifecycle: {
        state: context.lifecycleState,
        updatedAt: "2026-07-25T00:00:00Z"
      },
      feedbackRefs: []
    },
    status: {
      toolchainPassed: context.toolchainPassed,
      deliveryComplete: true,
      reviewArtifactReady: true,
      visualReviewPassed: null,
      trusted: false
    },
    ocr: {
      status: "not-requested"
    }
  };
}

function createInventory() {
  return {
    schemaVersion: "1.0",
    kind: "sample-package",
    sampleId: "aggregate-test",
    subjectPack: "math-answer",
    dataClassification: {
      level: "internal",
      containsPersonalData: false,
      cloudEgressAllowed: false
    },
    expectedQuestionRefs: ["Q1", "Q2"],
    artifacts: [
      {
        artifactId: "synthetic-answer",
        role: "reference_truth",
        path: "answer.md",
        mediaType: "text/markdown",
        sourceType: "markdown",
        parseMode: "native"
      }
    ]
  };
}

function createDecision(questionRef, binding, overrides = {}) {
  return {
    schemaVersion: "1.0",
    kind: "decision-record",
    decisionId: `decision-${questionRef.toLowerCase()}`,
    subjectPack: "math-answer",
    questionRef,
    normalizedQuestionRef: `math-answer:aggregate:${questionRef}`,
    deliveryBinding: binding,
    evidenceBundleRef: overrides.evidenceBundleRef ?? `evidence-${questionRef.toLowerCase()}`,
    trackResultRefs: overrides.trackResultRefs ?? [`track-${questionRef.toLowerCase()}`],
    decision: overrides.decision ?? "accept",
    answer: `${questionRef} answer`,
    trusted: overrides.trusted ?? true,
    visualReviewPassed: overrides.visualReviewPassed ?? true,
    reviewRequired: overrides.reviewRequired ?? false,
    reviewQueue: overrides.reviewQueue ?? "none",
    risk: {
      level: "low",
      categories: []
    },
    decisionReasons: overrides.decisionReasons ?? [
      "evidence_chain_complete",
      "human_approved"
    ],
    conflictRefs: overrides.conflictRefs ?? [],
    feedbackRefs: [],
    statusProjection: {
      visualReviewPassed: overrides.visualReviewPassed ?? true,
      trusted: overrides.trusted ?? true
    },
    generatedAt: "2026-07-25T00:00:00Z"
  };
}

test("compileDeliveryDecisionAggregate trusts complete byte-bound approved coverage", () => {
  const workspace = createWorkspace();
  try {
    const aggregate = compileDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      coveragePath: workspace.coveragePath,
      decisionPaths: workspace.decisionPaths,
      generatedAt: "2026-07-25T00:00:00Z"
    });

    assert.equal(aggregate.decision, "accept");
    assert.equal(aggregate.trusted, true);
    assert.equal(aggregate.visualReviewPassed, true);
    assert.equal(aggregate.summary.expectedCount, 2);
    assert.equal(aggregate.summary.acceptedCount, 2);
    assert.equal(aggregate.summary.unresolvedCount, 0);
    assert.deepEqual(validateDeliveryDecisionAggregateShape(aggregate), []);
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate rejects a missing delivery output", () => {
  const workspace = createWorkspace();
  try {
    fs.rmSync(path.join(workspace.root, "answer.pdf"));
    assert.throws(
      () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      }),
      /status\.deliveryComplete cannot be true unless output is a file/
    );
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate rejects a directory posing as delivery output", () => {
  const workspace = createWorkspace();
  try {
    const outputPath = path.join(workspace.root, "answer.pdf");
    fs.rmSync(outputPath);
    fs.mkdirSync(outputPath);
    assert.throws(
      () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      }),
      /status\.deliveryComplete cannot be true unless output is a file/
    );
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate rejects a directory posing as review manifest", () => {
  const workspace = createWorkspace();
  try {
    const reviewManifestPath = path.join(workspace.root, "review", "manifest.json");
    fs.rmSync(reviewManifestPath);
    fs.mkdirSync(reviewManifestPath);
    assert.throws(
      () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      }),
      /status\.reviewArtifactReady cannot be true unless review\.manifestPath is a file/
    );
  } finally {
    workspace.dispose();
  }
});

test("tracked delivery aggregate fixture recompiles deterministically", () => {
  const aggregatePath = path.join(
    fixtureRoot,
    "synthetic.delivery-decision-aggregate.json");
  const originalBytes = fs.readFileSync(aggregatePath);
  const aggregate = compileDeliveryDecisionAggregate({
    manifestPath: path.join(fixtureRoot, "synthetic.delivery-manifest.json"),
    coveragePath: path.join(fixtureRoot, "synthetic.delivery-question-coverage.json"),
    decisionPaths: [
      path.join(fixtureRoot, "synthetic-q1.decision-record.json"),
      path.join(fixtureRoot, "synthetic-q2.decision-record.json")
    ],
    outputPath: aggregatePath,
    generatedAt: "2026-07-25T00:00:00Z"
  });

  assert.deepEqual(aggregate, JSON.parse(originalBytes.toString("utf8")));
  assert.deepEqual(fs.readFileSync(aggregatePath), originalBytes);
});

test("compileDeliveryDecisionAggregate stays fail-closed when a question is missing", () => {
  const workspace = createWorkspace();
  try {
    const aggregate = compileDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      coveragePath: workspace.coveragePath,
      decisionPaths: [workspace.decisionPaths[0]]
    });

    assert.equal(aggregate.decision, "review_required");
    assert.equal(aggregate.trusted, false);
    assert.equal(aggregate.visualReviewPassed, null);
    assert.deepEqual(aggregate.summary.unresolvedQuestionRefs, ["Q2"]);
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate rejects duplicate expected question refs", () => {
  const workspace = createWorkspace();
  try {
    const coverage = readJson(workspace.coveragePath);
    coverage.expectedQuestionRefs = ["Q1", "Q1"];
    writeJson(workspace.coveragePath, coverage);

    assert.throws(
      () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      }),
      /duplicate question references/
    );
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate rejects duplicate DecisionRecord question refs", () => {
  const workspace = createWorkspace();
  try {
    const duplicate = readJson(workspace.decisionPaths[1]);
    duplicate.questionRef = "Q1";
    writeJson(workspace.decisionPaths[1], duplicate);

    assert.throws(
      () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      }),
      /Duplicate DecisionRecord questionRef/
    );
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate rejects input hash drift", () => {
  const workspace = createWorkspace();
  try {
    fs.appendFileSync(workspace.inputPath, "tampered\n", "utf8");

    assert.throws(
      () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      }),
      /inputSha256/
    );
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate rejects question inventory hash drift", () => {
  const workspace = createWorkspace();
  try {
    fs.appendFileSync(workspace.inventoryPath, "\n", "utf8");

    assert.throws(
      () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      }),
      /questionInventory\.sha256/
    );
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate rejects a mismatched DecisionRecord binding", () => {
  const workspace = createWorkspace();
  try {
    const decision = readJson(workspace.decisionPaths[1]);
    decision.deliveryBinding.inputSha256 = "d".repeat(64);
    writeJson(workspace.decisionPaths[1], decision);

    assert.throws(
      () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      }),
      /deliveryBinding does not match/
    );
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate does not trust a blocking decision reason", () => {
  const workspace = createWorkspace({
    secondDecision: {
      decisionReasons: [
        "evidence_chain_complete",
        "human_approved",
        "grounding_insufficient"
      ]
    }
  });
  try {
    const aggregate = compileDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      coveragePath: workspace.coveragePath,
      decisionPaths: workspace.decisionPaths
    });

    assert.equal(aggregate.trusted, false);
    assert.deepEqual(aggregate.summary.unresolvedQuestionRefs, ["Q2"]);
  } finally {
    workspace.dispose();
  }
});

for (const contradictoryReason of [
  "high_risk_visual",
  "review_pending",
  "binding_unstable",
  "ocr_image_conflict",
  "sentinel_required",
  "drawing_task_unsupported",
  "cloud_egress_not_allowed",
  "unknown_positive_reason"
]) {
  test(`compileDeliveryDecisionAggregate rejects non-allowlisted reason ${contradictoryReason}`, () => {
    const workspace = createWorkspace({
      secondDecision: {
        decisionReasons: [
          "evidence_chain_complete",
          "human_approved",
          contradictoryReason
        ]
      }
    });
    try {
      const invoke = () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      });
      if (contradictoryReason === "unknown_positive_reason") {
        assert.throws(invoke, /DecisionRecord schema validation failed/);
      } else {
        const aggregate = invoke();
        assert.equal(aggregate.trusted, false);
        assert.deepEqual(aggregate.summary.unresolvedQuestionRefs, ["Q2"]);
      }
    } finally {
      workspace.dispose();
    }
  });
}

for (const [label, override] of [
  ["missing evidence bundle", { evidenceBundleRef: "" }],
  ["missing track results", { trackResultRefs: [] }],
  ["present conflicts", { conflictRefs: ["conflict-q2"] }],
  ["missing evidence reason", { decisionReasons: ["human_approved"] }],
  ["missing approval reason", { decisionReasons: ["evidence_chain_complete"] }]
]) {
  test(`compileDeliveryDecisionAggregate fails closed for ${label}`, () => {
    const workspace = createWorkspace({ secondDecision: override });
    try {
      const invoke = () => compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths
      });
      const aggregate = invoke();
      assert.equal(aggregate.trusted, false);
      assert.deepEqual(aggregate.summary.unresolvedQuestionRefs, ["Q2"]);
    } finally {
      workspace.dispose();
    }
  });
}

test("compileDeliveryDecisionAggregate does not trust before manifest approval", () => {
  const workspace = createWorkspace({ lifecycleState: "under_review" });
  try {
    const aggregate = compileDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      coveragePath: workspace.coveragePath,
      decisionPaths: workspace.decisionPaths
    });

    assert.equal(aggregate.trusted, false);
    assert.equal(aggregate.visualReviewPassed, null);
    assert.ok(aggregate.decisionReasons.includes("review_lifecycle_not_approved"));
  } finally {
    workspace.dispose();
  }
});

test("compileDeliveryDecisionAggregate does not trust when a manifest gate fails", () => {
  const workspace = createWorkspace({ toolchainPassed: false });
  try {
    const aggregate = compileDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      coveragePath: workspace.coveragePath,
      decisionPaths: workspace.decisionPaths
    });

    assert.equal(aggregate.trusted, false);
    assert.ok(aggregate.decisionReasons.includes("manifest_gates_failed"));
  } finally {
    workspace.dispose();
  }
});

test("verifyDeliveryDecisionAggregate rehashes and recomputes every source", () => {
  const workspace = createWorkspace();
  try {
    const aggregatePath = path.join(workspace.root, "aggregate.json");
    const aggregate = compileDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      coveragePath: workspace.coveragePath,
      decisionPaths: workspace.decisionPaths,
      outputPath: aggregatePath,
      generatedAt: "2026-07-25T00:00:00Z"
    });
    writeJson(aggregatePath, aggregate);

    const result = verifyDeliveryDecisionAggregate({
      aggregatePath,
      manifestPath: workspace.manifestPath
    });

    assert.equal(result.valid, true);
    assert.equal(result.aggregate.aggregateId, aggregate.aggregateId);
    assert.equal(result.sourceHashes.decisionRecordSha256.length, 2);
  } finally {
    workspace.dispose();
  }
});

test("verifyDeliveryDecisionAggregate ignores property order and additive fields", () => {
  const workspace = createWorkspace();
  try {
    const aggregatePath = path.join(workspace.root, "aggregate.json");
    const aggregate = compileDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      coveragePath: workspace.coveragePath,
      decisionPaths: workspace.decisionPaths,
      outputPath: aggregatePath,
      generatedAt: "2026-07-25T00:00:00Z"
    });
    const reorderedAggregate = {
      extensionField: { supported: true },
      ...Object.fromEntries(Object.entries(aggregate).reverse())
    };
    reorderedAggregate.deliveryBinding = {
      extensionDigest: "future",
      ...Object.fromEntries(Object.entries(aggregate.deliveryBinding).reverse())
    };
    writeJson(aggregatePath, reorderedAggregate);

    assert.equal(verifyDeliveryDecisionAggregate({
      aggregatePath,
      manifestPath: workspace.manifestPath
    }).valid, true);
  } finally {
    workspace.dispose();
  }
});

test("verifyDeliveryDecisionAggregate rejects a forged trusted aggregate with zero decisions", () => {
  const workspace = createWorkspace();
  try {
    const aggregatePath = path.join(workspace.root, "aggregate.json");
    const aggregate = compileDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      coveragePath: workspace.coveragePath,
      decisionPaths: workspace.decisionPaths,
      outputPath: aggregatePath,
      generatedAt: "2026-07-25T00:00:00Z"
    });
    aggregate.decisionRecords = [];
    aggregate.summary.decidedCount = 0;
    writeJson(aggregatePath, aggregate);

    assert.throws(
      () => verifyDeliveryDecisionAggregate({
        aggregatePath,
        manifestPath: workspace.manifestPath
      }),
      /trusted aggregate requires complete accepted coverage/
    );
  } finally {
    workspace.dispose();
  }
});

for (const sourceName of [
  "manifest",
  "snapshot",
  "input",
  "inventory",
  "coverage",
  "decision"
]) {
  test(`verifyDeliveryDecisionAggregate rejects ${sourceName} byte drift`, () => {
    const workspace = createWorkspace();
    try {
      const aggregatePath = path.join(workspace.root, "aggregate.json");
      const aggregate = compileDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        coveragePath: workspace.coveragePath,
        decisionPaths: workspace.decisionPaths,
        outputPath: aggregatePath,
        generatedAt: "2026-07-25T00:00:00Z"
      });
      writeJson(aggregatePath, aggregate);
      const sourcePath = {
        manifest: workspace.manifestPath,
        snapshot: workspace.snapshotPath,
        input: workspace.inputPath,
        inventory: workspace.inventoryPath,
        coverage: workspace.coveragePath,
        decision: workspace.decisionPaths[0]
      }[sourceName];
      fs.appendFileSync(sourcePath, sourceName === "input" ? "drift\n" : "\n", "utf8");

      assert.throws(
        () => verifyDeliveryDecisionAggregate({
          aggregatePath,
          manifestPath: workspace.manifestPath
        }),
        /does not match|Sha256|SHA-256|schema validation failed/
      );
    } finally {
      workspace.dispose();
    }
  });
}

for (const alias of ["manifestPath", "coveragePath", "decisionPath"]) {
  test(`aggregate CLI rejects --out aliasing ${alias} without modification`, () => {
    const workspace = createWorkspace();
    try {
      const aliasPath = alias === "decisionPath"
        ? workspace.decisionPaths[0]
        : workspace[alias];
      const originalBytes = fs.readFileSync(aliasPath);
      const result = runCompilerCli(workspace, aliasPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /--out must not overwrite/);
      assert.deepEqual(fs.readFileSync(aliasPath), originalBytes);
    } finally {
      workspace.dispose();
    }
  });
}

test("aggregate CLI atomically replaces a normal output", () => {
  const workspace = createWorkspace();
  try {
    const outputPath = path.join(workspace.root, "aggregate.json");
    fs.writeFileSync(outputPath, "old output\n", "utf8");
    const result = runCompilerCli(workspace, outputPath);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readJson(outputPath).kind, "delivery-decision-aggregate");
    assert.deepEqual(
      fs.readdirSync(workspace.root).filter((name) => name.endsWith(".tmp")),
      []);
  } finally {
    workspace.dispose();
  }
});

function runCompilerCli(workspace, outputPath) {
  return spawnSync(process.execPath, [
    compilerPath,
    "--manifest", workspace.manifestPath,
    "--coverage", workspace.coveragePath,
    "--decision", workspace.decisionPaths[0],
    "--decision", workspace.decisionPaths[1],
    "--out", outputPath,
    "--generated-at", "2026-07-25T00:00:00Z"
  ], {
    encoding: "utf8"
  });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
