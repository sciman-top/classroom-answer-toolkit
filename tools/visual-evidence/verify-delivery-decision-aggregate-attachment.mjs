import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyDeliveryDecisionAggregateAttachment } from "./attach-delivery-decision-aggregate.mjs";

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/visual-evidence run verify:aggregate-attachment -- \\",
    "    --manifest <delivery-manifest.json>",
    "",
    "The verifier reads the attached manifest, receipt, preimage backup, and aggregate without modifying them."
  ].join("\n");
}

function parseArgs(argv) {
  let manifestPath = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      const value = argv[++index];
      if (typeof value !== "string" || value.startsWith("--")) {
        throw new Error("--manifest requires a value.");
      }
      manifestPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), value);
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return null;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  if (!manifestPath) {
    throw new Error(`--manifest is required.\n\n${usage()}`);
  }
  return { manifestPath };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    return;
  }
  process.stdout.write(`${JSON.stringify(verifyDeliveryDecisionAggregateAttachment(options), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
