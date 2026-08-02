import test from "node:test";
import assert from "node:assert/strict";

import { forbiddenSpecTerms, validateSpecText } from "./validate-spec-boundary.mjs";

test("plain Markdown-only answer contract is accepted", () => {
  assert.deepEqual(
    validateSpecText("fixture.md", "最终输出只能是完整答案 Markdown，不输出内部对象。"),
    []
  );
});

for (const term of forbiddenSpecTerms) {
  test(`frozen term is rejected: ${term}`, () => {
    assert.deepEqual(
      validateSpecText("fixture.md", `规则中出现 ${term}`),
      [`fixture.md: forbidden frozen spec term: ${term}`]
    );
  });
}
