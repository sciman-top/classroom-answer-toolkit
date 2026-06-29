import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const deliveryManifestSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-manifest.schema.json");

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
    profile: null,
    subjectPack: null,
    snapshotPath: null,
    snapshotId: null,
    reviewDir: null,
    reviewManifestPath: null,
    reviewScale: null,
    out: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input") {
      options.input = argv[++index];
      continue;
    }
    if (arg.startsWith("--input=")) {
      options.input = arg.slice("--input=".length);
      continue;
    }

    if (arg === "--output") {
      options.output = argv[++index];
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
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

    if (arg === "--snapshot-path") {
      options.snapshotPath = argv[++index];
      continue;
    }
    if (arg.startsWith("--snapshot-path=")) {
      options.snapshotPath = arg.slice("--snapshot-path=".length);
      continue;
    }

    if (arg === "--snapshot-id") {
      options.snapshotId = argv[++index];
      continue;
    }
    if (arg.startsWith("--snapshot-id=")) {
      options.snapshotId = arg.slice("--snapshot-id=".length);
      continue;
    }

    if (arg === "--review-dir") {
      options.reviewDir = argv[++index];
      continue;
    }
    if (arg.startsWith("--review-dir=")) {
      options.reviewDir = arg.slice("--review-dir=".length);
      continue;
    }

    if (arg === "--review-manifest") {
      options.reviewManifestPath = argv[++index];
      continue;
    }
    if (arg.startsWith("--review-manifest=")) {
      options.reviewManifestPath = arg.slice("--review-manifest=".length);
      continue;
    }

    if (arg === "--review-scale") {
      options.reviewScale = argv[++index];
      continue;
    }
    if (arg.startsWith("--review-scale=")) {
      options.reviewScale = arg.slice("--review-scale=".length);
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

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input || !options.output || !options.snapshotPath || !options.snapshotId) {
    fail("Missing required arguments for delivery manifest.");
  }

  const callerCwd = process.env.INIT_CWD || process.cwd();
  const inputPath = path.resolve(callerCwd, options.input);
  const outputPath = path.resolve(callerCwd, options.output);
  const snapshotPath = path.resolve(callerCwd, options.snapshotPath);
  const reviewDir = options.reviewDir ? path.resolve(callerCwd, options.reviewDir) : null;
  const reviewManifestPath = options.reviewManifestPath ? path.resolve(callerCwd, options.reviewManifestPath) : null;
  const manifestOutPath = options.out
    ? path.resolve(callerCwd, options.out)
    : path.resolve(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}.delivery-manifest.json`);

  const manifest = {
    schemaVersion: "1.0",
    kind: "delivery-manifest",
    generatedAt: new Date().toISOString(),
    snapshotId: options.snapshotId,
    snapshotPath,
    snapshot: {
      id: options.snapshotId,
      version: null,
      profile: options.profile
    },
    subjectPack: options.subjectPack,
    profile: options.profile,
    input: inputPath,
    output: outputPath,
    review: {
      outputDir: reviewDir,
      manifestPath: reviewManifestPath,
      scale: options.reviewScale
    }
  };

  if (fs.existsSync(snapshotPath)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      manifest.snapshot.version = snapshot?.subjectPack?.version ?? null;
      manifest.snapshot.profile = snapshot?.activeProfile?.name ?? options.profile;
    } catch {
      manifest.snapshot.version = null;
    }
  } else {
    fail(`Resolved snapshot not found: ${snapshotPath}`);
  }

  const errors = validateValueAgainstSchema(manifest, deliveryManifestSchemaPath);
  if (errors.length > 0) {
    fail(`Delivery manifest failed schema validation:\n${errors.map((error) => `- ${error}`).join("\n")}`, 1);
  }

  fs.mkdirSync(path.dirname(manifestOutPath), { recursive: true });
  fs.writeFileSync(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(manifestOutPath);
}

main();
