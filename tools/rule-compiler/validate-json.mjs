import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgvFlags } from "../shared.mjs";
import { validateJsonFileAgainstSchema } from "./schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

const usage = `Usage:
  node tools/rule-compiler/validate-json.mjs --schema <schema.json> --value <instance.json>

Validates one JSON instance against one schema from prompts/shared/schemas and
exits non-zero with the error list when validation fails.
`;

function main() {
  const options = parseArgvFlags(process.argv.slice(2), {
    stringFlags: { schema: true, value: true },
    defaults: { schema: null, value: null },
    unknownFlag: "error"
  });

  if (options.help || !options.schema || !options.value) {
    console.error(usage);
    process.exit(options.help ? 0 : 2);
  }

  const schemaPath = path.resolve(repoRoot, options.schema);
  const valuePath = path.resolve(repoRoot, options.value);
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema not found: ${schemaPath}`);
    process.exit(2);
  }

  const errors = validateJsonFileAgainstSchema(valuePath, schemaPath);
  if (errors.length > 0) {
    console.error(`${path.relative(repoRoot, valuePath)} failed schema validation:`);
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }

  console.log(`OK ${path.relative(repoRoot, valuePath)} matches ${path.relative(repoRoot, schemaPath)}`);
}

main();
