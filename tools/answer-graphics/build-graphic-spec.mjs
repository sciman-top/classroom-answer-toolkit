import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "answer-graphic-spec.schema.json");

function main() {
  const inputPath = path.join(repoRoot, ".answer-graphics", "problem-figure-asset.json");
  const outputPath = path.join(repoRoot, ".answer-graphics", "answer-graphic-spec.json");

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Problem figure asset not found: ${inputPath}`);
  }

  const figureAsset = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const spec = {
    schemaVersion: "1.0",
    kind: "answer-graphic-spec",
    graphicId: `${figureAsset.figureId}-answer`,
    baseFigureId: figureAsset.figureId,
    intent: "lever-force-arm",
    anchorMap: {
      pivot: { x: 180, y: 620, label: "支点" },
      force: { x: 920, y: 240, label: "动力" },
      resistance: { x: 1080, y: 620, label: "阻力" }
    },
    primitives: [
      {
        type: "circle",
        center: { x: 180, y: 620 },
        radius: 16,
        stroke: "#b91c1c",
        fill: "none"
      },
      {
        type: "arrow",
        from: { x: 920, y: 240 },
        to: { x: 920, y: 80 },
        stroke: "#b91c1c",
        label: "F"
      },
      {
        type: "label",
        text: "力臂",
        x: 560,
        y: 420,
        fill: "#1d4ed8"
      }
    ],
    style: {
      canvasWidth: figureAsset.pixelSize.width,
      canvasHeight: figureAsset.pixelSize.height,
      strokeColor: "#b91c1c",
      accentColor: "#1d4ed8",
      guideColor: "#475569",
      fontFamily: "Microsoft YaHei UI",
      fontSize: 26,
      lineWidth: 6
    },
    caption: "杠杆力臂示意",
    placementHints: {
      preferredWidthMm: 120,
      placementMode: "inline-medium"
    },
    reviewHints: {
      verifyPivot: true,
      verifyArrowDirection: true
    }
  };

  const errors = validateValueAgainstSchema(spec, schemaPath);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  console.log(outputPath);
}

main();
