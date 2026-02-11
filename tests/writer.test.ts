import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, existsSync } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync as existsSyncFs } from "node:fs";
import { writeTranslation, writeTranslationSplit, writeLockFile } from "../src/writer.js";
import { hashValue } from "../src/diff.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "writer-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("writeTranslation", () => {
  it("writes nested JSON by default", async () => {
    const filePath = join(tempDir, "en.json");
    await writeTranslation(filePath, { "a.b": "x", "a.c": "y" });

    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({ a: { b: "x", c: "y" } });
  });

  it("writes flat JSON with { flat: true }", async () => {
    const filePath = join(tempDir, "en.json");
    await writeTranslation(filePath, { "a.b": "x" }, { flat: true });

    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({ "a.b": "x" });
  });

  it("creates parent directories recursively", async () => {
    const filePath = join(tempDir, "deep", "nested", "en.json");
    await writeTranslation(filePath, { key: "value" });

    const content = await readFile(filePath, "utf-8");
    expect(JSON.parse(content)).toEqual({ key: "value" });
  });

  it("ends with newline", async () => {
    const filePath = join(tempDir, "en.json");
    await writeTranslation(filePath, { key: "value" });

    const content = await readFile(filePath, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("overwrites existing file", async () => {
    const filePath = join(tempDir, "en.json");
    await writeTranslation(filePath, { old: "data" });
    await writeTranslation(filePath, { new: "data" });

    const content = await readFile(filePath, "utf-8");
    expect(JSON.parse(content)).toEqual({ new: "data" });
  });
});

describe("writeTranslationSplit", () => {
  it("splits entries by namespace into separate files", async () => {
    const dir = join(tempDir, "en");
    await writeTranslationSplit(dir, {
      "hero.welcome": "Welcome",
      "hero.getStarted": "Get started",
      "common.save": "Save",
    });

    const heroJson = JSON.parse(await readFile(join(dir, "hero.json"), "utf-8"));
    expect(heroJson).toEqual({ welcome: "Welcome", getStarted: "Get started" });

    const commonJson = JSON.parse(await readFile(join(dir, "common.json"), "utf-8"));
    expect(commonJson).toEqual({ save: "Save" });
  });

  it("unflattens nested keys within namespace", async () => {
    const dir = join(tempDir, "en");
    await writeTranslationSplit(dir, {
      "settings.profile.title": "Profile",
      "settings.profile.name": "Name",
    });

    const settingsJson = JSON.parse(await readFile(join(dir, "settings.json"), "utf-8"));
    expect(settingsJson).toEqual({ profile: { title: "Profile", name: "Name" } });
  });

  it("puts keys without namespace in _root.json", async () => {
    const dir = join(tempDir, "en");
    await writeTranslationSplit(dir, {
      greeting: "Hello",
      "hero.welcome": "Welcome",
    });

    const rootJson = JSON.parse(await readFile(join(dir, "_root.json"), "utf-8"));
    expect(rootJson).toEqual({ greeting: "Hello" });

    const heroJson = JSON.parse(await readFile(join(dir, "hero.json"), "utf-8"));
    expect(heroJson).toEqual({ welcome: "Welcome" });
  });

  it("creates directory if it does not exist", async () => {
    const dir = join(tempDir, "deep", "nested", "en");
    await writeTranslationSplit(dir, { "ns.key": "value" });

    const nsJson = JSON.parse(await readFile(join(dir, "ns.json"), "utf-8"));
    expect(nsJson).toEqual({ key: "value" });
  });

  it("removes stale namespace files on rewrite", async () => {
    const dir = join(tempDir, "en");

    // First write: hero + common
    await writeTranslationSplit(dir, {
      "hero.welcome": "Welcome",
      "common.save": "Save",
    });
    expect(existsSyncFs(join(dir, "hero.json"))).toBe(true);
    expect(existsSyncFs(join(dir, "common.json"))).toBe(true);

    // Second write: only common
    await writeTranslationSplit(dir, {
      "common.save": "Save",
    });
    expect(existsSyncFs(join(dir, "common.json"))).toBe(true);
    expect(existsSyncFs(join(dir, "hero.json"))).toBe(false);
  });
});

describe("writeLockFile", () => {
  it("writes hashes for translated keys", async () => {
    const sourceFlat = { "app.title": "Hello", "app.sub": "World" };
    await writeLockFile(tempDir, sourceFlat, {}, ["app.title", "app.sub"]);

    const lockPath = join(tempDir, ".translate-lock.json");
    const content = JSON.parse(await readFile(lockPath, "utf-8"));
    expect(content["app.title"]).toBe(hashValue("Hello"));
    expect(content["app.sub"]).toBe(hashValue("World"));
  });

  it("preserves existing entries for non-translated keys", async () => {
    const sourceFlat = { "app.title": "Hello", "app.sub": "World" };
    const existingLock = { "app.sub": hashValue("World") };
    await writeLockFile(tempDir, sourceFlat, existingLock, ["app.title"]);

    const lockPath = join(tempDir, ".translate-lock.json");
    const content = JSON.parse(await readFile(lockPath, "utf-8"));
    expect(content["app.title"]).toBe(hashValue("Hello"));
    expect(content["app.sub"]).toBe(hashValue("World"));
  });

  it("removes keys no longer in source", async () => {
    const sourceFlat = { "app.title": "Hello" };
    const existingLock = {
      "app.title": hashValue("Hello"),
      "app.removed": hashValue("Gone"),
    };
    await writeLockFile(tempDir, sourceFlat, existingLock, []);

    const lockPath = join(tempDir, ".translate-lock.json");
    const content = JSON.parse(await readFile(lockPath, "utf-8"));
    expect(content).not.toHaveProperty("app.removed");
    expect(content["app.title"]).toBe(hashValue("Hello"));
  });

  it("creates directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "messages", "deep");
    const sourceFlat = { key: "value" };
    await writeLockFile(nestedDir, sourceFlat, {}, ["key"]);

    const lockPath = join(nestedDir, ".translate-lock.json");
    const content = JSON.parse(await readFile(lockPath, "utf-8"));
    expect(content["key"]).toBe(hashValue("value"));
  });
});
