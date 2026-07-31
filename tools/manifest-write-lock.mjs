import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const physicalLockDirectory = path.join(os.tmpdir(), "classroom-toolkit-delivery-manifest-locks");

export function manifestWriteLockPath(manifestPath) {
  return manifestWriteLockPaths(manifestPath)[0];
}

export function manifestWriteLockPaths(manifestPath) {
  assertManifestPathIsNotSymbolicLink(manifestPath);
  const canonicalManifestPath = canonicalPath(manifestPath);
  const lockPaths = [`${canonicalManifestPath}.delivery-manifest-write.lock`];
  const physicalIdentity = readPhysicalIdentity(canonicalManifestPath);
  if (physicalIdentity) {
    const digest = crypto.createHash("sha256").update(physicalIdentity).digest("hex");
    lockPaths.push(path.join(physicalLockDirectory, `${digest}.lock`));
  }
  return [...new Set(lockPaths)];
}

export function withManifestWriteLock(manifestPath, action) {
  assertManifestPathIsNotSymbolicLink(manifestPath);
  const canonicalManifestPath = canonicalPath(manifestPath);
  const physicalIdentity = readPhysicalIdentity(canonicalManifestPath);
  const acquired = [];

  try {
    for (const lockPath of manifestWriteLockPaths(canonicalManifestPath)) {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      const owner = {
        schemaVersion: "1.0",
        kind: "delivery-manifest-write-lock",
        ownerPid: process.pid,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString(),
        token: crypto.randomUUID(),
        manifestPath: canonicalManifestPath,
        physicalIdentity
      };
      acquired.push({ lockPath, owner, handle: createLock(lockPath, owner) });
    }
    return action();
  } finally {
    for (const entry of acquired.reverse()) {
      fs.closeSync(entry.handle);
      removeOwnedLock(entry.lockPath, entry.owner.token);
    }
  }
}

export function assertManifestPathIsNotSymbolicLink(manifestPath, lstat = fs.lstatSync) {
  const resolvedPath = path.resolve(manifestPath);
  try {
    if (lstat(resolvedPath).isSymbolicLink()) {
      throw new Error(`Delivery manifest path must not be a symbolic link: ${resolvedPath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function createLock(lockPath, owner) {
  let handle;
  try {
    handle = fs.openSync(lockPath, "wx");
    fs.writeFileSync(handle, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
    fs.fsyncSync(handle);
    return handle;
  } catch (error) {
    if (handle !== undefined) {
      fs.closeSync(handle);
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    }
    if (error?.code === "EEXIST") {
      throw new Error(`Delivery manifest write lock is unavailable: ${lockPath}`, { cause: error });
    }
    throw new Error(`Unable to create delivery manifest write lock: ${lockPath}`, { cause: error });
  }
}

function canonicalPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    return fs.realpathSync.native(resolvedPath);
  }
  const parentPath = path.dirname(resolvedPath);
  const canonicalParent = fs.existsSync(parentPath)
    ? fs.realpathSync.native(parentPath)
    : path.resolve(parentPath);
  return path.join(canonicalParent, path.basename(resolvedPath));
}

function readPhysicalIdentity(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const stat = fs.statSync(filePath, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
}

function removeOwnedLock(lockPath, token) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (owner?.token === token) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // A missing or replaced lock is never removed by this owner.
  }
}
