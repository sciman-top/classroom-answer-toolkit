import fs from "node:fs";
import path from "node:path";
import { loadRenderProfile, DEFAULT_PROFILE_NAME, listBuiltInProfiles } from "./render-profiles.mjs";
import { loadRuntimeConfig } from "./runtime-config.mjs";

const usage = `Usage:
  npm --prefix tools/latex-renderer run validate:answer -- <answer.md> [--profile classroom|compact]

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
    profile: DEFAULT_PROFILE_NAME
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

function validateChoiceLine(line, lineNumber, errors) {
  const trimmed = line.trim();
  if (!/^\d+\s*[-—]\s*\d+\s*[:：]/u.test(trimmed)) {
    return;
  }

  if (/^\d+\s*-\s*\d+\s*[:：]/u.test(trimmed)) {
    errors.push(`第 ${lineNumber} 行：选择题答案范围应使用中文破折号“—”，不要使用半角连字符“-”。`);
  }

  const answerPart = trimmed.replace(/^\d+\s*[-—]\s*\d+\s*[:：]\s*/u, "");
  if (/[A-Z]\s+[A-Z]/.test(answerPart)) {
    errors.push(`第 ${lineNumber} 行：选择题答案应使用“、”分隔，例如“1—5：A、B、C、D、A”。`);
  }
}

function validateOrphanQuestionLead(lines, line, lineNumber, errors) {
  if (!/^\s*\d{1,3}[.．、]\s*$/u.test(line)) {
    return;
  }

  const next = nextNonEmptyLine(lines, lineNumber);
  if (next && /^\s*[（(][一二三四五六七八九十\d]+[）)]/u.test(next.line)) {
    errors.push(`第 ${lineNumber} 行：题号不得单独成行，必须与第一个小问同首行。`);
  }
}

function validateBacktickWrappedMath(line, lineNumber, errors) {
  if (/`[^`\n]*(\$|\\|Ω|℃|°|V|A|W|N|Pa|J|kg|cm|mm|kW|h)[^`\n]*`/u.test(line)) {
    errors.push(`第 ${lineNumber} 行：不要用反引号包裹公式或物理单位，这会阻止正常渲染。`);
  }
}

function validateUnbalancedDollarSigns(source, errors) {
  let count = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "$" && source[index - 1] !== "\\") {
      count += 1;
    }
  }

  if (count % 2 !== 0) {
    errors.push("全文存在未成对的 LaTeX 美元符号 `$`。");
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
      warnings.push(`第 ${index + 1} 行：普通说明行含 ${cjkCount} 个中文字符，超过当前 profile 建议上限 ${maxCjkPerLine}。`);
    }
  }
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`${usage}\nBuilt-in profiles: ${listBuiltInProfiles().join(", ")}`);
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

  const profile = loadRenderProfile(options.profile, callerCwd);
  const runtimeConfig = loadRuntimeConfig();
  const source = fs.readFileSync(inputPath, "utf8");
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  const errors = [];
  const warnings = [];

  validateUnbalancedDollarSigns(source, errors);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    validateChoiceLine(line, lineNumber, errors);
    validateOrphanQuestionLead(lines, line, lineNumber, errors);
    validateBacktickWrappedMath(line, lineNumber, errors);
  }

  validateLineLengths(
    lines,
    profile.answerRules.maxPlainTextCjkPerLine ?? runtimeConfig.profiles?.[profile.name]?.plainTextCjkMax ?? runtimeConfig.profiles?.classroom?.plainTextCjkMax ?? 24,
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
