import fs from "node:fs";
import path from "node:path";
import { buildMergedAssets, compileResolvedSnapshot } from "./merge-rules.mjs";
import { listJsonFiles, readJsonFile, resolveRepoPath } from "./shared.mjs";
import { validateJsonFileAgainstSchema, validateValueAgainstSchema } from "./schema-validator.mjs";

function collectValidationTargets() {
  const manifestSchema = resolveRepoPath("prompts/shared/schemas/manifest.schema.json");
  const runtimeConfigSchema = resolveRepoPath("prompts/shared/schemas/runtime-config.schema.json");
  const rulePackSchema = resolveRepoPath("prompts/shared/schemas/rule-pack.schema.json");
  const profileSchema = resolveRepoPath("prompts/shared/schemas/profile.schema.json");
  const snapshotSchema = resolveRepoPath("prompts/shared/schemas/snapshot.schema.json");
  const deliveryManifestSchema = resolveRepoPath("prompts/shared/schemas/delivery-manifest.schema.json");
  const subjectPackDirectories = listSubjectPackDirectories();
  const figureSchemas = [
    resolveRepoPath("prompts/shared/schemas/problem-figure-asset.schema.json"),
    resolveRepoPath("prompts/shared/schemas/figure-understanding-result.schema.json"),
    resolveRepoPath("prompts/shared/schemas/answer-graphic-spec.schema.json"),
    resolveRepoPath("prompts/shared/schemas/answer-graphic-artifact.schema.json"),
    resolveRepoPath("prompts/shared/schemas/placed-answer-graphic.schema.json")
  ];

  return {
    manifests: [
      resolveRepoPath("prompts/platform-core/manifest.json"),
      ...subjectPackDirectories.map((directoryPath) => path.join(directoryPath, "manifest.json"))
    ].map((filePath) => ({ filePath, schemaPath: manifestSchema })),
    runtimeConfigs: subjectPackDirectories.map((directoryPath) => path.join(directoryPath, "config.json")).map((filePath) => ({ filePath, schemaPath: runtimeConfigSchema })),
    rulePacks: [
      ...listJsonFiles(resolveRepoPath("prompts/platform-core/rules")),
      ...subjectPackDirectories.flatMap((directoryPath) => listJsonFiles(path.join(directoryPath, "rules")))
    ].map((filePath) => ({ filePath, schemaPath: rulePackSchema })),
    profiles: [
      ...listJsonFiles(resolveRepoPath("prompts/platform-core/profiles")),
      ...subjectPackDirectories.flatMap((directoryPath) => listJsonFiles(path.join(directoryPath, "profiles")))
    ].map((filePath) => ({ filePath, schemaPath: profileSchema })),
    subjectPacks: subjectPackDirectories.map((directoryPath) => path.basename(directoryPath)),
    schemaFiles: [
      manifestSchema,
      runtimeConfigSchema,
      rulePackSchema,
      profileSchema,
      snapshotSchema,
      deliveryManifestSchema,
      ...figureSchemas
    ],
    snapshotSchema,
    deliveryManifestSchema,
    figureSchemas
  };
}

function listSubjectPackDirectories() {
  const promptsRoot = resolveRepoPath("prompts");
  return fs
    .readdirSync(promptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(promptsRoot, entry.name))
    .filter((directoryPath) => fs.existsSync(path.join(directoryPath, "manifest.json")) && fs.existsSync(path.join(directoryPath, "config.json")));
}

function validateFiles(targets) {
  const errors = [];
  let validatedFileCount = 0;

  for (const group of [targets.manifests, targets.runtimeConfigs, targets.rulePacks, targets.profiles]) {
    for (const target of group) {
      const fileErrors = validateJsonFileAgainstSchema(target.filePath, target.schemaPath);
      validatedFileCount += 1;
      for (const error of fileErrors) {
        errors.push(`${path.relative(resolveRepoPath("."), target.filePath)}: ${error}`);
      }
    }
  }

  return { errors, validatedFileCount };
}

function validateSchemaFiles(schemaFiles) {
  const errors = [];

  for (const schemaPath of schemaFiles) {
    errors.push(...validateSchemaFile(schemaPath));
  }

  return errors;
}

function validateSnapshot(snapshotSchema) {
  return validateSnapshots(snapshotSchema, ["physics-answer"]);
}

function validateSnapshots(snapshotSchema, subjectPacks) {
  return subjectPacks.map((subjectPack) => {
    const snapshot = compileResolvedSnapshot({ subjectPack });
    const errors = validateValueAgainstSchema(snapshot, snapshotSchema);
    return { subjectPack, snapshot, errors };
  });
}

function validateSchemaFile(schemaPath) {
  const schema = readJsonFile(schemaPath);
  const errors = [];

  if (schema.type !== "object") {
    errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: schema root should declare object type.`);
  }

  if (!Array.isArray(schema.required) || schema.required.length === 0) {
    errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: schema should define required fields.`);
  }

  return errors;
}

function compareVersion(a, b) {
  const pa = a.split(".").map((value) => Number(value));
  const pb = b.split(".").map((value) => Number(value));
  const length = Math.max(pa.length, pb.length);
  for (let index = 0; index < length; index += 1) {
    const left = pa[index] ?? 0;
    const right = pb[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }
  return 0;
}

function findLatestProductionSpecVersion() {
  const repoRoot = resolveRepoPath(".");
  const fileNames = fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^初中物理试卷参考答案生成与渲染交付提示词_v\d+\.\d+_生产完整版\.md$/u.test(entry.name))
    .map((entry) => entry.name);

  const versions = fileNames
    .map((name) => {
      const match = name.match(/_v(\d+\.\d+)_/u);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .sort(compareVersion);

  return versions.at(-1) ?? null;
}

function validateLatestSpecAlignment(manifest, config) {
  const latestVersion = findLatestProductionSpecVersion();
  const errors = [];

  if (!latestVersion) {
    return errors;
  }

  const expectedSpecPath = `../../初中物理试卷参考答案生成与渲染交付提示词_v${latestVersion}_生产完整版.md`;

  if (manifest.version !== `v${latestVersion}`) {
    errors.push(`Manifest version ${manifest.version} does not match latest production spec v${latestVersion}.`);
  }

  if (manifest.sourceOfTruth?.humanSpec !== expectedSpecPath) {
    errors.push(`Manifest humanSpec ${manifest.sourceOfTruth?.humanSpec ?? "(missing)"} does not point to latest production spec ${expectedSpecPath}.`);
  }

  if (config.sourceOfTruth?.humanSpec !== expectedSpecPath) {
    errors.push(`Runtime config humanSpec ${config.sourceOfTruth?.humanSpec ?? "(missing)"} does not point to latest production spec ${expectedSpecPath}.`);
  }

  return errors;
}

function main() {
  const targets = collectValidationTargets();
  const fileValidation = validateFiles(targets);
  const mergedAssets = buildMergedAssets({ subjectPack: "physics-answer" });
  const snapshotValidations = validateSnapshots(targets.snapshotSchema, targets.subjectPacks);
  const specAlignmentErrors = validateLatestSpecAlignment(mergedAssets.manifest.subject, mergedAssets.config);
  const schemaFileErrors = validateSchemaFiles(targets.schemaFiles);

  const errors = [
    ...fileValidation.errors,
    ...snapshotValidations.flatMap((validation) =>
      validation.errors.map((error) => `ResolvedSnapshot(${validation.subjectPack}): ${error}`)
    ),
    ...specAlignmentErrors,
    ...schemaFileErrors
  ];

  if (!mergedAssets.rules.length) {
    errors.push("Merged assets produced zero rules.");
  }

  if (!Object.keys(mergedAssets.profiles).length) {
    errors.push("Merged assets produced zero profiles.");
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log(
    `Validated ${fileValidation.validatedFileCount} asset files, ${mergedAssets.rules.length} merged rules, ${Object.keys(mergedAssets.profiles).length} merged profiles, and ${snapshotValidations.length} snapshots (${snapshotValidations.map((validation) => `${validation.subjectPack}:${validation.snapshot.snapshotId}`).join(", ")}).`
  );
}

main();
