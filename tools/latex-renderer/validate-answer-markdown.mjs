import fs from "node:fs";
import path from "node:path";
import { getDefaultSubjectPack, getSnapshotActiveProfile, loadRequiredResolvedSnapshot, resolveSnapshotPath } from "./runtime-config.mjs";

const usage = `Usage:
  npm --prefix tools/latex-renderer run validate:answer -- <answer.md> [--profile classroom|compact] [--snapshot <snapshot.json>]

Checks:
  - choice-answer line format
  - orphan question-number first lines
  - backtick-wrapped math or units
  - unbalanced LaTeX dollar signs
  - overly long plain-text lines (warning)
`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    profile: null,
    snapshot: null,
    subjectPack: getDefaultSubjectPack()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--profile") {
      options.profile = argv[++index];
      continue;
    }

    if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
      continue;
    }

    if (arg === "--snapshot") {
      options.snapshot = argv[++index];
      continue;
    }

    if (arg.startsWith("--snapshot=")) {
      options.snapshot = arg.slice("--snapshot=".length);
      continue;
    }

    if (arg === "--subject-pack") {
      options.subjectPack = argv[++index];
      continue;
    }

    if (arg.startsWith("--subject-pack=")) {
      options.subjectPack = arg.slice("--subject-pack=".length);
      continue;
    }

    positional.push(arg);
  }

  return { positional, options };
}

function countCjkCharacters(text) {
  return (text.match(/[\u3400-\u9fff]/g) || []).length;
}

function isPlainTextLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("```") ||
    trimmed.startsWith("$$") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("- ") ||
    trimmed.startsWith("* ") ||
    trimmed.startsWith("|") ||
    trimmed.startsWith("![](") ||
    trimmed.startsWith("![")
  ) {
    return false;
  }

  if (trimmed.includes("$$")) {
    return false;
  }

  return !/[=\\]/.test(trimmed);
}

function nextNonEmptyLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].trim()) {
      return { index, line: lines[index] };
    }
  }
  return null;
}

function findEnabledRule(snapshot, ruleIds) {
  const rules = Array.isArray(snapshot?.rules) ? snapshot.rules : [];
  for (const ruleId of ruleIds) {
    const rule = rules.find((candidate) => candidate?.id === ruleId);
    if (rule && rule.enabled !== false) {
      return rule;
    }
  }

  return null;
}

function resolveValidationRules(snapshot) {
  const subjectPackId = snapshot?.subjectPack?.assetId;
  const choiceRuleIds = typeof subjectPackId === "string" && subjectPackId.trim().length > 0
    ? [`${subjectPackId}.choice-answer.compact-line`]
    : [];
  const questionRuleIds = typeof subjectPackId === "string" && subjectPackId.trim().length > 0
    ? [`${subjectPackId}.question-lead.same-line`]
    : [];
  const mathRuleIds = typeof subjectPackId === "string" && subjectPackId.trim().length > 0
    ? ["rendering.true-latex", `${subjectPackId}.math.true-latex`]
    : ["rendering.true-latex"];

  return {
    choiceAnswer: findEnabledRule(snapshot, choiceRuleIds),
    questionLead: findEnabledRule(snapshot, questionRuleIds),
    trueLatex: findEnabledRule(snapshot, mathRuleIds)
  };
}

function addRuleFinding(rule, message, errors, warnings) {
  if (rule?.severity === "hard") {
    errors.push(message);
    return;
  }

  warnings.push(message);
}

function validateChoiceLine(line, lineNumber, rule, errors, warnings) {
  const trimmed = line.trim();
  if (!/^\d+\s*[-\u2013\u2014]\s*\d+\s*[:\uff1a]/u.test(trimmed)) {
    return;
  }

  if (/^\d+\s*-\s*\d+\s*[:\uff1a]/u.test(trimmed)) {
    addRuleFinding(rule, `Line ${lineNumber}: choice answer ranges must use a Chinese dash, not an ASCII hyphen.`, errors, warnings);
  }

  const answerPart = trimmed.replace(/^\d+\s*[-\u2013\u2014]\s*\d+\s*[:\uff1a]\s*/u, "");
  if (/[A-Z]\s+[A-Z]/.test(answerPart)) {
    addRuleFinding(rule, `Line ${lineNumber}: choice answers should use separators, not spaces between options.`, errors, warnings);
  }
}

function validateOrphanQuestionLead(lines, line, lineNumber, rule, errors, warnings) {
  if (!/^\s*\d{1,3}[.\uff0e\u3001]?\s*$/u.test(line)) {
    return;
  }

  const next = nextNonEmptyLine(lines, lineNumber);
  if (next && /^\s*[\uff08(][\u4e00-\u9fff\d]+[\uff09)]/u.test(next.line)) {
    addRuleFinding(rule, `Line ${lineNumber}: question number must stay on the same first line as the first sub-question.`, errors, warnings);
  }
}

function validateBacktickWrappedMath(line, lineNumber, rule, errors, warnings) {
  if (/`[^`\n]*(\$|\\|Ω|\u03a9|\u2103|°|V|A|W|N|Pa|J|kg|cm|mm|kW|h)[^`\n]*`/u.test(line)) {
    addRuleFinding(rule, `Line ${lineNumber}: do not wrap formulas or physical units in backticks.`, errors, warnings);
  }
}

function validateUnbalancedDollarSigns(source, rule, errors, warnings) {
  let count = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "$" && source[index - 1] !== "\\") {
      count += 1;
    }
  }

  if (count % 2 !== 0) {
    addRuleFinding(rule, "Document has unbalanced LaTeX dollar signs.", errors, warnings);
  }
}

function validateLineLengths(lines, maxCjkPerLine, warnings) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isPlainTextLine(line)) {
      continue;
    }

    const cjkCount = countCjkCharacters(line);
    if (cjkCount > maxCjkPerLine) {
      warnings.push(`Line ${index + 1}: plain-text line has ${cjkCount} CJK characters, exceeding current profile limit ${maxCjkPerLine}.`);
    }
  }
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    process.exit(0);
  }

  if (!positional[0]) {
    fail(usage);
  }

  const callerCwd = process.env.INIT_CWD || process.cwd();
  const inputPath = path.resolve(callerCwd, positional[0]);
  if (!fs.existsSync(inputPath)) {
    fail(`Answer Markdown not found: ${inputPath}`);
  }

  const snapshotPath = resolveSnapshotPath(options.snapshot, {
    subjectPack: options.subjectPack,
    callerCwd
  });
  const snapshot = loadRequiredResolvedSnapshot(snapshotPath);
  const profile = getSnapshotActiveProfile(snapshot, options.profile);
  const source = fs.readFileSync(inputPath, "utf8");
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  const errors = [];
  const warnings = [];
  const rules = resolveValidationRules(snapshot);

  if (rules.trueLatex) {
    validateUnbalancedDollarSigns(source, rules.trueLatex, errors, warnings);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (rules.choiceAnswer) {
      validateChoiceLine(line, lineNumber, rules.choiceAnswer, errors, warnings);
    }
    if (rules.questionLead) {
      validateOrphanQuestionLead(lines, line, lineNumber, rules.questionLead, errors, warnings);
    }
    if (rules.trueLatex) {
      validateBacktickWrappedMath(line, lineNumber, rules.trueLatex, errors, warnings);
    }
  }

  validateLineLengths(
    lines,
    profile.answerRules?.maxPlainTextCjkPerLine
      ?? profile.layout?.plainTextCjkMax
      ?? snapshot.profiles?.[profile.name]?.answerRules?.maxPlainTextCjkPerLine
      ?? snapshot.profiles?.[profile.name]?.layout?.plainTextCjkMax
      ?? 24,
    warnings
  );

  if (warnings.length > 0) {
    console.warn(`Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.error(`Errors (${errors.length}):`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Validation passed for ${path.basename(inputPath)} with profile "${profile.name}".`);
}

main();
