import path from "node:path";

import { isDirectInvocation, parseArgvFlags, repositoryRoot } from "../shared.mjs";
import { validateWorkflowReceiptFile } from "../latex-renderer/lib/workflow-receipt.mjs";

function usage() {
  return "Usage: node tools/rule-compiler/validate-workflow-receipt.mjs --receipt <workflow-run.json>";
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgvFlags(argv, {
    stringFlags: { receipt: true },
    defaults: { receipt: null },
    help: true,
    unknownFlag: "error"
  });
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.receipt) {
    throw new Error(`Missing --receipt.\n\n${usage()}`);
  }
  const receiptPath = path.resolve(repositoryRoot, options.receipt);
  const errors = validateWorkflowReceiptFile(receiptPath, { validateStages: true });
  if (errors.length > 0) {
    console.error(`Workflow receipt validation failed for ${receiptPath}:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    return 1;
  }
  console.log(`Validated workflow receipt: ${path.relative(repositoryRoot, receiptPath) || receiptPath}`);
  return 0;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
