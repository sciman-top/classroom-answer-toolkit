import fs from "node:fs";
import path from "node:path";

import { checkAssemblyOutputs } from "../spec-assembler/assemble-human-spec.mjs";
import { compileResolvedSnapshot } from "./merge-rules.mjs";
import {
  listJsonFiles,
  readJsonFile,
  resolveRepoPath
} from "./shared.mjs";
import { validateJsonFileAgainstSchema, validateValueAgainstSchema } from "./schema-validator.mjs";

const schemaRoot = resolveRepoPath("prompts/shared/schemas");
const promptRoot = resolveRepoPath("prompts");

function assertValid(filePath, schemaName) {
  const errors = validateJsonFileAgainstSchema(
    filePath,
    path.join(schemaRoot, schemaName)
  );
  if (errors.length > 0) {
    throw new Error(`${path.relative(resolveRepoPath("."), filePath)}:\n${errors.join("\n")}`);
  }
}

function subjectPackNames() {
  return fs.readdirSync(promptRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(promptRoot, name, "manifest.json")))
    .filter((name) => readJsonFile(path.join(promptRoot, name, "manifest.json")).kind === "subject-pack")
    .sort();
}

function validateSchemas() {
  const schemaFiles = listJsonFiles(schemaRoot);
  for (const schemaFile of schemaFiles) {
    const schema = readJsonFile(schemaFile);
    if (!schema.$schema || !schema.$id || typeof schema.type !== "string") {
      throw new Error(`Schema metadata is incomplete: ${path.relative(resolveRepoPath("."), schemaFile)}`);
    }
  }
  return schemaFiles.length;
}

function validateSubjectPack(subjectPack) {
  const root = path.join(promptRoot, subjectPack);
  assertValid(path.join(root, "manifest.json"), "manifest.schema.json");
  assertValid(path.join(root, "config.json"), "runtime-config.schema.json");

  for (const filePath of listJsonFiles(path.join(root, "rules"))) {
    assertValid(filePath, "rule-pack.schema.json");
  }
  for (const filePath of listJsonFiles(path.join(root, "profiles"))) {
    assertValid(filePath, "profile.schema.json");
  }
  for (const filePath of listJsonFiles(path.join(root, "overrides"))) {
    assertValid(filePath, "override.schema.json");
  }

  const snapshot = compileResolvedSnapshot({ subjectPack, profileName: "classroom" });
  const snapshotErrors = validateValueAgainstSchema(
    snapshot,
    path.join(schemaRoot, "snapshot.schema.json")
  );
  if (snapshotErrors.length > 0) {
    throw new Error(`${subjectPack} snapshot:\n${snapshotErrors.join("\n")}`);
  }
}

function validateRendererContracts() {
  const root = resolveRepoPath("eval/renderer-contract/cases");
  const schema = path.join(schemaRoot, "renderer-contract.schema.json");
  for (const filePath of listJsonFiles(root)) {
    assertValid(filePath, path.basename(schema));
  }
}

function main() {
  const assemblyErrors = listJsonFiles(resolveRepoPath("prompts/specs/assemblies"))
    .flatMap((assemblyPath) => checkAssemblyOutputs(assemblyPath));
  if (assemblyErrors.length > 0) {
    throw new Error(`Compiled prompt drift:\n${assemblyErrors.join("\n")}`);
  }

  const schemaCount = validateSchemas();
  const subjects = subjectPackNames();
  for (const subject of subjects) {
    validateSubjectPack(subject);
  }
  validateRendererContracts();

  console.log(`Validated ${schemaCount} core schemas, ${subjects.length} subject packs, compiled prompt assemblies, snapshots, and renderer contracts.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
}
