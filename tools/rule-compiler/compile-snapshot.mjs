import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileResolvedSnapshot, writeResolvedSnapshot } from "./merge-rules.mjs";
import { getDefaultSubjectPackName, normalizeSubjectPackName, readJsonFile, resolveRepoPath } from "./shared.mjs";
import { parseArgvFlags } from "../shared.mjs";

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
  return parseArgvFlags(argv, {
    stringFlags: { profile: true, "subject-pack": true, out: true },
    defaults: { profile: null, subjectPack: defaultSubjectPack, out: null, help: false },
    help: true
  });
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
