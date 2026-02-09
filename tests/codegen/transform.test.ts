import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "../../src/scanner/parser.js";
import { transform } from "../../src/codegen/transform.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

const textToKey: Record<string, string> = {
  "Welcome to our platform": "hero.welcome",
  "Get started with your journey today": "hero.getStarted",
  "Sign up now": "common.signUp",
  "Search...": "common.searchPlaceholder",
};

describe("codegen transform", () => {
  it("wraps JSX text with t() calls", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(4);
    expect(result.code).toContain('t("hero.welcome")');
    expect(result.code).toContain('t("hero.getStarted")');
    expect(result.code).toContain('t("common.signUp")');
    expect(result.code).toContain('t("common.searchPlaceholder")');
  });

  it("injects useTranslations import", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey);

    expect(result.code).toContain(
      'import { useTranslations } from "next-intl"',
    );
  });

  it("injects const t = useTranslations()", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey);

    expect(result.code).toContain("const t = useTranslations()");
  });

  it("is idempotent - does not double-wrap t() calls", () => {
    const code = readFileSync(
      join(fixturesDir, "already-wrapped.tsx"),
      "utf-8",
    );
    const ast = parseFile(code, "already-wrapped.tsx");
    const result = transform(ast, textToKey);

    expect(result.stringsWrapped).toBe(0);
    expect(result.modified).toBe(false);
  });

  it("does not modify files without matching strings", () => {
    const code = `export default function Other() { return <div>No match</div>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.modified).toBe(false);
    expect(result.stringsWrapped).toBe(0);
  });

  it("wraps attribute strings", () => {
    const code = `function Form() { return <input placeholder="Search..." />; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.modified).toBe(true);
    expect(result.code).toContain('placeholder={t("common.searchPlaceholder")}');
  });

  it("uses custom i18nImport", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey, {
      i18nImport: "my-i18n-lib",
    });

    expect(result.code).toContain(
      'import { useTranslations } from "my-i18n-lib"',
    );
  });

  it("does not wrap text with mixed children", () => {
    const code = `function Greeting({ name }) { return <p>Hello {name}</p>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { Hello: "greeting.hello" };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(0);
    expect(result.modified).toBe(false);
  });
});
