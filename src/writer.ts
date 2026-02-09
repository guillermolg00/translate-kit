import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { unflatten } from "./flatten.js";
import { hashValue } from "./diff.js";
import type { LockFile } from "./types.js";

export async function writeTranslation(
  filePath: string,
  flatEntries: Record<string, string>,
  options?: { flat?: boolean },
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const data = options?.flat ? flatEntries : unflatten(flatEntries);
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFile(filePath, content, "utf-8");
}

export async function writeLockFile(
  messagesDir: string,
  sourceFlat: Record<string, string>,
  existingLock: LockFile,
  translatedKeys: string[],
): Promise<void> {
  const lock: LockFile = { ...existingLock };

  for (const key of translatedKeys) {
    if (key in sourceFlat) {
      lock[key] = hashValue(sourceFlat[key]);
    }
  }

  // Remove keys that no longer exist in source
  for (const key of Object.keys(lock)) {
    if (!(key in sourceFlat)) {
      delete lock[key];
    }
  }

  const lockPath = join(messagesDir, ".translate-lock.json");
  await mkdir(dirname(lockPath), { recursive: true });
  const content = JSON.stringify(lock, null, 2) + "\n";
  await writeFile(lockPath, content, "utf-8");
}
