import fs from "node:fs";
import path from "node:path";
import { buildMergedAssets, compileResolvedSnapshot } from "./merge-rules.mjs";
import { listJsonFiles, readJsonFile, resolveRepoPath } from "./shared.mjs";
import { validateJsonFileAgainstSchema, validateValueAgainstSchema } from "./schema-validator.mjs";
import { checkAssemblyOutputs } from "../spec-assembler/assemble-human-spec.mjs";

function collectValidationTargets() {
  const dataClassificationSchema = resolveRepoPath("prompts/shared/schemas/data-classification.schema.json");
  const manifestSchema = resolveRepoPath("prompts/shared/schemas/manifest.schema.json");
  const runtimeConfigSchema = resolveRepoPath("prompts/shared/schemas/runtime-config.schema.json");
  const rulePackSchema = resolveRepoPath("prompts/shared/schemas/rule-pack.schema.json");
  const profileSchema = resolveRepoPath("prompts/shared/schemas/profile.schema.json");
  const snapshotSchema = resolveRepoPath("prompts/shared/schemas/snapshot.schema.json");
  const deliveryManifestSchema = resolveRepoPath("prompts/shared/schemas/delivery-manifest.schema.json");
  const reviewStateMachineSchema = resolveRepoPath("prompts/shared/schemas/review-state-machine.schema.json");
  const feedbackRecordSchema = resolveRepoPath("prompts/shared/schemas/feedback-record.schema.json");
  const samplePackageSchema = resolveRepoPath("prompts/shared/schemas/sample-package.schema.json");
  const sampleIndexSchema = resolveRepoPath("prompts/shared/schemas/sample-index.schema.json");
  const negativeCandidateSchema = resolveRepoPath("prompts/shared/schemas/negative-candidate.schema.json");
  const sampleRunRecordSchema = resolveRepoPath("prompts/shared/schemas/sample-run-record.schema.json");
  const subjectPackDirectories = listSubjectPackDirectories();
  const sampleRoot = resolveRepoPath("样例交付");
  const figureSchemas = [
    resolveRepoPath("prompts/shared/schemas/problem-figure-asset.schema.json"),
    resolveRepoPath("prompts/shared/schemas/figure-understanding-result.schema.json"),
    resolveRepoPath("prompts/shared/schemas/answer-graphic-spec.schema.json"),
    resolveRepoPath("prompts/shared/schemas/answer-graphic-artifact.schema.json"),
    resolveRepoPath("prompts/shared/schemas/placed-answer-graphic.schema.json")
  ];
  const samplePackageFiles = listFilesByNameRecursive(path.join(sampleRoot, "structured"), "sample.json")
    .map((filePath) => ({ filePath, schemaPath: samplePackageSchema }));
  const sampleIndexFiles = fs.existsSync(path.join(sampleRoot, "index.json"))
    ? [{ filePath: path.join(sampleRoot, "index.json"), schemaPath: sampleIndexSchema }]
    : [];

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
    samplePackages: samplePackageFiles,
    sampleIndices: sampleIndexFiles,
    subjectPacks: subjectPackDirectories.map((directoryPath) => path.basename(directoryPath)),
    schemaFiles: [
      dataClassificationSchema,
      manifestSchema,
      runtimeConfigSchema,
      rulePackSchema,
      profileSchema,
      snapshotSchema,
      deliveryManifestSchema,
      reviewStateMachineSchema,
      feedbackRecordSchema,
      samplePackageSchema,
      sampleIndexSchema,
      negativeCandidateSchema,
      sampleRunRecordSchema,
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

function listFilesByNameRecursive(directoryPath, fileName) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const results = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesByNameRecursive(entryPath, fileName));
      continue;
    }

    if (entry.isFile() && entry.name === fileName) {
      results.push(entryPath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function validateFiles(targets) {
  const errors = [];
  let validatedFileCount = 0;

  for (const group of [targets.manifests, targets.runtimeConfigs, targets.rulePacks, targets.profiles, targets.samplePackages, targets.sampleIndices]) {
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

  if (typeof schema.$id !== "string" || schema.$id.trim().length === 0) {
    errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: schema should declare a non-empty $id.`);
  }

  if (typeof schema.compatibility !== "object" || schema.compatibility === null) {
    errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: schema should declare compatibility metadata.`);
  } else {
    if (typeof schema.compatibility.forward !== "string" || schema.compatibility.forward.trim().length === 0) {
      errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: compatibility.forward should be a non-empty string.`);
    }

    if (typeof schema.compatibility.backward !== "string" || schema.compatibility.backward.trim().length === 0) {
      errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: compatibility.backward should be a non-empty string.`);
    }
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

function validateAssemblyGeneratedArtifacts(subjectPackDirectories) {
  const assemblyRoot = resolveRepoPath("prompts/specs/assemblies");
  if (!fs.existsSync(assemblyRoot)) {
    return ["Missing assembly root: prompts/specs/assemblies"];
  }

  const assemblyFiles = fs
    .readdirSync(assemblyRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(assemblyRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const errors = [];
  const subjectPackByName = new Map(
    subjectPackDirectories.map((directoryPath) => [path.basename(directoryPath), directoryPath])
  );
  const assembliesBySubjectPack = new Map();
  const normalizeRelativePath = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return value;
    }

    return path.posix.normalize(value.replace(/\\/g, "/"));
  };

  for (const assemblyFile of assemblyFiles) {
    const assembly = readJsonFile(assemblyFile);
    const existingAssemblies = assembliesBySubjectPack.get(assembly.subjectPack) ?? [];
    existingAssemblies.push(assemblyFile);
    assembliesBySubjectPack.set(assembly.subjectPack, existingAssemblies);
    errors.push(...checkAssemblyOutputs(assemblyFile));

    const subjectPackDir = subjectPackByName.get(assembly.subjectPack);
    if (!subjectPackDir) {
      errors.push(`Assembly ${path.relative(resolveRepoPath("."), assemblyFile)} references missing subject-pack ${assembly.subjectPack}.`);
      continue;
    }

    const manifest = readJsonFile(path.join(subjectPackDir, "manifest.json"));
    const config = readJsonFile(path.join(subjectPackDir, "config.json"));
    const relativeHumanSpec = path.relative(subjectPackDir, path.resolve(path.dirname(assemblyFile), assembly.fullOutput)).replace(/\\/g, "/");
    const relativeSpecMirror = path.relative(subjectPackDir, path.resolve(path.dirname(assemblyFile), assembly.mirroredSpecOutput)).replace(/\\/g, "/");

    if (normalizeRelativePath(manifest.sourceOfTruth?.humanSpec) !== normalizeRelativePath(relativeHumanSpec)) {
      errors.push(`Manifest humanSpec ${manifest.sourceOfTruth?.humanSpec ?? "(missing)"} does not match assembly output ${relativeHumanSpec}.`);
    }

    if (normalizeRelativePath(config.sourceOfTruth?.humanSpec) !== normalizeRelativePath(relativeHumanSpec)) {
      errors.push(`Runtime config humanSpec ${config.sourceOfTruth?.humanSpec ?? "(missing)"} does not match assembly output ${relativeHumanSpec}.`);
    }

    if (normalizeRelativePath(manifest.sourceOfTruth?.mirroredSpec) !== normalizeRelativePath(relativeSpecMirror)) {
      errors.push(`Manifest mirroredSpec ${manifest.sourceOfTruth?.mirroredSpec ?? "(missing)"} does not match assembly mirror ${relativeSpecMirror}.`);
    }

    if (normalizeRelativePath(config.sourceOfTruth?.mirroredSpec) !== normalizeRelativePath(relativeSpecMirror)) {
      errors.push(`Runtime config mirroredSpec ${config.sourceOfTruth?.mirroredSpec ?? "(missing)"} does not match assembly mirror ${relativeSpecMirror}.`);
    }
  }

  for (const subjectPack of subjectPackByName.keys()) {
    const matchingAssemblies = assembliesBySubjectPack.get(subjectPack) ?? [];
    if (matchingAssemblies.length === 0) {
      errors.push(`Subject-pack ${subjectPack} is missing prompts/specs/assemblies coverage.`);
      continue;
    }

    if (matchingAssemblies.length > 1) {
      errors.push(
        `Subject-pack ${subjectPack} is referenced by multiple assemblies: ${matchingAssemblies.map((filePath) => path.relative(resolveRepoPath("."), filePath)).join(", ")}.`
      );
    }
  }

  return errors;
}

function main() {
  const targets = collectValidationTargets();
  const fileValidation = validateFiles(targets);
  const snapshotValidations = validateSnapshots(targets.snapshotSchema, targets.subjectPacks);
  const assemblyErrors = validateAssemblyGeneratedArtifacts(targets.subjectPacks.map((subjectPack) => resolveRepoPath(`prompts/${subjectPack}`)));
  const schemaFileErrors = validateSchemaFiles(targets.schemaFiles);
  const mergedAssetValidations = targets.subjectPacks.map((subjectPack) => ({
    subjectPack,
    mergedAssets: buildMergedAssets({ subjectPack })
  }));

  const errors = [
    ...fileValidation.errors,
    ...snapshotValidations.flatMap((validation) =>
      validation.errors.map((error) => `ResolvedSnapshot(${validation.subjectPack}): ${error}`)
    ),
    ...assemblyErrors,
    ...schemaFileErrors
  ];

  for (const validation of mergedAssetValidations) {
    if (!validation.mergedAssets.rules.length) {
      errors.push(`Merged assets produced zero rules for ${validation.subjectPack}.`);
    }

    if (!Object.keys(validation.mergedAssets.profiles).length) {
      errors.push(`Merged assets produced zero profiles for ${validation.subjectPack}.`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log(
    `Validated ${fileValidation.validatedFileCount} asset files, ${mergedAssetValidations.length} subject packs, and ${snapshotValidations.length} snapshots (${snapshotValidations.map((validation) => `${validation.subjectPack}:${validation.snapshot.snapshotId}`).join(", ")}).`
  );
}

main();
