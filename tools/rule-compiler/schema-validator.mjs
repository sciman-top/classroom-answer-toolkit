import fs from "node:fs";
import path from "node:path";
import { readJsonFile } from "./shared.mjs";

function typeOfValue(value) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function formatPath(targetPath) {
  return targetPath || "$";
}

function resolveSchemaRef(schema, schemaPath, rootSchema, cache) {
  const ref = schema.$ref;
  if (!ref) {
    return { schema, schemaPath, rootSchema };
  }

  if (ref.startsWith("#/")) {
    const segments = ref.slice(2).split("/");
    let resolved = rootSchema;
    for (const segment of segments) {
      resolved = resolved?.[segment];
    }
    if (!resolved) {
      throw new Error(`Unable to resolve schema ref ${ref} in ${schemaPath}`);
    }
    return { schema: resolved, schemaPath, rootSchema };
  }

  const targetPath = path.resolve(path.dirname(schemaPath), ref);
  if (!cache.has(targetPath)) {
    cache.set(targetPath, readJsonFile(targetPath));
  }

  return {
    schema: cache.get(targetPath),
    schemaPath: targetPath,
    rootSchema: cache.get(targetPath)
  };
}

function validateObject(value, schema, currentPath, state) {
  if (typeOfValue(value) !== "object") {
    state.errors.push(`${formatPath(currentPath)} should be object, got ${typeOfValue(value)}.`);
    return;
  }

  for (const key of schema.required ?? []) {
    if (!(key in value)) {
      state.errors.push(`${formatPath(currentPath)} is missing required property "${key}".`);
    }
  }

  const propertySchemas = schema.properties ?? {};
  for (const [key, propertyValue] of Object.entries(value)) {
    if (propertySchemas[key]) {
      validateValue(propertyValue, propertySchemas[key], `${currentPath}/${key}`, state);
      continue;
    }

    if (schema.additionalProperties === false) {
      state.errors.push(`${formatPath(currentPath)} contains unsupported property "${key}".`);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      validateValue(propertyValue, schema.additionalProperties, `${currentPath}/${key}`, state);
    }
  }
}

function validateArray(value, schema, currentPath, state) {
  if (!Array.isArray(value)) {
    state.errors.push(`${formatPath(currentPath)} should be array, got ${typeOfValue(value)}.`);
    return;
  }

  for (let index = 0; index < value.length; index += 1) {
    validateValue(value[index], schema.items ?? {}, `${currentPath}/${index}`, state);
  }

  if (schema.uniqueItems === true) {
    const serialized = value.map((item) => JSON.stringify(item));
    if (new Set(serialized).size !== serialized.length) {
      state.errors.push(`${formatPath(currentPath)} should contain unique items.`);
    }
  }

  if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
    state.errors.push(`${formatPath(currentPath)} should contain at least ${schema.minItems} items.`);
  }

  if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
    state.errors.push(`${formatPath(currentPath)} should contain at most ${schema.maxItems} items.`);
  }
}

function validatePrimitive(value, schema, currentPath, state) {
  const actualType = typeOfValue(value);
  const typeMatches = !schema.type
    || actualType === schema.type
    || (schema.type === "integer" && Number.isInteger(value));

  if (!typeMatches) {
    state.errors.push(`${formatPath(currentPath)} should be ${schema.type}, got ${actualType}.`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    state.errors.push(`${formatPath(currentPath)} should be one of ${schema.enum.join(", ")}, got ${JSON.stringify(value)}.`);
  }

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    state.errors.push(
      `${formatPath(currentPath)} should equal ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}.`);
  }

  if (actualType === "string" && Number.isInteger(schema.minLength) && value.length < schema.minLength) {
    state.errors.push(`${formatPath(currentPath)} should have length >= ${schema.minLength}.`);
  }

  if (actualType === "string" && typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
    state.errors.push(`${formatPath(currentPath)} should match pattern ${schema.pattern}.`);
  }

  if ((actualType === "number" || Number.isInteger(value))
    && typeof schema.minimum === "number"
    && value < schema.minimum) {
    state.errors.push(`${formatPath(currentPath)} should be >= ${schema.minimum}.`);
  }

  if ((actualType === "number" || Number.isInteger(value))
    && typeof schema.maximum === "number"
    && value > schema.maximum) {
    state.errors.push(`${formatPath(currentPath)} should be <= ${schema.maximum}.`);
  }
}

function validateValue(value, schema, currentPath, state) {
  const resolved = resolveSchemaRef(schema, state.schemaPath, state.rootSchema, state.cache);
  const nextState = {
    ...state,
    schemaPath: resolved.schemaPath,
    rootSchema: resolved.rootSchema
  };
  const effectiveSchema = resolved.schema;

  if (!effectiveSchema || typeof effectiveSchema !== "object") {
    return;
  }

  if (Array.isArray(effectiveSchema.anyOf)) {
    const matchesAnyBranch = effectiveSchema.anyOf.some((branch) => {
      const branchState = { ...nextState, errors: [] };
      validateValue(value, branch, currentPath, branchState);
      return branchState.errors.length === 0;
    });
    if (!matchesAnyBranch) {
      state.errors.push(`${formatPath(currentPath)} should match at least one anyOf branch.`);
      return;
    }
  }

  if (effectiveSchema.not && typeof effectiveSchema.not === "object") {
    const branchState = { ...nextState, errors: [] };
    validateValue(value, effectiveSchema.not, currentPath, branchState);
    if (branchState.errors.length === 0) {
      state.errors.push(`${formatPath(currentPath)} should not match the forbidden schema.`);
      return;
    }
  }

  if (Array.isArray(effectiveSchema.oneOf)) {
    const matchingBranches = effectiveSchema.oneOf.filter((branch) => {
      const branchState = { ...nextState, errors: [] };
      validateValue(value, branch, currentPath, branchState);
      return branchState.errors.length === 0;
    }).length;
    if (matchingBranches !== 1) {
      state.errors.push(
        `${formatPath(currentPath)} should match exactly one oneOf branch, matched ${matchingBranches}.`);
      return;
    }
  }

  if (effectiveSchema.type === "object" || effectiveSchema.properties || effectiveSchema.required) {
    validateObject(value, effectiveSchema, currentPath, nextState);
    return;
  }

  if (effectiveSchema.type === "array" || effectiveSchema.items) {
    validateArray(value, effectiveSchema, currentPath, nextState);
    return;
  }

  validatePrimitive(value, effectiveSchema, currentPath, nextState);
}

export function validateValueAgainstSchema(value, schemaPath) {
  const rootSchema = readJsonFile(schemaPath);
  const cache = new Map([[schemaPath, rootSchema]]);
  const state = {
    errors: [],
    schemaPath,
    rootSchema,
    cache
  };

  validateValue(value, rootSchema, "$", state);
  return state.errors;
}

export function validateJsonFileAgainstSchema(jsonPath, schemaPath) {
  if (!fs.existsSync(jsonPath)) {
    return [`File not found: ${jsonPath}`];
  }

  const value = readJsonFile(jsonPath);
  return validateValueAgainstSchema(value, schemaPath);
}
