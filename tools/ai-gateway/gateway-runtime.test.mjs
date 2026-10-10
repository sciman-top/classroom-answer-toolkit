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

test("a malformed lease is honored for the grace window, then reclaimable", async () => {
  const { acquireSharedExecutionSlot } = await import(pathToFileURL(path.join(toolDir, "gateway-runtime.mjs")).href);
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-lease-malformed-"));
  try {
    // A crash between create and write leaves an empty or partial file. A live
    // creator may still be filling it, so the grace window must protect it.
    const leaseFilePath = plantLease(runtimeDirectory, 1, {});
    const firstAttempt = await acquireSharedExecutionSlot(runtimeConfig(runtimeDirectory), [1], 300);
    assert.equal(firstAttempt, null, "a just-created malformed lease must not be reclaimed inside the grace window");

    const stale = new Date(Date.now() - 60_000);
    fs.utimesSync(leaseFilePath, stale, stale);
    const lease = await acquireSharedExecutionSlot(runtimeConfig(runtimeDirectory), [1], 1_000);
    assert.ok(lease, "an old malformed lease must be reclaimable");
    lease.release();
  } finally {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});

test("preset health lock is exclusive and honors expiry", async () => {
  const { acquirePresetHealthLock } = await import(pathToFileURL(path.join(toolDir, "gateway-runtime.mjs")).href);
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-health-lock-"));
  try {
    const config = runtimeConfig(runtimeDirectory);
    const holder = acquirePresetHealthLock(config, 2_000);
    assert.ok(holder, "first acquirer must take the lock");

    // A second acquirer in the same or another process must not slip in while
    // the lock is live; it waits out its (short) timeout instead.
    const startedAt = Date.now();
    const contender = acquirePresetHealthLock(config, 300);
    assert.equal(contender, null, "a live health lock must not be double-acquired");
    assert.ok(Date.now() - startedAt >= 250, "the contender must actually wait");

    // A crashed holder's expired lock file is reclaimable, and the recovered
    // lock still excludes later acquirers until released.
    const lockFilePath = path.join(runtimeDirectory, "preset-health.lock.json");
    const stale = new Date(Date.now() - 60_000);
    fs.utimesSync(lockFilePath, stale, stale);
    fs.writeFileSync(
      lockFilePath,
      JSON.stringify({ token: "stale-health-lock", pid: -1, expiresAt: Date.now() - 60_000 }),
      "utf8");
    const recovered = acquirePresetHealthLock(config, 2_000);
    assert.ok(recovered, "an expired health lock must be reclaimable");
    const latecomer = acquirePresetHealthLock(config, 200);
    assert.equal(latecomer, null, "the recovered lock must exclude later acquirers");

    recovered.release();
    const successor = acquirePresetHealthLock(config, 2_000);
    assert.ok(successor, "the lock must be acquirable after release");
    successor.release();
  } finally {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});

test("lease release tolerates transient Windows file locks instead of discarding the paid result", async () => {
  const { acquireSharedExecutionSlot, releaseLeaseFile, isTransientFileLockError } =
    await import(pathToFileURL(path.join(toolDir, "gateway-runtime.mjs")).href);

  assert.equal(isTransientFileLockError(null), false);
  assert.equal(isTransientFileLockError("EPERM"), false);
  assert.equal(isTransientFileLockError({ code: "ENOENT" }), true);
  assert.equal(isTransientFileLockError({ code: "EPERM" }), true);
  assert.equal(isTransientFileLockError({ code: "EACCES" }), true);
  assert.equal(isTransientFileLockError({ code: "EBUSY" }), true);
  assert.equal(isTransientFileLockError({ code: "ENOSPC" }), false);

  // A vanished lease is the historical contract: release is a no-op.
  releaseLeaseFile(path.join(os.tmpdir(), `gateway-gone-${process.pid}-${Date.now()}.json`));

  // On Windows, unlinking a non-empty directory raises EPERM — the same error
  // class an AV scan produces on a fresh lease file. Release must swallow it;
  // a throw here would replace the already-successful provider result in the
  // caller's finally. (CI runs windows-latest; elsewhere the EPERM branch of
  // the predicate above is the portable proof.)
  if (process.platform === "win32") {
    const lockedPath = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-locked-"));
    try {
      fs.writeFileSync(path.join(lockedPath, "content.txt"), "av holds the lease like this");
      releaseLeaseFile(lockedPath);
    } finally {
      fs.rmSync(lockedPath, { recursive: true, force: true });
    }
  }

  // End-to-end: acquire a real lease, break the unlink, release without throw.
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-release-lock-"));
  try {
    const config = runtimeConfig(runtimeDirectory);
    const lease = await acquireSharedExecutionSlot(config, [1], 1_000);
    assert.ok(lease);
    const leaseFilePath = path.join(runtimeDirectory, "execution-slots", "slot-1.lease.json");
    assert.equal(fs.existsSync(leaseFilePath), true);
    if (process.platform === "win32") {
      fs.unlinkSync(leaseFilePath);
      fs.mkdirSync(leaseFilePath);
      fs.writeFileSync(path.join(leaseFilePath, "held.txt"), "locked");
      assert.doesNotThrow(() => lease.release());
    } else {
      lease.release();
    }
  } finally {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});
