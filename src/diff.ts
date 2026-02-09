import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { flatten } from "./flatten.js";
import type { DiffResult, LockFile } from "./types.js";

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function loadJsonFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function loadLockFile(messagesDir: string): Promise<LockFile> {
  const lockPath = join(messagesDir, ".translate-lock.json");
  try {
    const content = await readFile(lockPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
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
      // Key doesn't exist in target — new key
      added[key] = value;
    } else if (!lockedHash || lockedHash !== currentHash) {
      // Source value changed since last translation
      modified[key] = value;
    } else {
      // Source unchanged, translation exists
      unchanged[key] = targetFlat[key];
    }
  }

  // Keys in target that are no longer in source
  for (const key of Object.keys(targetFlat)) {
    if (!(key in sourceFlat)) {
      removed.push(key);
    }
  }

  return { added, modified, removed, unchanged };
}

export async function diff(
  sourceFile: string,
  targetFile: string,
  messagesDir: string,
): Promise<DiffResult> {
  const [sourceRaw, targetRaw, lockData] = await Promise.all([
    loadJsonFile(sourceFile),
    loadJsonFile(targetFile),
    loadLockFile(messagesDir),
  ]);

  const sourceFlat = flatten(sourceRaw);
  const targetFlat = flatten(targetRaw);

  return computeDiff(sourceFlat, targetFlat, lockData);
}
