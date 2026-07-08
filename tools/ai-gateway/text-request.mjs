import path from "node:path";
import {
  assertLiveEgressAllowed,
  loadGatewayConfig,
  requestTextWithFailover,
  requireValue,
  repoRoot
} from "./validate-config.mjs";

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/ai-gateway run request:text -- --allow-cloud-egress --prompt \"Return exactly OK.\"",
    "",
    "Options:",
    "  --config-env-file <path>       Env file to read; defaults to .env",
    "  --allow-cloud-egress           Required for live requests",
    "  --prompt <text>                Synthetic text prompt to send",
    "  --force-primary-failure        Simulate a retryable primary failure, then use fallback",
    "  --timeout-ms <ms>              Per-provider timeout; default 30000",
    "  --json                         Emit JSON summary"
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    envFile: path.join(repoRoot, ".env"),
    allowCloudEgress: false,
    prompt: "Return exactly OK.",
    forcePrimaryFailure: false,
    timeoutMs: 30000,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config-env-file") {
      options.envFile = path.resolve(repoRoot, requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--config-env-file=")) {
      options.envFile = path.resolve(repoRoot, arg.slice("--config-env-file=".length));
      continue;
    }
    if (arg === "--allow-cloud-egress") {
      options.allowCloudEgress = true;
      continue;
    }
    if (arg === "--prompt") {
      options.prompt = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--prompt=")) {
      options.prompt = arg.slice("--prompt=".length);
      continue;
    }
    if (arg === "--force-primary-failure") {
      options.forcePrimaryFailure = true;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000.");
  }

  if (options.prompt.trim().length === 0) {
    throw new Error("--prompt must not be empty.");
  }

  return options;
}

function redactAttempt(attempt) {
  return {
    provider: attempt.provider,
    ok: attempt.ok,
    retryable: attempt.retryable,
    status: attempt.status,
    output: attempt.output ? attempt.output.slice(0, 80) : "",
    error: attempt.error ? attempt.error.slice(0, 240) : ""
  };
}

function printHuman(result) {
  for (const attempt of result.attempts) {
    const status = attempt.status ? ` status=${attempt.status}` : "";
    const retryable = attempt.retryable ? " retryable=true" : " retryable=false";
    const output = attempt.output ? ` output=${attempt.output.slice(0, 80)}` : "";
    const error = attempt.error ? ` error=${attempt.error.slice(0, 240)}` : "";
    console.log(`- attempt ${attempt.provider}: ${attempt.ok ? "ok" : "failed"}${status}${retryable}${output}${error}`);
  }

  console.log(`Text request ${result.ok ? "OK" : "FAILED"} via ${result.provider ?? "none"}.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const loaded = loadGatewayConfig({
    envFile: options.envFile,
    allowMissingSecrets: false
  });
  const { config, validation } = loaded;

  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      console.error(`error: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  assertLiveEgressAllowed(config, options.allowCloudEgress);
  const result = await requestTextWithFailover(config, options);

  if (options.json) {
    console.log(JSON.stringify({
      ok: result.ok,
      provider: result.provider,
      output: result.output ? result.output.slice(0, 80) : "",
      attempts: result.attempts.map(redactAttempt),
      error: result.error ?? ""
    }, null, 2));
  } else {
    printHuman(result);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
