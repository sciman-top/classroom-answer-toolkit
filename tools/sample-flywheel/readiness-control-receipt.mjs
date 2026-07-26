import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const receiptSchema = path.join(
  repoRoot,
  "prompts",
  "shared",
  "schemas",
  "readiness-control-receipt.schema.json");
const sha256Pattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;

export function createNpmExecution(args) {
  if (process.platform !== "win32") {
    return {
      executable: "npm",
      args
    };
  }
  return {
    executable: process.execPath,
    args: [
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      ...args
    ]
  };
}

const gateExecutions = Object.freeze([
  {
    gateId: "build",
    command: "dotnet build ClassroomToolkit.sln -c Debug",
    executable: "dotnet",
    args: ["build", "ClassroomToolkit.sln", "-c", "Debug"]
  },
  {
    gateId: "test",
    command: "dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug",
    executable: "dotnet",
    args: ["test", "tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj", "-c", "Debug"]
  },
  {
    gateId: "assets",
    command: "npm --prefix tools/rule-compiler run validate:assets",
    ...createNpmExecution(["--prefix", "tools/rule-compiler", "run", "validate:assets"])
  },
  {
    gateId: "cross_subject",
    command: "npm --prefix tools/rule-compiler run validate:cross-subject",
    ...createNpmExecution(["--prefix", "tools/rule-compiler", "run", "validate:cross-subject"])
  },
  {
    gateId: "toolchain",
    command: "powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1",
    executable: "powershell",
    args: ["-ExecutionPolicy", "Bypass", "-File", "scripts/check-toolchain.ps1"]
  },
  {
    gateId: "gateway_config",
    command: "npm --prefix tools/ai-gateway run validate:config",
    ...createNpmExecution(["--prefix", "tools/ai-gateway", "run", "validate:config"])
  }
]);
export const gateDefinitions = Object.freeze(
  gateExecutions.map(({ gateId, command }) => Object.freeze({ gateId, command })));

export function runReadinessControlGates(options = {}) {
  const outputDirectory = requireExternalOutputDirectory(options.outputDirectory);
  const cleanBefore = readGitState();
  if (!cleanBefore.clean) {
    throw new Error("readiness control gates require a clean source tree.");
  }
  const startedAt = new Date().toISOString();
  const gateSequence = [];
  const environment = {
    ...process.env,
    CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED: "false"
  };

  for (let index = 0; index < gateExecutions.length; index += 1) {
    const execution = gateExecutions[index];
    const definition = gateDefinitions[index];
    const result = spawnSync(execution.executable, execution.args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: environment,
      windowsHide: true,
      timeout: 15 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024
    });
    const logBytes = Buffer.from(
      `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\nrunner_error: ${result.error.message}\n` : ""}`,
      "utf8");
    const logName = `${String(gateSequence.length + 1).padStart(2, "0")}-${definition.gateId}.log`;
    const logPath = path.join(outputDirectory, logName);
    fs.writeFileSync(logPath, logBytes, { flag: "wx" });
    gateSequence.push({
      ...definition,
      exitCode: result.status ?? 1,
      logRef: logName,
      logSha256: sha256(logBytes)
    });
    if (result.status !== 0) {
      break;
    }
  }

  const completedAt = new Date().toISOString();
  const cleanAfter = readGitState();
  const allGatesPassed = gateSequence.length === gateDefinitions.length
    && gateSequence.every((gate) => gate.exitCode === 0);
  const stableSource = cleanAfter.clean && cleanAfter.revision === cleanBefore.revision;
  const receipt = {
    schemaVersion: "1.0",
    kind: "readiness-control-receipt",
    receiptId: `readiness-control-${crypto.randomBytes(8).toString("hex")}`,
    sourceRevision: cleanBefore.revision,
    sourceTreeCleanBefore: true,
    sourceTreeCleanAfter: stableSource,
    startedAt,
    completedAt,
    gateSequence,
    cloudEgress: {
      environmentForcedDisabled: true,
      liveProbesRun: false,
      scope: "controlled_gate_processes_only"
    },
    verdict: allGatesPassed && stableSource ? "passed" : "failed"
  };
  const receiptPath = path.join(outputDirectory, "readiness-control-receipt.json");
  atomicWriteJson(receiptPath, receipt);
  validateReadinessControlReceipt(receipt, receiptPath, {
    requireCurrentSource: false,
    requirePassed: false
  });
  if (receipt.verdict !== "passed") {
    throw new Error(`readiness control gates failed; receipt: ${receiptPath}`);
  }
  try {
    validateReadinessControlReceipt(receipt, receiptPath, {
      requireCurrentSource: true
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; receipt: ${receiptPath}`);
  }
  return { receipt, receiptPath };
}

export function validateReadinessControlReceipt(receipt, receiptPath, options = {}) {
  assertSchema("ReadinessControlReceipt", receipt, receiptSchema);
  if (receipt.schemaVersion !== "1.0") {
    throw new Error("ReadinessControlReceipt schemaVersion is unsupported.");
  }
  if (!revisionPattern.test(receipt.sourceRevision)) {
    throw new Error("ReadinessControlReceipt sourceRevision is invalid.");
  }
  requireCanonicalTimestamp(receipt.startedAt, "startedAt");
  requireCanonicalTimestamp(receipt.completedAt, "completedAt");
  if (new Date(receipt.completedAt) < new Date(receipt.startedAt)) {
    throw new Error("ReadinessControlReceipt completedAt precedes startedAt.");
  }
  const requirePassed = options.requirePassed !== false;
  if (receipt.cloudEgress?.environmentForcedDisabled !== true
    || receipt.cloudEgress.liveProbesRun !== false
    || receipt.cloudEgress.scope !== "controlled_gate_processes_only") {
    throw new Error("ReadinessControlReceipt cloud-egress boundary is unsupported.");
  }
  if (!Array.isArray(receipt.gateSequence)
    || receipt.gateSequence.length === 0
    || receipt.gateSequence.length > gateDefinitions.length) {
    throw new Error("ReadinessControlReceipt gate sequence must be a non-empty ordered prefix.");
  }
  const receiptDirectory = fs.realpathSync.native(path.dirname(requireFile(receiptPath, "receipt")));
  for (let index = 0; index < receipt.gateSequence.length; index += 1) {
    const actual = receipt.gateSequence[index];
    const expected = gateDefinitions[index];
    if (actual.gateId !== expected.gateId
      || actual.command !== expected.command
      || !Number.isInteger(actual.exitCode)) {
      throw new Error("ReadinessControlReceipt gate sequence or result is invalid.");
    }
    if (!sha256Pattern.test(actual.logSha256)) {
      throw new Error(`${actual.gateId} logSha256 is invalid.`);
    }
    const logPath = resolveContainedRef(
      actual.logRef,
      receiptPath,
      receiptDirectory,
      `${actual.gateId} logRef`);
    if (sha256(fs.readFileSync(logPath)) !== actual.logSha256) {
      throw new Error(`${actual.gateId} logSha256 does not match log bytes.`);
    }
  }
  if (receipt.sourceTreeCleanBefore !== true) {
    throw new Error("ReadinessControlReceipt runner must start from a clean source tree.");
  }
  const nonZeroIndices = receipt.gateSequence
    .map((gate, index) => gate.exitCode === 0 ? -1 : index)
    .filter((index) => index >= 0);
  if (nonZeroIndices.length > 1
    || (nonZeroIndices.length === 1
      && nonZeroIndices[0] !== receipt.gateSequence.length - 1)) {
    throw new Error("ReadinessControlReceipt failed gate must be the final recorded gate.");
  }
  const completeZeroExit = receipt.gateSequence.length === gateDefinitions.length
    && nonZeroIndices.length === 0;
  const expectedPassed = completeZeroExit && receipt.sourceTreeCleanAfter === true;
  if ((receipt.verdict === "passed") !== expectedPassed) {
    throw new Error("ReadinessControlReceipt verdict is inconsistent with gates and source stability.");
  }
  if (!expectedPassed
    && nonZeroIndices.length === 0
    && !(completeZeroExit && receipt.sourceTreeCleanAfter === false)) {
    throw new Error("ReadinessControlReceipt failed run has no gate or source-drift cause.");
  }
  const completePassed = expectedPassed;
  if (requirePassed && !completePassed) {
    throw new Error("ReadinessControlReceipt must record a stable clean passed run.");
  }
  if (options.requireCurrentSource !== false) {
    const current = readGitState();
    if (!current.clean || current.revision !== receipt.sourceRevision) {
      throw new Error("ReadinessControlReceipt does not match the current clean source revision.");
    }
  }
  return receipt;
}

export function getReadinessControlReceiptPaths(receipt, receiptPath) {
  const receiptFile = requireFile(receiptPath, "receipt");
  const receiptDirectory = fs.realpathSync.native(path.dirname(receiptFile));
  return [
    receiptFile,
    ...receipt.gateSequence.map((gate) =>
      resolveContainedRef(gate.logRef, receiptFile, receiptDirectory, `${gate.gateId} logRef`))
  ];
}

function readGitState() {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  });
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  });
  if (revision.status !== 0 || status.status !== 0) {
    throw new Error("unable to inspect git source state.");
  }
  return {
    revision: revision.stdout.trim().toLowerCase(),
    clean: status.stdout.trim().length === 0
  };
}

function requireExternalOutputDirectory(value) {
  const resolved = path.resolve(requireText(value, "--out-dir"));
  if (pathIsWithin(canonicalPathThroughExistingAncestor(resolved), repoRoot)) {
    throw new Error("--out-dir must remain outside the repository.");
  }
  fs.mkdirSync(resolved, { recursive: true });
  const canonical = fs.realpathSync.native(resolved);
  const relative = path.relative(normalizePath(repoRoot), normalizePath(canonical));
  if (relative === "" || (!relative.startsWith(`..${path.sep}`)
    && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("--out-dir must remain outside the repository.");
  }
  if (fs.readdirSync(canonical).length !== 0) {
    throw new Error("--out-dir must be empty.");
  }
  return canonical;
}

function canonicalPathThroughExistingAncestor(value) {
  let existing = path.resolve(value);
  const missing = [];
  while (!fs.existsSync(existing)) {
    missing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) {
      break;
    }
    existing = parent;
  }
  return path.join(fs.realpathSync.native(existing), ...missing);
}

function pathIsWithin(value, root) {
  const relative = path.relative(normalizePath(root), normalizePath(value));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative));
}

function resolveContainedRef(reference, ownerPath, allowedRoot, label) {
  if (typeof reference !== "string" || reference.trim().length === 0 || path.isAbsolute(reference)) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const resolved = requireFile(path.resolve(path.dirname(ownerPath), reference), label);
  const relative = path.relative(
    normalizePath(allowedRoot),
    normalizePath(fs.realpathSync.native(resolved)));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the receipt root.`);
  }
  return resolved;
}

function requireCanonicalTimestamp(value, label) {
  const parsed = new Date(value);
  if (typeof value !== "string"
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC ISO-8601 timestamp.`);
  }
}

function requireFile(value, label) {
  const resolved = path.resolve(requireText(value, label));
  if (!fs.existsSync(resolved)
    || fs.lstatSync(resolved).isSymbolicLink()
    || !fs.statSync(resolved).isFile()
    || fs.statSync(resolved).nlink !== 1) {
    throw new Error(`${label} file not found: ${resolved}`);
  }
  return resolved;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir") {
      options.outputDirectory = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      return null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    return;
  }
  const result = runReadinessControlGates(options);
  process.stdout.write(`${result.receiptPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
