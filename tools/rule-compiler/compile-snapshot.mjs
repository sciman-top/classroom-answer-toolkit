import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileResolvedSnapshot, writeResolvedSnapshot } from "./merge-rules.mjs";
import { getDefaultSubjectPackName, normalizeSubjectPackName, readJsonFile, resolveRepoPath } from "./shared.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const defaultSubjectPack = getDefaultSubjectPackName();
const defaultOutputRelativePath = ".snapshot-cache/resolved-snapshot.json";

const usage = `Usage:
  npm --prefix tools/rule-compiler run compile:snapshot -- [--subject-pack junior-physics-answer|senior-physics-answer|math-answer|physics-answer(alias)] [--profile classroom|compact] [--out <snapshot.json>]
`;

export function resolveDefaultOutputRelativePath(subjectPack = defaultSubjectPack) {
  const canonicalSubjectPack = normalizeSubjectPackName(subjectPack, defaultSubjectPack);
  const configPath = resolveRepoPath(`prompts/${canonicalSubjectPack}/config.json`);
  if (!fs.existsSync(configPath)) {
    return defaultOutputRelativePath;
  }

  const config = readJsonFile(configPath);
  const configuredPath = config.snapshot?.cachePath;
  if (typeof configuredPath !== "string" || configuredPath.trim().length === 0) {
    return defaultOutputRelativePath;
  }

  const absoluteOutputPath = path.resolve(path.dirname(configPath), configuredPath);
  return path.relative(repoRoot, absoluteOutputPath).replace(/\\/g, "/");
}

export function parseArgs(argv) {
  const options = {
    profile: null,
    subjectPack: defaultSubjectPack,
    out: null,
    help: false
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
    if (arg === "--subject-pack") {
      options.subjectPack = argv[++index];
      continue;
    }
    if (arg.startsWith("--subject-pack=")) {
      options.subjectPack = arg.slice("--subject-pack=".length);
      continue;
    }
    if (arg === "--out") {
      options.out = argv[++index];
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
  }

  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  options.subjectPack = normalizeSubjectPackName(options.subjectPack, defaultSubjectPack);
  if (options.help) {
    console.log(usage);
    return null;
  }

  const outputRelativePath = options.out ?? resolveDefaultOutputRelativePath(options.subjectPack);
  const snapshot = compileResolvedSnapshot({
    profileName: options.profile,
    subjectPack: options.subjectPack
  });
  const outputPath = writeResolvedSnapshot(snapshot, outputRelativePath);
  console.log(outputPath);
  return outputPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
