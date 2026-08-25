import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { sha256Hex as sha256 } from "../shared.mjs";

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
    `- 盲答候选：\`${beforePath}\`\n` +
    `- 候选 SHA-256：\`${sha256(beforeBytes)}\`\n` +
    `- 校正答案：\`${afterPath}\`\n` +
    `- 校正 SHA-256：\`${sha256(afterBytes)}\`\n` +
    `- 结果：${changed ? "检测到文本变更" : "文本一致"}\n` +
    `- 新增行：${diff.added}\n` +
    `- 删除行：${diff.removed}\n\n` +
    `> 本报告记录盲答与参考答案复核稿之间的文本差异；答案语义正确性仍以权威参考答案和教师复核为准。\n\n` +
    `## Unified Diff\n\n\`\`\`diff\n${diff.lines.join("\n")}\n\`\`\`\n`;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3) {
    throw new Error("Usage: node answer-diff-report.mjs <blind.md> <corrected.md> <report.md>");
  }
  const [beforePath, afterPath, reportPath] = argv.map((value) => path.resolve(value));
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, buildDiffReport(beforePath, afterPath), "utf8");
  console.log(`Answer diff report: ${reportPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
