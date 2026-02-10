import { describe, it, expect } from "vitest";
import {
  shouldIgnore,
  isTranslatableProp,
  isIgnoredTag,
  isContentProperty,
} from "../../src/scanner/filters.js";

describe("shouldIgnore", () => {
  it("ignores empty string", () => {
    expect(shouldIgnore("")).toBe(true);
  });

  it("ignores whitespace-only", () => {
    expect(shouldIgnore("   \n\t  ")).toBe(true);
  });

  it("ignores URLs", () => {
    expect(shouldIgnore("https://example.com")).toBe(true);
    expect(shouldIgnore("http://localhost:3000")).toBe(true);
  });

  it("ignores kebab-case identifiers", () => {
    expect(shouldIgnore("my-component")).toBe(true);
    expect(shouldIgnore("some-long-identifier")).toBe(true);
  });

  it("ignores CONSTANT_CASE", () => {
    expect(shouldIgnore("MAX_RETRIES")).toBe(true);
    expect(shouldIgnore("API")).toBe(true);
  });

  it("ignores numbers and currency", () => {
    expect(shouldIgnore("$99.99")).toBe(true);
    expect(shouldIgnore("100%")).toBe(true);
    expect(shouldIgnore("3.14")).toBe(true);
  });

  it("ignores strings with no letters (symbols, emoji)", () => {
    expect(shouldIgnore("---")).toBe(true);
    expect(shouldIgnore("🎉🎊")).toBe(true);
    expect(shouldIgnore("***")).toBe(true);
  });

  it("does not ignore normal text", () => {
    expect(shouldIgnore("Submit")).toBe(false);
    expect(shouldIgnore("Hello world")).toBe(false);
  });

  it("does not ignore text with numbers", () => {
    expect(shouldIgnore("Step 1")).toBe(false);
  });

  it("does not ignore CJK text", () => {
    expect(shouldIgnore("ようこそ")).toBe(false);
  });

  it("does not ignore accented text", () => {
    expect(shouldIgnore("Hola mundo")).toBe(false);
  });
});

describe("isTranslatableProp", () => {
  it("returns true for default translatable props", () => {
    expect(isTranslatableProp("placeholder")).toBe(true);
    expect(isTranslatableProp("alt")).toBe(true);
    expect(isTranslatableProp("aria-label")).toBe(true);
    expect(isTranslatableProp("title")).toBe(true);
    expect(isTranslatableProp("label")).toBe(true);
  });

  it("returns false for NEVER_TRANSLATE props", () => {
    expect(isTranslatableProp("className")).toBe(false);
    expect(isTranslatableProp("href")).toBe(false);
    expect(isTranslatableProp("onClick")).toBe(false);
    expect(isTranslatableProp("data-testid")).toBe(false);
    expect(isTranslatableProp("style")).toBe(false);
    expect(isTranslatableProp("key")).toBe(false);
  });

  it("returns true for custom props when provided", () => {
    expect(isTranslatableProp("custom", ["custom"])).toBe(true);
  });

  it("default props do not apply when customProps given", () => {
    expect(isTranslatableProp("placeholder", ["custom"])).toBe(false);
  });

  it("NEVER_TRANSLATE wins over customProps", () => {
    expect(isTranslatableProp("className", ["className"])).toBe(false);
    expect(isTranslatableProp("href", ["href"])).toBe(false);
  });
});

describe("isIgnoredTag", () => {
  it("returns true for ignored tags", () => {
    expect(isIgnoredTag("script")).toBe(true);
    expect(isIgnoredTag("style")).toBe(true);
    expect(isIgnoredTag("code")).toBe(true);
    expect(isIgnoredTag("pre")).toBe(true);
    expect(isIgnoredTag("svg")).toBe(true);
    expect(isIgnoredTag("path")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isIgnoredTag("Script")).toBe(true);
    expect(isIgnoredTag("STYLE")).toBe(true);
    expect(isIgnoredTag("SVG")).toBe(true);
  });

  it("returns false for normal tags", () => {
    expect(isIgnoredTag("div")).toBe(false);
    expect(isIgnoredTag("button")).toBe(false);
    expect(isIgnoredTag("span")).toBe(false);
  });
});

describe("isContentProperty", () => {
  it("returns true for content property names", () => {
    expect(isContentProperty("title")).toBe(true);
    expect(isContentProperty("description")).toBe(true);
    expect(isContentProperty("label")).toBe(true);
    expect(isContentProperty("text")).toBe(true);
    expect(isContentProperty("placeholder")).toBe(true);
    expect(isContentProperty("alt")).toBe(true);
    expect(isContentProperty("content")).toBe(true);
    expect(isContentProperty("heading")).toBe(true);
  });

  it("returns false for non-content properties", () => {
    expect(isContentProperty("icon")).toBe(false);
    expect(isContentProperty("className")).toBe(false);
    expect(isContentProperty("href")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isContentProperty("Title")).toBe(false);
    expect(isContentProperty("DESCRIPTION")).toBe(false);
  });
});
