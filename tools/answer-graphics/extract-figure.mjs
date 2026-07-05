import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { resolveAnswerGraphicsRoot } from "./workspace-root.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "problem-figure-asset.schema.json");
const answerGraphicsRoot = resolveAnswerGraphicsRoot(repoRoot);

function parseArgs(argv) {
  const options = {
    figureId: "sample-lever-figure",
    sourceDocument: path.join(repoRoot, "eval", "junior-physics-answer", "cases", "smoke-answer.md"),
    questionRef: "11",
    output: path.join(answerGraphicsRoot, "problem-figure-asset.json")
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--figure-id") {
      options.figureId = argv[++index];
      continue;
    }
    if (arg.startsWith("--figure-id=")) {
      options.figureId = arg.slice("--figure-id=".length);
      continue;
    }
    if (arg === "--source") {
      options.sourceDocument = path.resolve(process.env.INIT_CWD || process.cwd(), argv[++index]);
      continue;
    }
    if (arg.startsWith("--source=")) {
      options.sourceDocument = path.resolve(process.env.INIT_CWD || process.cwd(), arg.slice("--source=".length));
      continue;
    }
    if (arg === "--question-ref") {
      options.questionRef = argv[++index];
      continue;
    }
    if (arg.startsWith("--question-ref=")) {
      options.questionRef = arg.slice("--question-ref=".length);
      continue;
    }
    if (arg === "--output") {
      options.output = path.resolve(process.env.INIT_CWD || process.cwd(), argv[++index]);
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = path.resolve(process.env.INIT_CWD || process.cwd(), arg.slice("--output=".length));
      continue;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceDocument = path.resolve(options.sourceDocument);
  if (!fs.existsSync(sourceDocument)) {
    throw new Error(`Source document not found: ${sourceDocument}`);
  }

  const asset = {
    schemaVersion: "1.0",
    kind: "problem-figure-asset",
    figureId: options.figureId,
    sourceDocument,
    sourceKind: "pdf-review",
    pageNumber: 1,
    questionRef: options.questionRef,
    imagePath: path.join(path.dirname(sourceDocument), "figure-crop.png"),
    cropBox: {
      x: 0,
      y: 0,
      width: 1200,
      height: 800
    },
    pixelSize: {
      width: 1200,
      height: 800
    },
    dpi: 144
  };

  const errors = validateValueAgainstSchema(asset, schemaPath);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
  console.log(options.output);
}

main();
