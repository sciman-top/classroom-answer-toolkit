import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { resolveAnswerGraphicsRoot } from "./workspace-root.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "answer-graphic-artifact.schema.json");
const answerGraphicsRoot = resolveAnswerGraphicsRoot(repoRoot);

function primitiveToSvg(primitive) {
  switch (primitive.type) {
    case "circle":
      return `<circle cx="${primitive.center.x}" cy="${primitive.center.y}" r="${primitive.radius}" fill="${primitive.fill ?? "none"}" stroke="${primitive.stroke ?? "#b91c1c"}" stroke-width="6" />`;
    case "arrow":
      return `<line x1="${primitive.from.x}" y1="${primitive.from.y}" x2="${primitive.to.x}" y2="${primitive.to.y}" stroke="${primitive.stroke ?? "#b91c1c"}" stroke-width="6" marker-end="url(#arrowhead)" />`;
    case "label":
      return `<text x="${primitive.x}" y="${primitive.y}" fill="${primitive.fill ?? "#1d4ed8"}" font-family="Microsoft YaHei UI" font-size="28">${primitive.text}</text>`;
    default:
      return "";
  }
}

function main() {
  const specPath = path.join(answerGraphicsRoot, "answer-graphic-spec.json");
  const figurePath = path.join(answerGraphicsRoot, "problem-figure-asset.json");
  const overlayPath = path.join(answerGraphicsRoot, "answer-graphic-overlay.svg");
  const previewPath = path.join(answerGraphicsRoot, "answer-graphic-preview.svg");

  if (!fs.existsSync(specPath) || !fs.existsSync(figurePath)) {
    throw new Error("Graphic spec or figure asset missing.");
  }

  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const figure = JSON.parse(fs.readFileSync(figurePath, "utf8"));

  const overlaySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${spec.style.canvasWidth}" height="${spec.style.canvasHeight}" viewBox="0 0 ${spec.style.canvasWidth} ${spec.style.canvasHeight}">
  <defs>
    <marker id="arrowhead" markerWidth="12" markerHeight="12" refX="8" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L12,6 L0,12 z" fill="${spec.style.strokeColor}" />
    </marker>
  </defs>
  <rect x="0" y="0" width="${spec.style.canvasWidth}" height="${spec.style.canvasHeight}" fill="none" />
  ${spec.primitives.map(primitiveToSvg).join("\n  ")}
</svg>
`;

  const artifact = {
    schemaVersion: "1.0",
    kind: "answer-graphic-artifact",
    artifactId: `${spec.graphicId}-artifact`,
    graphicId: spec.graphicId,
    baseImagePath: figure.imagePath,
    overlaySvgPath: overlayPath,
    compositedPreviewPath: previewPath,
    widthPx: spec.style.canvasWidth,
    heightPx: spec.style.canvasHeight,
    boundingBoxes: [
      { id: "pivot", x: 168, y: 608, width: 24, height: 24 },
      { id: "force", x: 908, y: 224, width: 24, height: 24 }
    ]
  };

  const errors = validateValueAgainstSchema(artifact, schemaPath);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
  fs.writeFileSync(overlayPath, overlaySvg, "utf8");
  fs.writeFileSync(previewPath, overlaySvg, "utf8");
  fs.writeFileSync(path.join(answerGraphicsRoot, "answer-graphic-artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(overlayPath);
}

main();
