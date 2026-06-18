import path from "node:path";

export function resolveAnswerGraphicsRoot(repoRoot) {
  return process.env.ANSWER_GRAPHICS_ROOT
    ? path.resolve(process.env.ANSWER_GRAPHICS_ROOT)
    : path.join(repoRoot, ".answer-graphics");
}
