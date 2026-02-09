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

  it("wraps text in mixed content and preserves whitespace", () => {
    const code = `function Greeting({ name }) { return <p>Hello {name}</p>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { Hello: "greeting.hello" };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(1);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('t("greeting.hello")');
  });

  it("wraps text after nested elements", () => {
    const code = `function Def() { return <li><strong>Term</strong>: a definition here.</li>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { ": a definition here.": "page.definition" };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(1);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('t("page.definition")');
  });

  it("wraps text before components in mixed content", () => {
    const code = `function CTA() { return <Button>Meet Mimir <ArrowRight /></Button>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { "Meet Mimir": "cta.meetMimir" };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(1);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('t("cta.meetMimir")');
  });

  it("wraps strings in object property values", () => {
    const code = `function Features() {
      const items = [
        { icon: Star, title: "Project Management", description: "Manage your projects." },
        { icon: Bolt, title: "Task Management", description: "Organize your tasks." },
      ];
      return <div>{items.map(i => <Card key={i.title} {...i} />)}</div>;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Project Management": "features.projectManagement",
      "Manage your projects.": "features.projectManagementDesc",
      "Task Management": "features.taskManagement",
      "Organize your tasks.": "features.taskManagementDesc",
    };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(4);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('title: t("features.projectManagement")');
    expect(result.code).toContain('description: t("features.projectManagementDesc")');
    expect(result.code).toContain('title: t("features.taskManagement")');
    expect(result.code).toContain('description: t("features.taskManagementDesc")');
  });

  it("does not wrap non-content object properties", () => {
    const code = `function App() {
      const config = { icon: "star", className: "text-red", href: "/about" };
      return <div />;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = { star: "icon.star", "text-red": "class.red", "/about": "link.about" };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(0);
    expect(result.modified).toBe(false);
  });

  it("does not wrap module-level object properties like metadata", () => {
    const code = `
      export const metadata = {
        title: "My App",
        description: "A great application for everyone.",
      };
      export default function Layout({ children }) { return <div>{children}</div>; }
    `;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "My App": "meta.title",
      "A great application for everyone.": "meta.description",
    };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(0);
    expect(result.modified).toBe(false);
  });
});
