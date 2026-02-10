import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTranslation, writeLockFile } from "../src/writer.js";
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
