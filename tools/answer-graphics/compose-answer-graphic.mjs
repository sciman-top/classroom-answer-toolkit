import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "placed-answer-graphic.schema.json");

function main() {
  const artifactPath = path.join(repoRoot, ".answer-graphics", "answer-graphic-artifact.json");
  const placedPath = path.join(repoRoot, ".answer-graphics", "placed-answer-graphic.json");

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Answer graphic artifact not found: ${artifactPath}`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const placed = {
    schemaVersion: "1.0",
    kind: "placed-answer-graphic",
    placedGraphicId: `${artifact.graphicId}-placed`,
    graphicId: artifact.graphicId,
    artifactId: artifact.artifactId,
    questionRef: "11",
    placementMode: "inline-medium",
    targetBlock: "answer-body",
    figureWidthMm: 120,
    captionMode: "inline",
    pageBreakPolicy: "avoid",
    previewPath: artifact.compositedPreviewPath,
    notes: [
      "Keep graphic adjacent to the original question."
    ]
  };

  const errors = validateValueAgainstSchema(placed, schemaPath);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  fs.writeFileSync(placedPath, `${JSON.stringify(placed, null, 2)}\n`, "utf8");
  console.log(placedPath);
}

main();
