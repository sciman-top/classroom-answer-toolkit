import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileResolvedSnapshot, writeResolvedSnapshot } from "./merge-rules.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    profile: null,
    out: ".snapshot-cache/resolved-snapshot.json"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") {
      options.profile = argv[++index];
      continue;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = compileResolvedSnapshot({ profileName: options.profile });
  const outputPath = writeResolvedSnapshot(snapshot, options.out);
  console.log(outputPath);
}

main();
