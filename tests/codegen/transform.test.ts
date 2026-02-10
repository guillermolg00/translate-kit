import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "../../src/scanner/parser.js";
import { transform, type TransformOptions } from "../../src/codegen/transform.js";

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

  it("does not transform object properties inside non-component callbacks", () => {
    const code = `const MyMark = SomeLib.create(() => {
      return { title: "Project Management" };
    });
    function App() { return <div />; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { "Project Management": "features.projectManagement" };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(0);
    expect(result.modified).toBe(false);
    expect(result.code).toContain('title: "Project Management"');
  });

  it("injects t into each component that needs it in multi-component files", () => {
    const code = `function Header() {
  return <h1>Welcome to our platform</h1>;
}
function Footer() {
  return <p>Sign up now</p>;
}`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.stringsWrapped).toBe(2);
    expect(result.code).toMatch(/function Header\(\) \{\s*const t = useTranslations\(\)/);
    expect(result.code).toMatch(/function Footer\(\) \{\s*const t = useTranslations\(\)/);
  });

  it("injects t only into components that need it, not pre-existing ones", () => {
    const code = `import { useTranslations } from "next-intl";
function Header() {
  const t = useTranslations();
  return <h1>{t("existing.key")}</h1>;
}
function Footer() {
  return <p>Sign up now</p>;
}`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.stringsWrapped).toBe(1);
    // Footer gets t injected
    expect(result.code).toMatch(/function Footer\(\) \{\s*const t = useTranslations\(\)/);
    // Header keeps its existing single t declaration
    const headerMatches = result.code.match(/function Header[\s\S]*?function Footer/);
    const headerTCount = (headerMatches?.[0].match(/useTranslations\(\)/g) || []).length;
    expect(headerTCount).toBe(1);
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

describe("codegen transform (inline mode)", () => {
  const inlineOpts: TransformOptions = {
    mode: "inline",
    componentPath: "@/components/t",
  };

  it("wraps JSX text with <T> components", () => {
    const code = readFileSync(join(fixturesDir, "before-inline.tsx"), "utf-8");
    const ast = parseFile(code, "before-inline.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(4);
    expect(result.code).toContain('<T id="hero.welcome">Welcome to our platform</T>');
    expect(result.code).toContain('<T id="hero.getStarted">Get started with your journey today</T>');
    expect(result.code).toContain('<T id="common.signUp">Sign up now</T>');
  });

  it("wraps attributes with t(text, key) in inline mode", () => {
    const code = readFileSync(join(fixturesDir, "before-inline.tsx"), "utf-8");
    const ast = parseFile(code, "before-inline.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.code).toContain('t("Search...", "common.searchPlaceholder")');
  });

  it("injects T and useT import for client files", () => {
    const code = `"use client";\nexport default function Hero() { return <h1>Welcome to our platform</h1>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.code).toContain('import { T } from "@/components/t"');
  });

  it("injects T and createT import for server files", () => {
    const code = readFileSync(join(fixturesDir, "before-inline.tsx"), "utf-8");
    const ast = parseFile(code, "before-inline.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    // Server file (no "use client" directive)
    expect(result.code).toContain('@/components/t-server');
  });

  it("injects useT hook for client files with attributes", () => {
    const code = `"use client";\nfunction Form() { return <input placeholder="Search..." />; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.code).toContain("useT");
    expect(result.code).toContain("const t = useT()");
  });

  it("injects createT for server files with attributes", () => {
    const code = `function Form() { return <input placeholder="Search..." />; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.code).toContain("createT");
    expect(result.code).toContain("const t = createT()");
  });

  it("is idempotent - does not double-wrap <T> components", () => {
    const code = readFileSync(
      join(fixturesDir, "already-wrapped-inline.tsx"),
      "utf-8",
    );
    const ast = parseFile(code, "already-wrapped-inline.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.stringsWrapped).toBe(0);
    expect(result.modified).toBe(false);
  });

  it("wraps strings in object property values with inline t(text, key)", () => {
    const code = `function Features() {
      const items = [
        { icon: Star, title: "Project Management", description: "Manage your projects." },
      ];
      return <div>{items.map(i => <Card key={i.title} {...i} />)}</div>;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Project Management": "features.projectManagement",
      "Manage your projects.": "features.projectManagementDesc",
    };
    const result = transform(ast, map, inlineOpts);

    expect(result.stringsWrapped).toBe(2);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('title: t("Project Management", "features.projectManagement")');
    expect(result.code).toContain('description: t("Manage your projects.", "features.projectManagementDesc")');
  });

  it("does not modify files without matching strings", () => {
    const code = `export default function Other() { return <div>No match</div>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.modified).toBe(false);
    expect(result.stringsWrapped).toBe(0);
  });

  it("does not transform object properties inside non-component callbacks", () => {
    const code = `const MyMark = SomeLib.create(() => {
      return { title: "Project Management" };
    });
    function App() { return <div />; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { "Project Management": "features.projectManagement" };
    const result = transform(ast, map, inlineOpts);

    expect(result.stringsWrapped).toBe(0);
    expect(result.modified).toBe(false);
    expect(result.code).toContain('title: "Project Management"');
  });

  it("injects hook into each component that needs it in multi-component files", () => {
    const code = `function Header() {
  return <input placeholder="Search..." />;
}
function Footer() {
  return <input placeholder="Search..." />;
}`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.stringsWrapped).toBe(2);
    expect(result.code).toMatch(/function Header\(\) \{\s*const t = createT\(\)/);
    expect(result.code).toMatch(/function Footer\(\) \{\s*const t = createT\(\)/);
  });

  it("repairs createT(messages) → createT() when messages is not in scope", () => {
    const code = `import { T, createT } from "@/components/t-server";
export default function Logo() {
  const t = createT(messages);
  return <img alt={t("Mimir Logo", "logo.altText")} />;
}`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, {}, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.code).toContain("createT()");
    expect(result.code).not.toContain("createT(messages)");
  });

  it("does NOT repair createT(messages) when messages IS in scope", () => {
    const code = `import { createT } from "@/components/t-server";
import messages from "@/messages/es.json";
export default function Logo() {
  const t = createT(messages);
  return <img alt={t("Mimir Logo", "logo.altText")} />;
}`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, {}, inlineOpts);

    // messages is imported, so it's a valid binding — don't touch it
    expect(result.code).toContain("createT(messages)");
  });
});

describe("AST validation post-codegen", () => {
  it("valid transformed code can be re-parsed (keys mode)", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey);

    expect(result.modified).toBe(true);
    expect(() => parseFile(result.code, "before.tsx")).not.toThrow();
  });

  it("valid inline transformed code can be re-parsed", () => {
    const code = readFileSync(join(fixturesDir, "before-inline.tsx"), "utf-8");
    const ast = parseFile(code, "before-inline.tsx");
    const inlineOpts: TransformOptions = {
      mode: "inline",
      componentPath: "@/components/t",
    };
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.modified).toBe(true);
    expect(() => parseFile(result.code, "before-inline.tsx")).not.toThrow();
  });

  it("all fixture transforms produce parseable output", () => {
    const fixtures = [
      { file: "before.tsx", opts: undefined },
      {
        file: "before-inline.tsx",
        opts: { mode: "inline" as const, componentPath: "@/components/t" },
      },
    ];

    for (const fixture of fixtures) {
      const code = readFileSync(join(fixturesDir, fixture.file), "utf-8");
      const ast = parseFile(code, fixture.file);
      const result = transform(ast, textToKey, fixture.opts);

      if (result.modified) {
        expect(() => parseFile(result.code, fixture.file)).not.toThrow();
      }
    }
  });
});
