import fs from "node:fs";
import path from "node:path";

import { isDirectInvocation, parseArgvFlags, sha256Hex as sha256 } from "../shared.mjs";
import { writeTextFileAtomic } from "../atomic-write.mjs";
import { parseSemanticChoiceFindings } from "./answer-tasks.mjs";

function normalize(value) {
  return String(value).replace(/\r\n?/g, "\n").trimEnd();
}

export function lineDiff(before, after) {
  const left = normalize(before).split("\n");
  const right = normalize(after).split("\n");
  const rows = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      rows[i][j] = left[i] === right[j]
        ? rows[i + 1][j + 1] + 1
        : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const output = [];
  let removed = 0;
  let added = 0;
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      output.push(left[i].length > 0 ? ` ${left[i]}` : "");
      i += 1;
      j += 1;
    } else if (j < right.length && (i === left.length || rows[i][j + 1] >= rows[i + 1][j])) {
      output.push(`+${right[j]}`);
      added += 1;
      j += 1;
    } else {
      output.push(`-${left[i]}`);
      removed += 1;
      i += 1;
    }
  }
  return { lines: output, added, removed };
}

export function buildDiffReport(beforePath, afterPath) {
  const beforeBytes = fs.readFileSync(beforePath);
  const afterBytes = fs.readFileSync(afterPath);
  const before = normalize(beforeBytes.toString("utf8"));
  const after = normalize(afterBytes.toString("utf8"));
  const diff = lineDiff(before, after);
  const changed = before !== after;
  return `# 答案自动复核文本差异报告\n\n` +
    `- 候选：\`${beforePath}\`\n` +
    `- 候选 SHA-256：\`${sha256(beforeBytes)}\`\n` +
    `- 校正答案：\`${afterPath}\`\n` +
    `- 校正 SHA-256：\`${sha256(afterBytes)}\`\n` +
    `- 结果：${changed ? "检测到文本变更" : "文本一致"}\n` +
    `- 新增行：${diff.added}\n` +
    `- 删除行：${diff.removed}\n\n` +
    `> 本报告记录相邻 AI 阶段的文本差异；答案语义正确性仍以题号证据、权威参考答案和教师复核为准。\n\n` +
    `## Unified Diff\n\n\`\`\`diff\n${diff.lines.join("\n")}\n\`\`\`\n`;
}

// The lookahead after the separator rejects decimal values such as "0.5" or
// "10.5 m" that start a line, which otherwise register as phantom questions.
function questionNumbers(markdown) {
  const numbers = new Set();
  const pattern = /^\s*(?:#{1,3}\s*)?(?:第\s*)?(\d{1,3})\s*(?:题|[.．、])(?!\d)/gmu;
  for (const match of String(markdown ?? "").matchAll(pattern)) {
    numbers.add(Number(match[1]));
  }
  return [...numbers].sort((left, right) => left - right);
}

function questionBlocks(markdown) {
  const source = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const markers = [...source.matchAll(/^\s*(?:#{1,3}\s*)?(?:第\s*)?(\d{1,3})\s*(?:题|[.．、])(?!\d)/gmu)];
  const blocks = new Map();
  for (const [index, marker] of markers.entries()) {
    const end = markers[index + 1]?.index ?? source.length;
    const number = Number(marker[1]);
    const body = source.slice(marker.index, end).trim();
    blocks.set(number, blocks.has(number) ? `${blocks.get(number)}\n${body}` : body);
  }
  return blocks;
}

function unresolvedQuestionNumbers(afterMarkdown) {
  const unresolved = new Set();
  for (const match of String(afterMarkdown ?? "").matchAll(
    /第\s*(\d{1,3})\s*题[^\n]*(?:待人工复核|待复核|【疑|视觉证据不足|语义证据不足)/gmu
  )) {
    unresolved.add(Number(match[1]));
  }
  return [...unresolved].sort((left, right) => left - right);
}

function readOptional(filePath) {
  return typeof filePath === "string" && filePath.length > 0 && fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : "";
}

export function buildQuestionEvidence({
  beforePath,
  afterPath,
  semanticFindingsPath = null,
  visualFindingsPath = null,
  referenceEvidencePath = null,
  semanticEvidencePath = null
}) {
  const before = questionBlocks(readOptional(beforePath));
  const after = questionBlocks(readOptional(afterPath));
  const covered = [...new Set([
    ...questionNumbers(readOptional(afterPath)),
    ...questionNumbers(readOptional(beforePath))
  ])].sort((left, right) => left - right);
  const correctedQuestions = covered.filter((number) =>
    before.has(number) && after.has(number) && before.get(number) !== after.get(number)
  );
  const missingQuestions = covered.filter((number) => !after.has(number));
  const semanticText = readOptional(semanticFindingsPath);
  const semantic = parseSemanticChoiceFindings(semanticText);
  // Evidence files are written flat (no "review" wrapper); the prior stage's
  // rolling evidence carries its confirmed/unresolved sets into this stage.
  const priorEvidence = semanticEvidencePath && fs.existsSync(semanticEvidencePath)
    ? JSON.parse(fs.readFileSync(semanticEvidencePath, "utf8"))
    : null;
  const priorConfirmed = Array.isArray(priorEvidence?.confirmedCorrections)
    ? priorEvidence.confirmedCorrections
    : [];
  const priorUnresolved = Array.isArray(priorEvidence?.unresolvedQuestions)
    ? priorEvidence.unresolvedQuestions
    : [];
  const visualText = readOptional(visualFindingsPath);
  const unresolved = new Set(unresolvedQuestionNumbers(readOptional(afterPath)));

  for (const match of semanticText.matchAll(/###\s*第\s*(\d+)\s*题([\s\S]*?)(?=\n###\s*第|\n---|$)/gu)) {
    if (/【语义证据不足|需复核/.test(match[2]) && !semantic.has(Number(match[1]))) {
      unresolved.add(Number(match[1]));
    }
  }
  for (const match of visualText.matchAll(/第\s*(\d+)\s*题([\s\S]*?)(?=\n第\s*\d+\s*题|\n---|$)/gu)) {
    if (/【视觉证据不足|需复核/.test(match[2])) {
      unresolved.add(Number(match[1]));
    }
  }
  for (const number of missingQuestions) {
    unresolved.add(number);
  }
  // Prior unresolved questions stay carried until a reference review runs; the
  // authoritative reference supersedes them at that stage.
  if (!referenceEvidencePath) {
    for (const number of priorUnresolved) {
      unresolved.add(Number(number));
    }
  }

  return {
    schemaVersion: "1.0",
    kind: "answer-review-evidence",
    coveredQuestions: covered,
    confirmedCorrections: [...new Set([...priorConfirmed, ...semantic.keys()])]
      .sort((left, right) => left - right),
    directCorrections: correctedQuestions.filter((number) => visualFindingsPath || referenceEvidencePath),
    unresolvedQuestions: [...unresolved].sort((left, right) => left - right),
    missingQuestions,
    diff: lineDiff(readOptional(beforePath), readOptional(afterPath))
  };
}

export function main(argv = process.argv.slice(2)) {
  const { positional, options } = parseArgvFlags(argv, {
    stringFlags: {
      "semantic-findings": "semanticFindingsPath",
      "semantic-evidence": "semanticEvidencePath",
      "visual-findings": "visualFindingsPath",
      "reference-evidence": "referenceEvidencePath",
      "evidence-out": "evidenceOutputPath"
    },
    defaults: {
      semanticFindingsPath: null,
      semanticEvidencePath: null,
      visualFindingsPath: null,
      referenceEvidencePath: null,
      evidenceOutputPath: null
    },
    unknownFlag: "error",
    positional: true
  });
  if (positional.length !== 3) {
    throw new Error("Usage: node answer-diff-report.mjs <blind.md> <corrected.md> <report.md> [--semantic-findings <file>] [--visual-findings <file>] [--evidence-out <file>]");
  }
  const [beforePath, afterPath, reportPath] = positional.map((value) =>
    path.resolve(process.env.INIT_CWD || process.cwd(), value)
  );
  // Reports and evidence are persisted before the coverage gate on purpose: a
  // missing question fails the run, but the paid diff evidence must survive
  // for diagnostics instead of being discarded with the failure.
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  writeTextFileAtomic(reportPath, buildDiffReport(beforePath, afterPath));
  if (options.evidenceOutputPath) {
    const resolveOptionPath = (value) => value ? path.resolve(process.env.INIT_CWD || process.cwd(), value) : null;
    const evidence = buildQuestionEvidence({
      beforePath,
      afterPath,
      semanticFindingsPath: resolveOptionPath(options.semanticFindingsPath),
      visualFindingsPath: resolveOptionPath(options.visualFindingsPath),
      referenceEvidencePath: resolveOptionPath(options.referenceEvidencePath),
      semanticEvidencePath: resolveOptionPath(options.semanticEvidencePath)
    });
    const outputPath = resolveOptionPath(options.evidenceOutputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    writeTextFileAtomic(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  const missing = questionCoverageGaps(beforePath, afterPath);
  if (missing.length > 0) {
    throw new Error(`Corrected answer is missing question numbers: ${missing.join(", ")}`);
  }
  console.log(`Answer diff report: ${reportPath}`);
}

export function questionCoverageGaps(beforePath, afterPath) {
  const before = questionNumbers(readOptional(beforePath));
  const after = new Set(questionNumbers(readOptional(afterPath)));
  return before.filter((number) => !after.has(number));
}

if (isDirectInvocation(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
