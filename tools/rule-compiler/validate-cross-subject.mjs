import { compileResolvedSnapshot } from "./merge-rules.mjs";
import { resolveDefaultOutputRelativePath } from "./compile-snapshot.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const snapshot = compileResolvedSnapshot({
    subjectPack: "math-answer",
    profileName: "classroom"
  });

  assert(snapshot.subjectPack.assetId === "math-answer", `Expected math-answer subject pack, got ${snapshot.subjectPack.assetId}`);
  assert(snapshot.activeProfile.name === "classroom", `Expected classroom profile, got ${snapshot.activeProfile.name}`);
  assert(snapshot.rules.some((rule) => rule.id === "math-answer.derivation.stepwise"), "Math subject rule was not merged.");
  assert(snapshot.rules.some((rule) => rule.id.startsWith("delivery.")), "Platform delivery rules were not inherited.");
  assert(snapshot.inputRefs.subjectManifest === "prompts/math-answer/manifest.json", `Unexpected subject manifest ref: ${snapshot.inputRefs.subjectManifest}`);
  assert(snapshot.inputRefs.subjectConfig === "prompts/math-answer/config.json", `Unexpected subject config ref: ${snapshot.inputRefs.subjectConfig}`);
  assert(!snapshot.rules.some((rule) => rule.id.startsWith("physics-answer.")), "Physics subject rules leaked into math-answer snapshot.");
  assert(
    resolveDefaultOutputRelativePath("math-answer") === ".snapshot-cache/resolved-snapshot.math.json",
    `Unexpected default math snapshot path: ${resolveDefaultOutputRelativePath("math-answer")}`
  );
  assert(
    resolveDefaultOutputRelativePath("physics-answer") === ".snapshot-cache/resolved-snapshot.json",
    `Unexpected default physics snapshot path: ${resolveDefaultOutputRelativePath("physics-answer")}`
  );

  console.log(`Cross-subject contract validated with snapshot ${snapshot.snapshotId}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
}
