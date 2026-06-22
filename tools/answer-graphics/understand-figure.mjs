import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { resolveAnswerGraphicsRoot } from "./workspace-root.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "figure-understanding-result.schema.json");
const answerGraphicsRoot = resolveAnswerGraphicsRoot(repoRoot);

function main() {
  const assetPath = path.join(answerGraphicsRoot, "problem-figure-asset.json");
  const outputPath = path.join(answerGraphicsRoot, "figure-understanding-result.json");

  if (!fs.existsSync(assetPath)) {
    throw new Error(`Problem figure asset not found: ${assetPath}`);
  }

  const figureAsset = JSON.parse(fs.readFileSync(assetPath, "utf8"));
  const result = {
    schemaVersion: "1.0",
    kind: "figure-understanding-result",
    figureId: `${figureAsset.figureId}-understanding`,
    baseFigureId: figureAsset.figureId,
    anchors: [
      { id: "pivot", x: 180, y: 620, label: "支点" },
      { id: "beam-mid", x: 560, y: 420, label: "杠杆中段" },
      { id: "force-top", x: 920, y: 240, label: "动力作用点" },
      { id: "force-tail", x: 920, y: 80, label: "动力方向终点" },
      { id: "resistance", x: 1080, y: 620, label: "阻力点" }
    ],
    segments: [
      { id: "lever-beam", from: "pivot", to: "resistance", kind: "beam" },
      { id: "force-axis", from: "force-top", to: "force-tail", kind: "force-direction" }
    ],
    curves: [],
    regions: [
      {
        id: "primary-figure",
        points: [
          { x: 40, y: 80 },
          { x: 1160, y: 80 },
          { x: 1160, y: 760 },
          { x: 40, y: 760 }
        ]
      }
    ],
    labels: [
      { id: "label-force-arm", text: "力臂", x: 560, y: 420 },
      { id: "label-force", text: "F", x: 936, y: 168 }
    ],
    components: [
      {
        id: "lever-system",
        type: "lever",
        bbox: { x: 120, y: 80, width: 980, height: 620 }
      }
    ],
    confidence: 0.92,
    generatedAt: new Date().toISOString()
  };

  const errors = validateValueAgainstSchema(result, schemaPath);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(outputPath);
}

main();
