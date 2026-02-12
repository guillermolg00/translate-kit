import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
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

export async function writeTranslationSplit(
  dir: string,
  flatEntries: Record<string, string>,
): Promise<void> {
  await mkdir(dir, { recursive: true });

  const byNamespace = new Map<string, Record<string, string>>();

  for (const [key, value] of Object.entries(flatEntries)) {
    const dot = key.indexOf(".");
    if (dot > 0) {
      const ns = key.slice(0, dot);
      const restKey = key.slice(dot + 1);
      if (!byNamespace.has(ns)) byNamespace.set(ns, {});
      byNamespace.get(ns)![restKey] = value;
    } else {
      // Keys without a namespace go into a root namespace file
      if (!byNamespace.has("_root")) byNamespace.set("_root", {});
      byNamespace.get("_root")![key] = value;
    }
  }

  for (const [ns, entries] of byNamespace) {
    const filePath = join(dir, `${ns}.json`);
    const nested = unflatten(entries);
    const content = JSON.stringify(nested, null, 2) + "\n";
    await writeFile(filePath, content, "utf-8");
  }

  // Remove stale namespace files
  const currentFiles = new Set(
    [...byNamespace.keys()].map((ns) => `${ns}.json`),
  );
  let existing: string[];
  try {
    existing = await readdir(dir);
  } catch {
    return;
  }
  for (const file of existing) {
    if (file.endsWith(".json") && !currentFiles.has(file)) {
      await unlink(join(dir, file));
    }
  }
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
