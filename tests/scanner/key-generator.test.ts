import { describe, it, expect } from "vitest";
import { generateKey } from "../../src/scanner/key-generator.js";
import type { ExtractedString } from "../../src/types.js";

function makeExtracted(overrides: Partial<ExtractedString> = {}): ExtractedString {
  return {
    text: "Hello world",
    type: "jsx-text",
    file: "src/App.tsx",
    line: 1,
    column: 0,
    ...overrides,
  };
}

describe("generateKey", () => {
  describe("hash strategy", () => {
    it("generates a 12-char hex key", () => {
      const key = generateKey(makeExtracted(), "hash");
      expect(key).toHaveLength(12);
      expect(key).toMatch(/^[0-9a-f]+$/);
    });

    it("generates same key for same text", () => {
      const a = generateKey(makeExtracted({ text: "Save" }), "hash");
      const b = generateKey(makeExtracted({ text: "Save" }), "hash");
      expect(a).toBe(b);
    });

    it("generates different keys for different text", () => {
      const a = generateKey(makeExtracted({ text: "Save" }), "hash");
      const b = generateKey(makeExtracted({ text: "Cancel" }), "hash");
      expect(a).not.toBe(b);
    });

    it("is stable across different files/components", () => {
      const a = generateKey(
        makeExtracted({ text: "Save", file: "a.tsx", componentName: "A" }),
        "hash",
      );
      const b = generateKey(
        makeExtracted({ text: "Save", file: "b.tsx", componentName: "B" }),
        "hash",
      );
      expect(a).toBe(b);
    });
  });

  describe("path strategy", () => {
    it("uses component name and parent tag", () => {
      const key = generateKey(
        makeExtracted({
          text: "Hello world",
          componentName: "Hero",
          parentTag: "h1",
        }),
        "path",
      );
      expect(key).toBe("Hero.h1.hello_world");
    });

    it("works without component name", () => {
      const key = generateKey(
        makeExtracted({
          text: "Click me",
          componentName: undefined,
          parentTag: "button",
        }),
        "path",
      );
      expect(key).toBe("button.click_me");
    });

    it("works without parent tag", () => {
      const key = generateKey(
        makeExtracted({
          text: "Hello",
          componentName: "App",
          parentTag: undefined,
        }),
        "path",
      );
      expect(key).toBe("App.hello");
    });

    it("truncates long slugs", () => {
      const key = generateKey(
        makeExtracted({
          text: "This is a very long text that should be truncated to keep keys manageable",
          componentName: "Page",
          parentTag: "p",
        }),
        "path",
      );
      // Slug is max 32 chars
      const slug = key.split(".").pop()!;
      expect(slug.length).toBeLessThanOrEqual(32);
    });
  });
});
