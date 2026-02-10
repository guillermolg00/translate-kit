import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiffResult, LockFile } from "./types.js";

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isFileNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export async function loadJsonFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (isFileNotFound(err)) return {};
    throw new Error(
      `Failed to load ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function loadLockFile(messagesDir: string): Promise<LockFile> {
  const lockPath = join(messagesDir, ".translate-lock.json");
  try {
    const content = await readFile(lockPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (isFileNotFound(err)) return {};
    throw new Error(
      `Failed to load lock file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function computeDiff(
  sourceFlat: Record<string, string>,
  targetFlat: Record<string, string>,
  lockData: LockFile,
): DiffResult {
  const added: Record<string, string> = {};
  const modified: Record<string, string> = {};
  const removed: string[] = [];
  const unchanged: Record<string, string> = {};

  for (const [key, value] of Object.entries(sourceFlat)) {
    const currentHash = hashValue(value);
    const lockedHash = lockData[key];

    if (!(key in targetFlat)) {
      added[key] = value;
    } else if (!lockedHash || lockedHash !== currentHash) {
      modified[key] = value;
    } else {
      unchanged[key] = targetFlat[key];
    }
  }

  for (const key of Object.keys(targetFlat)) {
    if (!(key in sourceFlat)) {
      removed.push(key);
    }
  }

  return { added, modified, removed, unchanged };
}