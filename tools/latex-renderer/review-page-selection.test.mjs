import assert from "node:assert/strict";
import test from "node:test";

import { parsePageSelection } from "./review-page-selection.mjs";

test("parsePageSelection expands all and defaults", () => {
  assert.deepEqual(parsePageSelection("all", 3), [1, 2, 3]);
  assert.deepEqual(parsePageSelection("", 2), [1, 2]);
  assert.deepEqual(parsePageSelection("ALL", 2), [1, 2]);
});

test("parsePageSelection supports lists, ranges, last, and deduplication", () => {
  assert.deepEqual(parsePageSelection("1,3", 4), [1, 3]);
  assert.deepEqual(parsePageSelection("2-4", 5), [2, 3, 4]);
  assert.deepEqual(parsePageSelection("last", 4), [4]);
  assert.deepEqual(parsePageSelection("2,2,3-4", 5), [2, 3, 4]);
});

test("parsePageSelection rejects invalid tokens, ranges, and out-of-bounds pages", () => {
  assert.throws(() => parsePageSelection("x", 3), /Invalid page token: x/);
  assert.throws(() => parsePageSelection("4-2", 5), /Invalid page range: 4-2/);
  assert.throws(() => parsePageSelection("9", 3), /Page 9 is outside 1-3/);
  assert.throws(() => parsePageSelection("1,last-3", 2), /Page 3 is outside 1-2/);
});
