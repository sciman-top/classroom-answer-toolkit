import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const decisionRecordSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "decision-record.schema.json");

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/visual-evidence run compile:decision -- --evidence-bundle <path> --track-result <path> [--track-result <path>] [--out <path>]",
    "",
    "Options:",
    "  --evidence-bundle <path>      ProblemEvidenceBundle JSON",
    "  --track-result <path>         TrackResult JSON; repeat for Track A/B/C",
    "  --generated-at <iso-time>     Override generatedAt",
    "  --human-approved             Mark visualReviewPassed=true when all gates allow it",
    "  --out <path>                  Write DecisionRecord JSON to this path",
    "  --json                        Print JSON to stdout even when --out is set"
  ].join("\n");
}

export function compileDecisionRecord(options) {
  const evidenceBundle = options.evidenceBundle;
  const trackResults = options.trackResults ?? [];
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const humanApproved = options.humanApproved === true;

  const evidenceMissing = hasMissingEvidence(evidenceBundle, trackResults);
  const dualTrackMatch = hasDualTrackMatch(trackResults);
  const dualTrackConflict = hasDualTrackConflict(trackResults);
  const lowConfidence = hasLowConfidence(trackResults);
  const ruleValidatorFailed = hasBlockingValidatorFinding(trackResults);
  const highRiskVisual = isHighRiskVisual(evidenceBundle, trackResults);
  const unsafeShortcutFail = hasUnsafeShortcutFail(trackResults);
  const groundingInsufficient = hasGroundingInsufficient(evidenceBundle, trackResults);
  const acceptanceTierUnverified = hasAcceptanceTierUnverified(evidenceBundle, trackResults);
  const strictSchemaDowngraded = hasStrictSchemaDowngraded(trackResults);
  const reviewRequired = evidenceMissing
    || dualTrackConflict
    || lowConfidence
    || ruleValidatorFailed
    || highRiskVisual
    || unsafeShortcutFail
    || groundingInsufficient
    || acceptanceTierUnverified
    || strictSchemaDowngraded
    || evidenceBundle.risk?.reviewRequired === true
    || trackResults.some((trackResult) => trackResult.risk?.reviewRequired === true)
    || !humanApproved;

  const decisionReasons = [];
  if (dualTrackMatch) {
    decisionReasons.push("dual_track_match");
  }
  if (dualTrackConflict) {
    decisionReasons.push("dual_track_conflict");
  }
  decisionReasons.push(evidenceMissing ? "evidence_chain_missing" : "evidence_chain_complete");
  if (lowConfidence) {
    decisionReasons.push("low_confidence");
  }
  if (highRiskVisual) {
    decisionReasons.push("high_risk_visual");
  }
  if (ruleValidatorFailed) {
    decisionReasons.push("rule_validator_failed");
  }
  if (unsafeShortcutFail) {
    decisionReasons.push("unsafe_shortcut_fail");
  }
  if (groundingInsufficient) {
    decisionReasons.push("grounding_insufficient");
  }
  if (acceptanceTierUnverified) {
    decisionReasons.push("acceptance_tier_unverified");
  }
  if (strictSchemaDowngraded) {
    decisionReasons.push("strict_schema_downgraded");
  }
  if (!humanApproved) {
    decisionReasons.push("review_pending");
  } else {
    decisionReasons.push("human_approved");
  }

  const decision = reviewRequired ? "review_required" : "accept";
  const trusted = decision === "accept" && humanApproved;
  const visualReviewPassed = trusted ? true : null;

  return withoutUndefined({
    schemaVersion: "1.0",
    kind: "decision-record",
    decisionId: buildDecisionId(evidenceBundle),
    subjectPack: evidenceBundle.subjectPack,
    questionId: evidenceBundle.questionId,
    subQuestionId: evidenceBundle.subQuestionId,
    questionRef: evidenceBundle.questionRef,
    normalizedQuestionRef: evidenceBundle.normalizedQuestionRef,
    evidenceBundleRef: evidenceBundle.evidenceBundleId,
    trackResultRefs: trackResults.map((trackResult) => trackResult.trackResultId),
    decision,
    answer: trusted ? pickAnswer(trackResults) : "review required: visual evidence chain is not fully approved",
    trusted,
    visualReviewPassed,
    reviewRequired,
    reviewQueue: reviewRequired ? pickReviewQueue({
      evidenceMissing,
      highRiskVisual,
      ruleValidatorFailed,
      unsafeShortcutFail,
      groundingInsufficient
    }) : "none",
    risk: {
      level: highestRiskLevel([
        evidenceBundle.risk?.level,
        ...trackResults.map((trackResult) => trackResult.risk?.level)
      ]),
      categories: evidenceBundle.risk?.categories ?? []
    },
    decisionReasons: unique(decisionReasons),
    conflictRefs: unique(trackResults.flatMap((trackResult) => trackResult.conflictRefs ?? [])),
    feedbackRefs: [],
    statusProjection: {
      visualReviewPassed,
      trusted
    },
    generatedAt
  });
}

export function validateDecisionRecord(decisionRecord) {
  return validateValueAgainstSchema(decisionRecord, decisionRecordSchemaPath);
}

function hasMissingEvidence(evidenceBundle, trackResults) {
  return (evidenceBundle.figureRefs ?? []).length === 0
    || (evidenceBundle.cropRefs ?? []).length === 0
    || (evidenceBundle.evidenceRefs ?? []).length === 0
    || evidenceBundle.binding?.status !== "stable"
    || trackResults.some((trackResult) => (trackResult.missingEvidenceRefs ?? []).length > 0);
}

function hasDualTrackMatch(trackResults) {
  const counts = new Map();
  for (const candidate of answerCandidates(trackResults)) {
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 2);
}

function hasDualTrackConflict(trackResults) {
  return new Set(answerCandidates(trackResults)).size > 1 && !hasDualTrackMatch(trackResults);
}

function answerCandidates(trackResults) {
  return trackResults
    .filter((trackResult) => trackResult.trackType !== "rule_validator")
    .map((trackResult) => normalizeAnswer(trackResult.answerCandidate))
    .filter(Boolean);
}

function normalizeAnswer(answer) {
  const value = String(answer ?? "").trim().toLowerCase();
  if (value.length === 0 || value.startsWith("blocked:")) {
    return "";
  }
  return value.replace(/\s+/g, " ");
}

function hasLowConfidence(trackResults) {
  return trackResults.some((trackResult) => typeof trackResult.confidence === "number" && trackResult.confidence < 0.6);
}

function hasBlockingValidatorFinding(trackResults) {
  return trackResults.some((trackResult) =>
    (trackResult.validatorFindings ?? []).some((finding) => finding.severity === "blocking")
  );
}

function hasUnsafeShortcutFail(trackResults) {
  return trackResults.some((trackResult) => markerText(trackResult).some((value) =>
    value.includes("unsafe_shortcut_fail")
      || value.includes("unsafe-shortcut")
      || value.includes("unsafe shortcut")
  ));
}

function hasGroundingInsufficient(evidenceBundle, trackResults) {
  const values = [
    ...markerText(evidenceBundle),
    ...trackResults.flatMap(markerText)
  ];
  return values.some((value) =>
    value.includes("grounding_insufficient")
      || value.includes("grounding-insufficient")
      || value.includes("grounding insufficient")
      || value.includes("groundingsufficient=false")
      || value.includes("grounding sufficient=false")
  );
}

function hasAcceptanceTierUnverified(evidenceBundle, trackResults) {
  const tiers = [
    evidenceBundle.provenance?.acceptanceTier,
    evidenceBundle.provenance?.acceptance_tier,
    ...trackResults.map((trackResult) => trackResult.acceptanceTier ?? trackResult.acceptance_tier)
  ].filter(Boolean);
  return tiers.some((tier) => String(tier).trim() !== "workstation_accepted");
}

function hasStrictSchemaDowngraded(trackResults) {
  return trackResults.some((trackResult) => markerText(trackResult).some((value) =>
    value.includes("strict_schema_downgraded")
      || value.includes("strict schema downgraded")
  ));
}

function markerText(value) {
  const results = [];
  collectMarkerText(value, results);
  return results.map((entry) => entry.toLowerCase());
}

function collectMarkerText(value, results) {
  if (typeof value === "string") {
    results.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMarkerText(item, results);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectMarkerText(item, results);
    }
  }
}

function isHighRiskVisual(evidenceBundle, trackResults) {
  return isHighRiskLevel(evidenceBundle.risk?.level)
    || trackResults.some((trackResult) => isHighRiskLevel(trackResult.risk?.level));
}

function isHighRiskLevel(level) {
  return level === "high" || level === "critical";
}

function highestRiskLevel(levels) {
  const order = new Map([
    ["low", 0],
    ["medium", 1],
    ["high", 2],
    ["critical", 3]
  ]);
  let highest = "low";
  for (const level of levels) {
    if (order.has(level) && order.get(level) > order.get(highest)) {
      highest = level;
    }
  }
  return highest;
}

function pickReviewQueue(context) {
  if (context.highRiskVisual
    || context.ruleValidatorFailed
    || context.unsafeShortcutFail
    || context.groundingInsufficient) {
    return "high_risk_approval";
  }
  if (context.evidenceMissing) {
    return "truth_needs_review";
  }
  return "needs_human_label";
}

function pickAnswer(trackResults) {
  const candidate = trackResults
    .filter((trackResult) => trackResult.trackType !== "rule_validator")
    .map((trackResult) => String(trackResult.answerCandidate ?? "").trim())
    .find((answer) => answer.length > 0);
  return candidate ?? "";
}

function buildDecisionId(evidenceBundle) {
  const suffix = String(evidenceBundle.evidenceBundleId ?? evidenceBundle.questionRef ?? "visual-evidence")
    .replace(/^veb-/, "");
  return `decision-${suffix}`;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value).length > 0))];
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function parseArgs(argv) {
  const options = {
    evidenceBundlePath: "",
    trackResultPaths: [],
    generatedAt: "",
    humanApproved: false,
    outPath: "",
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence-bundle") {
      options.evidenceBundlePath = resolveRepoPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--track-result") {
      options.trackResultPaths.push(resolveRepoPath(requireValue(argv, ++index, arg)));
      continue;
    }
    if (arg === "--generated-at") {
      options.generatedAt = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--human-approved") {
      options.humanApproved = true;
      continue;
    }
    if (arg === "--out") {
      options.outPath = resolveRepoPath(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  if (options.evidenceBundlePath.length === 0) {
    throw new Error("--evidence-bundle is required.");
  }
  if (options.trackResultPaths.length === 0) {
    throw new Error("--track-result is required at least once.");
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (typeof value !== "string" || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function resolveRepoPath(value) {
  return path.resolve(repoRoot, value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const decisionRecord = compileDecisionRecord({
    evidenceBundle: readJson(options.evidenceBundlePath),
    trackResults: options.trackResultPaths.map(readJson),
    generatedAt: options.generatedAt || undefined,
    humanApproved: options.humanApproved
  });
  const validationErrors = validateDecisionRecord(decisionRecord);
  if (validationErrors.length > 0) {
    for (const error of validationErrors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const json = `${JSON.stringify(decisionRecord, null, 2)}\n`;
  if (options.outPath) {
    fs.writeFileSync(options.outPath, json);
  }
  if (!options.outPath || options.json) {
    process.stdout.write(json);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
