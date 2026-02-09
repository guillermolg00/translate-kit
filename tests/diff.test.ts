import { describe, it, expect } from "vitest";
import { computeDiff, hashValue } from "../src/diff.js";

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
