import { compileResolvedSnapshot } from "./merge-rules.mjs";
import { resolveDefaultOutputRelativePath } from "./compile-snapshot.mjs";
import { listSubjectPacks, primarySubjectPackAssetId } from "./subject-pack-registry.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const packs = listSubjectPacks();
  assert(packs.length > 0, "No subject packs were discovered under prompts/.");
  assert(packs[0].assetId === primarySubjectPackAssetId,
    `Expected the primary subject pack ${primarySubjectPackAssetId} to sort first, got ${packs[0].assetId}.`);

  const otherPacks = packs.filter((pack) => pack.assetId !== primarySubjectPackAssetId);
  assert(otherPacks.length > 0, "Cross-subject validation requires at least one non-primary subject pack.");

  for (const pack of otherPacks) {
    const snapshot = compileResolvedSnapshot({
      subjectPack: pack.assetId,
      profileName: "classroom"
    });

    assert(snapshot.subjectPack.assetId === pack.assetId,
      `Expected ${pack.assetId} subject pack, got ${snapshot.subjectPack.assetId}`);
    assert(snapshot.activeProfile.name === "classroom",
      `Expected classroom profile for ${pack.assetId}, got ${snapshot.activeProfile.name}`);
    assert(snapshot.rules.some((rule) => rule.id.startsWith(`${pack.assetId}.`)),
      `No ${pack.assetId} subject rules were merged.`);
    assert(snapshot.rules.some((rule) => rule.id.startsWith("delivery.")),
      `Platform delivery rules were not inherited into ${pack.assetId}.`);
    assert(!snapshot.rules.some((rule) => rule.id.startsWith(`${primarySubjectPackAssetId}.`)),
      `Physics subject rules leaked into ${pack.assetId} snapshot.`);
    assert(snapshot.inputRefs.subjectManifest === `prompts/${pack.assetId}/manifest.json`,
      `Unexpected subject manifest ref for ${pack.assetId}: ${snapshot.inputRefs.subjectManifest}`);
    assert(snapshot.inputRefs.subjectConfig === `prompts/${pack.assetId}/config.json`,
      `Unexpected subject config ref for ${pack.assetId}: ${snapshot.inputRefs.subjectConfig}`);
  }

  // Pin the default snapshot file naming contract shared by PowerShell gates
  // (via the registry) and the renderer's runtime-config defaults.
  assert(
    resolveDefaultOutputRelativePath("math-answer") === ".snapshot-cache/resolved-snapshot.math.json",
    `Unexpected default math snapshot path: ${resolveDefaultOutputRelativePath("math-answer")}`
  );
  assert(
    resolveDefaultOutputRelativePath(primarySubjectPackAssetId) === ".snapshot-cache/resolved-snapshot.json",
    `Unexpected default physics snapshot path: ${resolveDefaultOutputRelativePath(primarySubjectPackAssetId)}`
  );

  const validatedPacks = otherPacks.map((pack) => pack.assetId).join(", ");
  console.log(`Cross-subject contract validated for ${validatedPacks} against ${primarySubjectPackAssetId}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
}
