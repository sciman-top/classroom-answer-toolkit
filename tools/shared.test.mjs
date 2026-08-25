import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { deepMerge, parseArgvFlags, sha256File, sha256Hex } from "./shared.mjs";

test("sha256Hex matches known digest for text", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256File hashes file bytes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shared-sha-"));
  try {
    const filePath = path.join(directory, "sample.txt");
    fs.writeFileSync(filePath, "abc", "utf8");
    assert.equal(sha256File(filePath), sha256Hex("abc"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("deepMerge merges nested objects and lets overrides replace scalars and arrays", () => {
  const merged = deepMerge(
    { a: 1, nested: { x: 1, y: 2 }, list: [1] },
    { nested: { y: 3, z: 4 }, list: [2], a: undefined }
  );
  assert.deepEqual(merged, { a: undefined, nested: { x: 1, y: 3, z: 4 }, list: [2] });
});

test("deepMerge ignores non-object overrides", () => {
  const base = { a: 1 };
  assert.equal(deepMerge(base, null), base);
  assert.equal(deepMerge(base, [1]), base);
});

test("parseArgvFlags supports both flag forms and kebab-to-camel keys", () => {
  const parsed = parseArgvFlags(
    ["--profile", "classroom", "--subject-pack=math-answer", "input.md"],
    {
      stringFlags: { profile: true, "subject-pack": true },
      defaults: { profile: null, subjectPack: "junior-physics-answer" },
      positional: true
    }
  );
  assert.deepEqual(parsed.options, { profile: "classroom", subjectPack: "math-answer" });
  assert.deepEqual(parsed.positional, ["input.md"]);
});

test("parseArgvFlags maps explicit target keys", () => {
  const options = parseArgvFlags(["--review-manifest", "m.json"], {
    stringFlags: { "review-manifest": "reviewManifestPath" },
    defaults: { reviewManifestPath: null }
  });
  assert.equal(options.reviewManifestPath, "m.json");
});

test("parseArgvFlags booleans only accept the bare form", () => {
  const options = parseArgvFlags(["--keep-review", "--check=whatever"], {
    booleanFlags: { "keep-review": "keepReview", check: true },
    unknownFlag: "positional"
  });
  assert.equal(options.keepReview, true);
  assert.equal(options.check, undefined);
});

test("parseArgvFlags unknown flag policies", () => {
  const ignored = parseArgvFlags(["--nope", "1"], { positional: true });
  assert.deepEqual(ignored.positional, ["1"]);

  const collected = parseArgvFlags(["--nope", "1"], { unknownFlag: "positional", positional: true });
  assert.deepEqual(collected.positional, ["--nope", "1"]);

  assert.throws(() => parseArgvFlags(["--nope"], { unknownFlag: "error" }), /Unknown argument: --nope/);
});

test("parseArgvFlags help flag and trailing missing value", () => {
  const options = parseArgvFlags(["-h", "--profile"], {
    stringFlags: { profile: true },
    help: true,
    defaults: { profile: "default" }
  });
  assert.equal(options.help, true);
  assert.equal(options.profile, undefined);
});
