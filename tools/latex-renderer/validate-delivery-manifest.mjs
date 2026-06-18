import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const defaultSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-manifest.schema.json");

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const options = {
    manifest: null,
    schema: defaultSchemaPath
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--manifest") {
      options.manifest = argv[++index];
      continue;
    }

    if (arg.startsWith("--manifest=")) {
      options.manifest = arg.slice("--manifest=".length);
      continue;
    }

    if (arg === "--schema") {
      options.schema = argv[++index];
      continue;
    }

    if (arg.startsWith("--schema=")) {
      options.schema = arg.slice("--schema=".length);
      continue;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node validate-delivery-manifest.mjs --manifest <delivery-manifest.json> [--schema <schema.json>]`);
    process.exit(0);
  }

  if (!options.manifest) {
    fail("Missing required --manifest argument.");
  }

  const callerCwd = process.env.INIT_CWD || process.cwd();
  const manifestPath = path.resolve(callerCwd, options.manifest);
  const schemaPath = path.resolve(callerCwd, options.schema);

  if (!fs.existsSync(manifestPath)) {
    fail(`Delivery manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const errors = validateValueAgainstSchema(manifest, schemaPath);

  if (manifest.kind !== "delivery-manifest") {
    errors.push(`Expected kind "delivery-manifest", got ${JSON.stringify(manifest.kind)}.`);
  }

  if (manifest.snapshotId !== manifest.snapshot?.id) {
    errors.push("Top-level snapshotId must match snapshot.id.");
  }

  if (manifest.profile !== manifest.snapshot?.profile) {
    errors.push("Top-level profile must match snapshot.profile.");
  }

  if (typeof manifest.snapshot?.version !== "string" || manifest.snapshot.version.trim().length === 0) {
    errors.push("snapshot.version must be a non-empty string.");
  }

  if (typeof manifest.snapshot?.profile !== "string" || manifest.snapshot.profile.trim().length === 0) {
    errors.push("snapshot.profile must be a non-empty string.");
  }

  if (typeof manifest.input === "string" && !manifest.input.toLowerCase().endsWith(".md")) {
    errors.push("input should point to a Markdown file.");
  }

  if (typeof manifest.output === "string" && !manifest.output.toLowerCase().endsWith(".pdf")) {
    errors.push("output should point to a PDF file.");
  }

  if (errors.length > 0) {
    fail(`Delivery manifest validation failed for ${manifestPath}:\n${errors.map((error) => `- ${error}`).join("\n")}`, 1);
  }

  console.log(`Validated delivery manifest: ${manifestPath}`);
}

main();
