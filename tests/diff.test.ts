import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeDiff, hashValue, loadJsonFile, loadLockFile } from "../src/diff.js";

describe("hashValue", () => {
  it("returns a 16-char hex string", () => {
    const hash = hashValue("hello");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("returns same hash for same value", () => {
    expect(hashValue("hello")).toBe(hashValue("hello"));
  });

  it("returns different hash for different values", () => {
    expect(hashValue("hello")).not.toBe(hashValue("world"));
  });
});

describe("computeDiff", () => {
  it("detects added keys", () => {
    const source = { "app.title": "Hello", "app.new": "New feature" };
    const target = { "app.title": "Hola" };
    const lock = { "app.title": hashValue("Hello") };

    const result = computeDiff(source, target, lock);

    expect(result.added).toEqual({ "app.new": "New feature" });
    expect(result.unchanged).toEqual({ "app.title": "Hola" });
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
  });

  it("detects modified keys", () => {
    const source = { "app.title": "Hello Updated" };
    const target = { "app.title": "Hola" };
    const lock = { "app.title": hashValue("Hello") };

    const result = computeDiff(source, target, lock);

    expect(result.modified).toEqual({ "app.title": "Hello Updated" });
    expect(result.unchanged).toEqual({});
  });

  it("detects removed keys", () => {
    const source = { "app.title": "Hello" };
    const target = { "app.title": "Hola", "app.old": "Old" };
    const lock = { "app.title": hashValue("Hello") };

    const result = computeDiff(source, target, lock);

    expect(result.removed).toEqual(["app.old"]);
    expect(result.unchanged).toEqual({ "app.title": "Hola" });
  });

  it("marks all keys as added when no lock file exists", () => {
    const source = { "app.title": "Hello", "app.sub": "World" };
    const target = { "app.title": "Hola", "app.sub": "Mundo" };
    const lock = {};

    const result = computeDiff(source, target, lock);

    expect(result.modified).toEqual({
      "app.title": "Hello",
      "app.sub": "World",
    });
  });

  it("handles empty source and target", () => {
    const result = computeDiff({}, {}, {});
    expect(result.added).toEqual({});
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual({});
  });

  it("handles first run (no target, no lock)", () => {
    const source = { "app.title": "Hello", "app.sub": "World" };
    const target = {};
    const lock = {};

    const result = computeDiff(source, target, lock);

    expect(result.added).toEqual({ "app.title": "Hello", "app.sub": "World" });
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
  });
});

describe("loadJsonFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "diff-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns parsed JSON from existing file", async () => {
    const filePath = join(tempDir, "data.json");
    await writeFile(filePath, JSON.stringify({ key: "value" }), "utf-8");

    const result = await loadJsonFile(filePath);
    expect(result).toEqual({ key: "value" });
  });

  it("returns {} if file does not exist", async () => {
    const result = await loadJsonFile(join(tempDir, "missing.json"));
    expect(result).toEqual({});
  });

  it("throws on invalid JSON", async () => {
    const filePath = join(tempDir, "bad.json");
    await writeFile(filePath, "not json{", "utf-8");

    await expect(loadJsonFile(filePath)).rejects.toThrow("Failed to load");
  });
});

describe("loadLockFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "diff-lock-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns lock data from existing file", async () => {
    const lockData = { "app.title": "abc123" };
    await writeFile(
      join(tempDir, ".translate-lock.json"),
      JSON.stringify(lockData),
      "utf-8",
    );

    const result = await loadLockFile(tempDir);
    expect(result).toEqual(lockData);
  });

  it("returns {} if lock file does not exist", async () => {
    const result = await loadLockFile(tempDir);
    expect(result).toEqual({});
  });

  it("throws on invalid JSON in lock file", async () => {
    await writeFile(
      join(tempDir, ".translate-lock.json"),
      "{broken",
      "utf-8",
    );

    await expect(loadLockFile(tempDir)).rejects.toThrow("Failed to load lock file");
  });
});
