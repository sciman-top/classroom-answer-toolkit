import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateValueAgainstSchema } from "./schema-validator.mjs";

function withSchema(schema, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "schema-validator-"));
  try {
    const schemaPath = path.join(directory, "schema.json");
    fs.writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
    return run(schemaPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const errorsOf = (value, schemaPath) => validateValueAgainstSchema(value, schemaPath);

test("checks types, enum, const, pattern, and numeric bounds on primitives", () => {
  withSchema({
    type: "object",
    properties: {
      name: { type: "string", minLength: 2 },
      level: { type: "integer", minimum: 1, maximum: 3 },
      channel: { enum: ["low", "high"] },
      kind: { const: "snapshot" },
      hash: { type: "string", pattern: "^[0-9a-f]{4}$" }
    }
  }, (schemaPath) => {
    assert.deepEqual(errorsOf({ name: "ab", level: 2, channel: "low", kind: "snapshot", hash: "a1b2" }, schemaPath), []);
    assert.ok(errorsOf({ name: "a" }, schemaPath).some((error) => error.includes("name should have length")));
    assert.ok(errorsOf({ level: 2.5 }, schemaPath).some((error) => error.includes("level should be integer")));
    assert.ok(errorsOf({ level: 4 }, schemaPath).some((error) => error.includes("level should be <=")));
    assert.ok(errorsOf({ channel: "original" }, schemaPath).some((error) => error.includes("channel should be one of")));
    assert.ok(errorsOf({ kind: "receipt" }, schemaPath).some((error) => error.includes("kind should equal")));
    assert.ok(errorsOf({ hash: "XYZ1" }, schemaPath).some((error) => error.includes("hash should match pattern")));
    assert.ok(errorsOf({ name: 7 }, schemaPath).some((error) => error.includes("name should be string")));
  });
});

test("checks required properties and additionalProperties in both forms", () => {
  withSchema({
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
    additionalProperties: false
  }, (schemaPath) => {
    assert.deepEqual(errorsOf({ id: "a" }, schemaPath), []);
    assert.ok(errorsOf({}, schemaPath).some((error) => error.includes('missing required property "id"')));
    assert.ok(errorsOf({ id: "a", extra: 1 }, schemaPath).some((error) => error.includes('unsupported property "extra"')));
  });

  // additionalProperties as a schema applies to every undeclared key (the
  // object form must not silently skip validation).
  withSchema({
    type: "object",
    properties: { id: { type: "string" } },
    additionalProperties: { type: "integer" }
  }, (schemaPath) => {
    assert.deepEqual(errorsOf({ id: "a", count: 3 }, schemaPath), []);
    assert.ok(errorsOf({ id: "a", count: "three" }, schemaPath).some((error) => error.includes("count should be integer")));
  });
});

test("validates array items, size limits, and uniqueness", () => {
  withSchema({
    type: "array",
    items: { type: "string" },
    minItems: 1,
    maxItems: 2,
    uniqueItems: true
  }, (schemaPath) => {
    assert.deepEqual(errorsOf(["a"], schemaPath), []);
    assert.ok(errorsOf([], schemaPath).some((error) => error.includes("at least 1")));
    assert.ok(errorsOf(["a", "b", "c"], schemaPath).some((error) => error.includes("at most 2")));
    assert.ok(errorsOf(["a", "a"], schemaPath).some((error) => error.includes("unique items")));
    assert.ok(errorsOf(["a", 5], schemaPath).some((error) => error.includes("1 should be string")));
  });
});

test("supports anyOf, oneOf, and not combinators", () => {
  withSchema({
    anyOf: [{ type: "string" }, { type: "integer" }]
  }, (schemaPath) => {
    assert.deepEqual(errorsOf("x", schemaPath), []);
    assert.deepEqual(errorsOf(3, schemaPath), []);
    assert.ok(errorsOf(true, schemaPath).some((error) => error.includes("anyOf")));
  });

  withSchema({
    oneOf: [{ type: "string", const: "a" }, { type: "string", minLength: 1 }]
  }, (schemaPath) => {
    assert.deepEqual(errorsOf("b", schemaPath), []);
    // "a" matches both branches, so exactly-one fails.
    assert.ok(errorsOf("a", schemaPath).some((error) => error.includes("exactly one oneOf branch")));
  });

  withSchema({
    not: { type: "null" }
  }, (schemaPath) => {
    assert.deepEqual(errorsOf("value", schemaPath), []);
    assert.ok(errorsOf(null, schemaPath).some((error) => error.includes("forbidden schema")));
  });
});

test("resolves internal and file $refs", () => {
  withSchema({
    type: "object",
    properties: {
      value: { $ref: "#/$defs/hash" },
      sibling: { $ref: "./sibling.schema.json" }
    },
    $defs: { hash: { type: "string", pattern: "^[0-9a-f]+$" } }
  }, (schemaPath) => {
    fs.writeFileSync(path.join(path.dirname(schemaPath), "sibling.schema.json"),
      JSON.stringify({ type: "boolean" }), "utf8");
    assert.deepEqual(errorsOf({ value: "abc123", sibling: true }, schemaPath), []);
    assert.ok(errorsOf({ value: "ZZZ", sibling: true }, schemaPath).some((error) => error.includes("value should match pattern")));
    assert.ok(errorsOf({ value: "abc123", sibling: "yes" }, schemaPath).some((error) => error.includes("sibling should be boolean")));
  });
});

test("reports a non-object value against an object schema", () => {
  withSchema({ type: "object", required: ["id"] }, (schemaPath) => {
    assert.ok(errorsOf("not-an-object", schemaPath).some((error) => error.includes("$ should be object")));
  });
});
