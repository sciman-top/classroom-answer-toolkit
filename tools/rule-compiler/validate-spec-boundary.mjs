import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonFile, resolveRepoPath } from "./shared.mjs";

export const forbiddenSpecTerms = [
  "ProblemEvidenceBundle",
  "TrackResult",
  "DecisionRecord",
  "NormalizedPage",
  "VisualRegion",
  "Track C",
  "轨道 A",
  "轨道 B"
];

const markdownOnlyMarker = "最终输出只能是完整答案 Markdown";

function listMarkdownFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
    })
    .sort();
}

export function validateSpecText(label, text) {
  return forbiddenSpecTerms
    .filter((term) => text.includes(term))
    .map((term) => `${label}: forbidden frozen spec term: ${term}`);
}

function relative(filePath) {
  return path.relative(resolveRepoPath("."), filePath).replace(/\\/gu, "/");
}

export function collectSpecBoundaryErrors() {
  const errors = [];
  const activeSourceRoots = [
    resolveRepoPath("prompts/specs/platform"),
    resolveRepoPath("prompts/specs/commons"),
    resolveRepoPath("prompts/specs/subjects")
  ];

  for (const filePath of activeSourceRoots.flatMap(listMarkdownFiles)) {
    errors.push(...validateSpecText(relative(filePath), fs.readFileSync(filePath, "utf8")));
  }

  const assemblyRoot = resolveRepoPath("prompts/specs/assemblies");
  const assemblyFiles = fs.readdirSync(assemblyRoot)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(assemblyRoot, name))
    .sort();

  for (const assemblyPath of assemblyFiles) {
    const assembly = readJsonFile(assemblyPath);
    const assemblyDir = path.dirname(assemblyPath);
    const manifestPath = resolveRepoPath(`prompts/${assembly.subjectPack}/manifest.json`);
    const configPath = resolveRepoPath(`prompts/${assembly.subjectPack}/config.json`);
    const manifest = readJsonFile(manifestPath);
    const config = readJsonFile(configPath);
    const fullOutputPath = path.resolve(assemblyDir, assembly.fullOutput);
    const manifestHumanSpecPath = path.resolve(path.dirname(manifestPath), manifest.sourceOfTruth.humanSpec);
    const configHumanSpecPath = path.resolve(path.dirname(configPath), config.sourceOfTruth.humanSpec);

    if (manifest.version !== assembly.outputVersion) {
      errors.push(`${assembly.subjectPack}: manifest version ${manifest.version} != assembly ${assembly.outputVersion}`);
    }
    if (config.version !== `${assembly.outputVersion}-derived`) {
      errors.push(`${assembly.subjectPack}: config version ${config.version} != ${assembly.outputVersion}-derived`);
    }
    for (const [label, actual] of [
      ["manifest humanSpec", manifestHumanSpecPath],
      ["config humanSpec", configHumanSpecPath]
    ]) {
      if (actual !== fullOutputPath) {
        errors.push(`${assembly.subjectPack}: ${label} does not point to assembly fullOutput`);
      }
    }

    for (const outputPath of [fullOutputPath]) {
      if (!fs.existsSync(outputPath)) {
        errors.push(`${assembly.subjectPack}: missing generated spec ${relative(outputPath)}`);
        continue;
      }
      const text = fs.readFileSync(outputPath, "utf8");
      errors.push(...validateSpecText(relative(outputPath), text));
      if (!text.includes(markdownOnlyMarker)) {
        errors.push(`${relative(outputPath)}: missing Markdown-only output contract`);
      }
    }
  }

  return errors;
}

export function assertSpecBoundary() {
  const errors = collectSpecBoundaryErrors();
  if (errors.length > 0) {
    throw new Error(`Spec boundary validation failed:\n${errors.join("\n")}`);
  }
  const assemblyCount = fs
    .readdirSync(resolveRepoPath("prompts/specs/assemblies"))
    .filter((name) => name.endsWith(".json")).length;
  return { assemblyCount, forbiddenTermCount: forbiddenSpecTerms.length };
}

function main() {
  const result = assertSpecBoundary();
  console.log(`Validated spec boundary for ${result.assemblyCount} assemblies; ${result.forbiddenTermCount} frozen terms are excluded.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  }
}
