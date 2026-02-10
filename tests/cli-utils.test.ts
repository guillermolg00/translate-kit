import { describe, it, expect } from "vitest";
import { parseTranslateFlags, validateLocale } from "../src/cli-utils.js";

describe("parseTranslateFlags", () => {
  it("returns all false/empty when no flags given", () => {
    expect(parseTranslateFlags([])).toEqual({
      dryRun: false,
      force: false,
      verbose: false,
      locale: "",
    });
  });

  it("parses --dry-run", () => {
    const result = parseTranslateFlags(["--dry-run"]);
    expect(result.dryRun).toBe(true);
    expect(result.force).toBe(false);
    expect(result.verbose).toBe(false);
  });

  it("parses --force", () => {
    const result = parseTranslateFlags(["--force"]);
    expect(result.force).toBe(true);
    expect(result.dryRun).toBe(false);
  });

  it("parses --verbose", () => {
    const result = parseTranslateFlags(["--verbose"]);
    expect(result.verbose).toBe(true);
  });

  it("parses --locale with value", () => {
    const result = parseTranslateFlags(["--locale", "es"]);
    expect(result.locale).toBe("es");
  });

  it("parses --locale without value to empty string", () => {
    const result = parseTranslateFlags(["--locale"]);
    expect(result.locale).toBe("");
  });

  it("parses multiple flags combined", () => {
    const result = parseTranslateFlags([
      "--dry-run",
      "--force",
      "--verbose",
      "--locale",
      "pt-BR",
    ]);
    expect(result).toEqual({
      dryRun: true,
      force: true,
      verbose: true,
      locale: "pt-BR",
    });
  });
});

describe("validateLocale", () => {
  it.each(["es", "pt-BR", "zh_Hans", "en123"])("accepts valid locale %s", (locale) => {
    expect(validateLocale(locale)).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(validateLocale("../etc/passwd")).toBe(false);
  });

  it("rejects nested path traversal", () => {
    expect(validateLocale("es/../../foo")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateLocale("")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(validateLocale("locale with spaces")).toBe(false);
  });

  it("rejects shell injection", () => {
    expect(validateLocale("es;rm -rf")).toBe(false);
  });
});
