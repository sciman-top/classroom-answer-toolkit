import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));

function runtimeConfig(runtimeDirectory) {
  return { runtimeDirectory };
}

function plantLease(runtimeDirectory, slot, lease) {
  const leaseFilePath = path.join(runtimeDirectory, "execution-slots", `slot-${slot}.lease.json`);
  fs.mkdirSync(path.dirname(leaseFilePath), { recursive: true });
  fs.writeFileSync(leaseFilePath, JSON.stringify(lease));
  return leaseFilePath;
}

function makeWorkerScript() {
  // Each worker imports the real gateway-runtime and records the exact wall
  // clock interval during which it held slot 1, so the test can prove that no
  // two processes ever held the lease concurrently.
  const source = [
    `import { acquireSharedExecutionSlot } from ${JSON.stringify(pathToFileURL(path.join(toolDir, "gateway-runtime.mjs")).href)};`,
    "const [runtimeDirectory, timeoutMs, holdMs] = process.argv.slice(2);",
    "const lease = await acquireSharedExecutionSlot({ runtimeDirectory }, [1], Number(timeoutMs));",
    "if (!lease) {",
    "  console.log(JSON.stringify({ acquired: false }));",
    "  process.exit(0);",
    "}",
    "const started = Date.now();",
    "await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));",
    "lease.release();",
    "console.log(JSON.stringify({ acquired: true, started, ended: Date.now() }));",
    ""
  ].join("\n");
  const workerPath = path.join(os.tmpdir(), `gateway-lease-worker-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(workerPath, source, "utf8");
  return workerPath;
}

async function runWorkers(workerPath, runtimeDirectory, count, timeoutMs, holdMs) {
  const children = Array.from({ length: count }, () =>
    spawn(process.execPath, [workerPath, runtimeDirectory, String(timeoutMs), String(holdMs)], {
      stdio: ["ignore", "pipe", "inherit"]
    }));
  const outputs = await Promise.all(children.map((child) => new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop()));
      } catch (error) {
        reject(error);
      }
    });
    child.on("error", reject);
  })));
  return outputs;
}

test("concurrent waiters reclaiming an expired lease never share the slot", async () => {
  const workerPath = makeWorkerScript();
  const rounds = 3;
  const workerCount = 6;
  try {
    for (let round = 0; round < rounds; round += 1) {
      const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-lease-race-"));
      try {
        plantLease(runtimeDirectory, 1, {
          token: "stale-lease",
          pid: -1,
          slot: 1,
          expiresAt: Date.now() - 60_000
        });

        const results = await runWorkers(workerPath, runtimeDirectory, workerCount, 8_000, 150);
        const intervals = results.filter((result) => result.acquired);
        assert.equal(intervals.length, workerCount, `round ${round}: every worker must eventually acquire`);

        intervals.sort((left, right) => left.started - right.started);
        for (let index = 1; index < intervals.length; index += 1) {
          assert.ok(
            intervals[index].started >= intervals[index - 1].ended - 1,
            `round ${round}: workers ${index - 1} and ${index} held the slot concurrently`
          );
        }
      } finally {
        fs.rmSync(runtimeDirectory, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(workerPath, { force: true });
  }
});

test("a crashed claimant's stale reclaim section is reaped", async () => {
  const { acquireSharedExecutionSlot } = await import(pathToFileURL(path.join(toolDir, "gateway-runtime.mjs")).href);
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-claim-stale-"));
  try {
    plantLease(runtimeDirectory, 1, {
      token: "stale-lease",
      pid: -1,
      slot: 1,
      expiresAt: Date.now() - 60_000
    });
    const claimDirectory = path.join(runtimeDirectory, "execution-slots", "slot-1.claim");
    fs.mkdirSync(claimDirectory, { recursive: true });
    fs.writeFileSync(path.join(claimDirectory, "leftover.txt"), "crashed claimant");
    const stale = new Date(Date.now() - 60_000);
    fs.utimesSync(claimDirectory, stale, stale);

    const config = runtimeConfig(runtimeDirectory);
    const lease = await acquireSharedExecutionSlot(config, [1], 3_000);
    assert.ok(lease, "acquire must succeed after reaping the stale claim section");
    lease.release();
    assert.equal(fs.existsSync(claimDirectory), false, "reclaim section must be released");
  } finally {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});

test("a fresh lease is never stolen by a waiting acquirer", async () => {
  const { acquireSharedExecutionSlot } = await import(pathToFileURL(path.join(toolDir, "gateway-runtime.mjs")).href);
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-lease-fresh-"));
  try {
    const config = runtimeConfig(runtimeDirectory);
    const holder = await acquireSharedExecutionSlot(config, [1], 1_000);
    assert.ok(holder);

    const startedAt = Date.now();
    const waiter = await acquireSharedExecutionSlot(config, [1], 400);
    assert.equal(waiter, null, "a live holder's lease must not be reclaimed");
    assert.ok(Date.now() - startedAt >= 350, "the waiter must actually wait out its timeout");

    holder.release();
    const successor = await acquireSharedExecutionSlot(config, [1], 1_000);
    assert.ok(successor, "the slot must be acquirable after release");
    successor.release();
  } finally {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});
