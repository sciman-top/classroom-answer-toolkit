import fs from "node:fs";
import path from "node:path";
import { compileResolvedSnapshot, writeResolvedSnapshot } from "./merge-rules.mjs";
import { getDefaultSubjectPackName, normalizeSubjectPackName, readJsonFile, resolveRepoPath } from "./shared.mjs";
import { isDirectInvocation, parseArgvFlags, repositoryRoot as repoRoot } from "../shared.mjs";

const defaultSubjectPack = getDefaultSubjectPackName();
const defaultOutputRelativePath = ".snapshot-cache/resolved-snapshot.json";

const usage = `Usage:
  npm --prefix tools/rule-compiler run compile:snapshot -- [--subject-pack junior-physics-answer|senior-physics-answer|math-answer|physics-answer(alias)] [--profile classroom|compact] [--out <snapshot.json>]
`;

export function resolveDefaultOutputRelativePath(subjectPack = defaultSubjectPack, repositoryRoot = repoRoot) {
  const canonicalSubjectPack = normalizeSubjectPackName(subjectPack, defaultSubjectPack);
  const configPath = path.resolve(repositoryRoot, `prompts/${canonicalSubjectPack}/config.json`);
  if (!fs.existsSync(configPath)) {
    return defaultOutputRelativePath;
  }

  const config = readJsonFile(configPath);
  const configuredPath = config.snapshot?.cachePath;
  if (typeof configuredPath !== "string" || configuredPath.trim().length === 0) {
    return defaultOutputRelativePath;
  }

  const absoluteOutputPath = path.resolve(path.dirname(configPath), configuredPath);
  return path.relative(repositoryRoot, assertRepositoryContainedPath(absoluteOutputPath, repositoryRoot)).replace(/\\/g, "/");
}

export function assertRepositoryContainedPath(candidatePath, repositoryRoot = repoRoot) {
  const root = path.resolve(repositoryRoot);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    return candidate;
  }
  throw new Error(`Snapshot output must remain inside the repository: ${candidate}`);
}

export function parseArgs(argv) {
  return parseArgvFlags(argv, {
    stringFlags: { profile: true, "subject-pack": true, out: true },
    defaults: { profile: null, subjectPack: defaultSubjectPack, out: null, help: false },
    // A typo like --subjectpack must fail loudly, not silently flip to the
    // default subject pack and overwrite its snapshot (matches validate-json).
    unknownFlag: "error",
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

  const outputRelativePath = assertRepositoryContainedPath(
    path.resolve(repoRoot, options.out ?? resolveDefaultOutputRelativePath(options.subjectPack))
  );
  const snapshot = compileResolvedSnapshot({
    profileName: options.profile,
    subjectPack: options.subjectPack
  });
  const writtenPath = writeResolvedSnapshot(snapshot, outputRelativePath);
  console.log(writtenPath);
  return writtenPath;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
