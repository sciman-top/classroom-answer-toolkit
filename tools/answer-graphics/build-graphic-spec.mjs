import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { resolveAnswerGraphicsRoot } from "./workspace-root.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "answer-graphic-spec.schema.json");
const answerGraphicsRoot = resolveAnswerGraphicsRoot(repoRoot);

function requireAnchor(anchors, id) {
  const anchor = anchors[id];
  if (!anchor) {
    throw new Error(`Figure understanding result is missing required anchor: ${id}`);
  }
  return anchor;
}

function requireLabel(labels, id) {
  const label = labels[id];
  if (!label) {
    throw new Error(`Figure understanding result is missing required label: ${id}`);
  }
  return label;
}

function main() {
  const figureAssetPath = path.join(answerGraphicsRoot, "problem-figure-asset.json");
  const understandingPath = path.join(answerGraphicsRoot, "figure-understanding-result.json");
  const outputPath = path.join(answerGraphicsRoot, "answer-graphic-spec.json");

  if (!fs.existsSync(figureAssetPath)) {
    throw new Error(`Problem figure asset not found: ${figureAssetPath}`);
  }

  if (!fs.existsSync(understandingPath)) {
    throw new Error(`Figure understanding result not found: ${understandingPath}`);
  }

  const figureAsset = JSON.parse(fs.readFileSync(figureAssetPath, "utf8"));
  const understanding = JSON.parse(fs.readFileSync(understandingPath, "utf8"));
  const anchors = Object.fromEntries((understanding.anchors ?? []).map((anchor) => [anchor.id, anchor]));
  const labels = Object.fromEntries((understanding.labels ?? []).map((label) => [label.id, label]));

  const pivot = requireAnchor(anchors, "pivot");
  const forceTop = requireAnchor(anchors, "force-top");
  const forceTail = requireAnchor(anchors, "force-tail");
  const resistance = requireAnchor(anchors, "resistance");
  const forceArmLabel = requireLabel(labels, "label-force-arm");

  const spec = {
    schemaVersion: "1.0",
    kind: "answer-graphic-spec",
    graphicId: `${figureAsset.figureId}-answer`,
    baseFigureId: figureAsset.figureId,
    intent: "lever-force-arm",
    anchorMap: {
      pivot: { x: pivot.x, y: pivot.y, label: pivot.label },
      force: { x: forceTop.x, y: forceTop.y, label: forceTop.label },
      resistance: { x: resistance.x, y: resistance.y, label: resistance.label }
    },
    primitives: [
      {
        type: "circle",
        center: { x: pivot.x, y: pivot.y },
        radius: 16,
        stroke: "#b91c1c",
        fill: "none"
      },
      {
        type: "arrow",
        from: { x: forceTop.x, y: forceTop.y },
        to: { x: forceTail.x, y: forceTail.y },
        stroke: "#b91c1c",
        label: "F"
      },
      {
        type: "label",
        text: forceArmLabel.text,
        x: forceArmLabel.x,
        y: forceArmLabel.y,
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
    caption: "Lever force-arm diagram",
    placementHints: {
      preferredWidthMm: 120,
      placementMode: "inline-medium"
    },
    reviewHints: {
      verifyPivot: true,
      verifyArrowDirection: true,
      verifyUnderstandingInput: true
    }
  };

  const errors = validateValueAgainstSchema(spec, schemaPath);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  console.log(outputPath);
}

main();
