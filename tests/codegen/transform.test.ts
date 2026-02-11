import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "../../src/scanner/parser.js";
import {
  transform,
  detectNamespace,
  type TransformOptions,
} from "../../src/codegen/transform.js";

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

  it("injects getTranslations import for server components", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey);

    expect(result.code).toContain(
      'import { getTranslations } from "next-intl/server"',
    );
  });

  it("injects const t = await getTranslations() and async for server components", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey);

    expect(result.code).toContain("const t = await getTranslations()");
    expect(result.code).toContain("async");
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
    // Single namespace "common" → useTranslations("common"), key stripped
    expect(result.code).toContain(
      'placeholder={t("searchPlaceholder")}',
    );
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
    // Single namespace "greeting" → key stripped to "hello"
    expect(result.code).toContain('t("hello")');
  });

  it("wraps text after nested elements", () => {
    const code = `function Def() { return <li><strong>Term</strong>: a definition here.</li>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { ": a definition here.": "page.definition" };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(1);
    expect(result.modified).toBe(true);
    // Single namespace "page" → key stripped to "definition"
    expect(result.code).toContain('t("definition")');
  });

  it("wraps text before components in mixed content", () => {
    const code = `function CTA() { return <Button>Meet Mimir <ArrowRight /></Button>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { "Meet Mimir": "cta.meetMimir" };
    const result = transform(ast, map);

    expect(result.stringsWrapped).toBe(1);
    expect(result.modified).toBe(true);
    // Single namespace "cta" → key stripped to "meetMimir"
    expect(result.code).toContain('t("meetMimir")');
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
    // Single namespace "features" → keys stripped
    expect(result.code).toContain('title: t("projectManagement")');
    expect(result.code).toContain(
      'description: t("projectManagementDesc")',
    );
    expect(result.code).toContain('title: t("taskManagement")');
    expect(result.code).toContain(
      'description: t("taskManagementDesc")',
    );
  });

  it("does not wrap non-content object properties", () => {
    const code = `function App() {
      const config = { icon: "star", className: "text-red", href: "/about" };
      return <div />;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      star: "icon.star",
      "text-red": "class.red",
      "/about": "link.about",
    };
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

  it("injects t into each component that needs it in multi-component server files", () => {
    const code = `function Header() {
  return <h1>Welcome to our platform</h1>;
}
function Footer() {
  return <p>Sign up now</p>;
}`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.stringsWrapped).toBe(2);
    // Header uses hero.welcome → namespace "hero"
    expect(result.code).toMatch(
      /async function Header\(\) \{\s*const t = await getTranslations\("hero"\)/,
    );
    // Footer uses common.signUp → namespace "common"
    expect(result.code).toMatch(
      /async function Footer\(\) \{\s*const t = await getTranslations\("common"\)/,
    );
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
    // Footer gets t injected with namespace "common" (single key common.signUp)
    expect(result.code).toMatch(
      /function Footer\(\) \{\s*const t = useTranslations\("common"\)/,
    );
    // Header keeps its existing single t declaration
    const headerMatches = result.code.match(
      /function Header[\s\S]*?function Footer/,
    );
    const headerTCount = (
      headerMatches?.[0].match(/useTranslations\(/g) || []
    ).length;
    expect(headerTCount).toBe(1);
  });

  it("uses useTranslations for client components with 'use client' directive", () => {
    const code = `"use client";\nexport default function Hero() { return <h1>Welcome to our platform</h1>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.modified).toBe(true);
    expect(result.code).toContain(
      'import { useTranslations } from "next-intl"',
    );
    // Single key hero.welcome → namespace "hero"
    expect(result.code).toContain('const t = useTranslations("hero")');
    expect(result.code).not.toContain("getTranslations");
  });

  it("detects components with hooks as client and uses useTranslations", () => {
    const code = `import { useState } from "react";
export default function Counter() {
  const [count, setCount] = useState(0);
  return <p>Welcome to our platform</p>;
}`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.modified).toBe(true);
    expect(result.code).toContain(
      'import { useTranslations } from "next-intl"',
    );
    // Single key hero.welcome → namespace "hero"
    expect(result.code).toContain('const t = useTranslations("hero")');
    expect(result.code).not.toContain("getTranslations");
  });

  it("forceClient: true forces useTranslations even for server components", () => {
    const code = `export default function Hero() { return <h1>Welcome to our platform</h1>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, { forceClient: true });

    expect(result.modified).toBe(true);
    expect(result.code).toContain(
      'import { useTranslations } from "next-intl"',
    );
    // Single key hero.welcome → namespace "hero"
    expect(result.code).toContain('const t = useTranslations("hero")');
    expect(result.code).not.toContain("getTranslations");
  });

  it("makes arrow function server components async with await getTranslations", () => {
    const code = `const Hero = () => { return <h1>Welcome to our platform</h1>; };`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.modified).toBe(true);
    expect(result.code).toContain(
      'import { getTranslations } from "next-intl/server"',
    );
    // Single key hero.welcome → namespace "hero"
    expect(result.code).toContain('const t = await getTranslations("hero")');
    expect(result.code).toMatch(/async \(\) =>/);
  });

  it("preserves already async server components", () => {
    const code = `export default async function Page() { return <h1>Welcome to our platform</h1>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.modified).toBe(true);
    expect(result.code).toContain("async function Page");
    // Single key hero.welcome → namespace "hero"
    expect(result.code).toContain('const t = await getTranslations("hero")');
  });

  it("custom i18nImport does not apply server/client split", () => {
    const code = `export default function Hero() { return <h1>Welcome to our platform</h1>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, {
      i18nImport: "my-i18n-lib",
    });

    expect(result.code).toContain(
      'import { useTranslations } from "my-i18n-lib"',
    );
    // Single key hero.welcome → namespace "hero"
    expect(result.code).toContain('const t = useTranslations("hero")');
    expect(result.code).not.toContain("getTranslations");
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
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(4);
    expect(result.code).toContain(
      '<T id="hero.welcome">Welcome to our platform</T>',
    );
    expect(result.code).toContain(
      '<T id="hero.getStarted">Get started with your journey today</T>',
    );
    expect(result.code).toContain('<T id="common.signUp">Sign up now</T>');
  });

  it("wraps attributes with t(text, key) in inline mode", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.code).toContain('t("Search...", "common.searchPlaceholder")');
  });

  it("injects T and useT import for client files", () => {
    const code = `"use client";\nexport default function Hero() { return <h1>Welcome to our platform</h1>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.code).toContain('import { T } from "@/components/t"');
  });

  it("detects files with hooks as client even without 'use client' directive", () => {
    const code = `import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
export const NavItem = () => {
  const pathname = usePathname();
  const { data } = useQuery({ queryKey: ["test"] });
  return <h1>Welcome to our platform</h1>;
};`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    // Should import from client module since file uses hooks
    expect(result.code).toContain('import { T } from "@/components/t"');
    expect(result.code).not.toContain("t-server");
  });

  it("injects T and createT import for server files", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey, inlineOpts);

    // Server file (no "use client" directive)
    expect(result.code).toContain("@/components/t-server");
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
    expect(result.code).toContain(
      'title: t("Project Management", "features.projectManagement")',
    );
    expect(result.code).toContain(
      'description: t("Manage your projects.", "features.projectManagementDesc")',
    );
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
    expect(result.code).toMatch(
      /function Header\(\) \{\s*const t = createT\(\)/,
    );
    expect(result.code).toMatch(
      /function Footer\(\) \{\s*const t = createT\(\)/,
    );
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

describe("codegen transform (template literals, keys mode)", () => {
  it("transforms JSX expression template literal → t(key, { vars })", () => {
    const code =
      "function Greeting({ name }) { return <p>{`Hello ${name}`}</p>; }";
    const ast = parseFile(code, "test.tsx");
    const map = { "Hello {name}": "greeting.hello" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    // Single namespace "greeting" → key stripped to "hello"
    expect(result.code).toContain('t("hello"');
    expect(result.code).toMatch(/t\("hello",\s*\{\s*name\s*\}\)/);
  });

  it("transforms JSX attribute template literal → t(key, { vars })", () => {
    const code =
      "function App({ type }) { return <input placeholder={`Search ${type}`} />; }";
    const ast = parseFile(code, "test.tsx");
    const map = { "Search {type}": "common.searchType" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    // Single namespace "common" → key stripped to "searchType"
    expect(result.code).toContain('t("searchType"');
    expect(result.code).toMatch(/t\("searchType",\s*\{\s*type\s*\}\)/);
  });

  it("transforms object property template literal → t(key, { vars })", () => {
    const code = `function App({ id }) {
      const item = { title: \`Task \${id}\` };
      return <div />;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = { "Task {id}": "task.title" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    // Single namespace "task" → key stripped to "title"
    expect(result.code).toContain('t("title"');
    expect(result.code).toMatch(/t\("title",\s*\{\s*id\s*\}\)/);
  });

  it("transforms plain template literal → t(key) without values object", () => {
    const code = "function App() { return <p>{`Hello world`}</p>; }";
    const ast = parseFile(code, "test.tsx");
    const map = { "Hello world": "greeting.helloWorld" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    // Single namespace "greeting" → key stripped to "helloWorld"
    expect(result.code).toContain('t("helloWorld")');
    expect(result.code).not.toContain("{})");
  });

  it("leaves unmapped template literal intact", () => {
    const code = "function App({ name }) { return <p>{`Hello ${name}`}</p>; }";
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, {});

    expect(result.modified).toBe(false);
    expect(result.stringsWrapped).toBe(0);
    expect(result.code).toContain("`Hello ${name}`");
  });
});

describe("codegen transform (conditional expressions, keys mode)", () => {
  it("transforms basic ternary in JSX expression", () => {
    const code = `function App({ isAdmin }) { return <p>{isAdmin ? "Admin Panel" : "Dashboard"}</p>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { "Admin Panel": "admin.panel", Dashboard: "dashboard.title" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(2);
    expect(result.code).toContain('t("admin.panel")');
    expect(result.code).toContain('t("dashboard.title")');
    expect(result.code).toMatch(
      /isAdmin\s*\?\s*t\("admin\.panel"\)\s*:\s*t\("dashboard\.title"\)/,
    );
  });

  it("transforms ternary in JSX attribute", () => {
    const code = `function App({ isAdmin }) { return <input placeholder={isAdmin ? "Search users" : "Search items"} />; }`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Search users": "search.users",
      "Search items": "search.items",
    };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(2);
    // Single namespace "search" → keys stripped
    expect(result.code).toContain('t("users")');
    expect(result.code).toContain('t("items")');
  });

  it("transforms ternary in object property", () => {
    const code = `function App({ isAdmin }) {
      const item = { title: isAdmin ? "Admin" : "User" };
      return <div />;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = { Admin: "role.admin", User: "role.user" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(2);
    // Single namespace "role" → keys stripped
    expect(result.code).toContain('t("admin")');
    expect(result.code).toContain('t("user")');
  });

  it("transforms only mapped branch (mixed ternary)", () => {
    const code = `function App({ isAdmin, role }) { return <p>{isAdmin ? "Admin" : role}</p>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { Admin: "role.admin" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    // Single namespace "role" → key stripped to "admin"
    expect(result.code).toContain('t("admin")');
    expect(result.code).toMatch(/isAdmin\s*\?\s*t\("admin"\)\s*:\s*role/);
  });

  it("transforms nested ternaries", () => {
    const code = `function App({ a, b }) { return <p>{a ? "X" : b ? "Y" : "Z"}</p>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { X: "key.x", Y: "key.y", Z: "key.z" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(3);
    // Single namespace "key" → keys stripped
    expect(result.code).toContain('t("x")');
    expect(result.code).toContain('t("y")');
    expect(result.code).toContain('t("z")');
  });

  it("leaves unmapped ternary intact", () => {
    const code = `function App({ isAdmin }) { return <p>{isAdmin ? "Admin Panel" : "Dashboard"}</p>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, {});

    expect(result.modified).toBe(false);
    expect(result.stringsWrapped).toBe(0);
    expect(result.code).toContain('"Admin Panel"');
    expect(result.code).toContain('"Dashboard"');
  });
});

describe("codegen transform (template literals + conditionals, inline mode)", () => {
  const inlineOpts: TransformOptions = {
    mode: "inline",
    componentPath: "@/components/t",
  };

  it("transforms template literal in JSX attribute → t(text, key, { vars })", () => {
    const code =
      "function App({ type }) { return <input placeholder={`Search ${type}`} />; }";
    const ast = parseFile(code, "test.tsx");
    const map = { "Search {type}": "common.searchType" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    expect(result.code).toContain('t("Search {type}", "common.searchType"');
    expect(result.code).toMatch(
      /t\("Search \{type\}", "common\.searchType",\s*\{\s*type\s*\}\)/,
    );
  });

  it("transforms template literal in JSX expression → t(text, key, { vars })", () => {
    const code =
      "function Greeting({ name }) { return <p>{`Hello ${name}`}</p>; }";
    const ast = parseFile(code, "test.tsx");
    const map = { "Hello {name}": "greeting.hello" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    expect(result.code).toContain('t("Hello {name}", "greeting.hello"');
    expect(result.code).toMatch(
      /t\("Hello \{name\}", "greeting\.hello",\s*\{\s*name\s*\}\)/,
    );
  });

  it("transforms template literal in object property → t(text, key, { vars })", () => {
    const code = `function App({ id }) {
      const item = { title: \`Task \${id}\` };
      return <div />;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = { "Task {id}": "task.title" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    expect(result.code).toContain('t("Task {id}", "task.title"');
    expect(result.code).toMatch(
      /t\("Task \{id\}", "task\.title",\s*\{\s*id\s*\}\)/,
    );
  });

  it("transforms plain template literal without values arg", () => {
    const code = "function App() { return <p>{`Hello world`}</p>; }";
    const ast = parseFile(code, "test.tsx");
    const map = { "Hello world": "greeting.helloWorld" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    expect(result.code).toContain('t("Hello world", "greeting.helloWorld")');
    expect(result.code).not.toContain("{})");
  });

  it("transforms ternary in JSX expression", () => {
    const code = `function App({ isAdmin }) { return <p>{isAdmin ? "Admin" : "User"}</p>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { Admin: "role.admin", User: "role.user" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(2);
    expect(result.code).toContain('t("Admin", "role.admin")');
    expect(result.code).toContain('t("User", "role.user")');
    expect(result.code).toMatch(
      /isAdmin\s*\?\s*t\("Admin", "role\.admin"\)\s*:\s*t\("User", "role\.user"\)/,
    );
  });

  it("transforms ternary in JSX attribute", () => {
    const code = `function App({ a }) { return <input placeholder={a ? "X" : "Y"} />; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { X: "key.x", Y: "key.y" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(2);
    expect(result.code).toContain('t("X", "key.x")');
    expect(result.code).toContain('t("Y", "key.y")');
  });

  it("transforms ternary in object property", () => {
    const code = `function App({ a }) {
      const item = { title: a ? "Admin" : "User" };
      return <div />;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = { Admin: "role.admin", User: "role.user" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(2);
    expect(result.code).toContain('t("Admin", "role.admin")');
    expect(result.code).toContain('t("User", "role.user")');
  });

  it("transforms ternary with template literal branch", () => {
    const code =
      'function App({ a, n }) { return <p>{a ? `Hi ${n}` : "Guest"}</p>; }';
    const ast = parseFile(code, "test.tsx");
    const map = { "Hi {n}": "greeting.hi", Guest: "greeting.guest" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(2);
    expect(result.code).toContain('t("Hi {n}", "greeting.hi"');
    expect(result.code).toContain('t("Guest", "greeting.guest")');
    expect(result.code).toMatch(/\{\s*n\s*\}/);
  });

  it("transforms only mapped branch in mixed ternary", () => {
    const code = `function App({ isAdmin, role }) { return <p>{isAdmin ? "Admin" : role}</p>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { Admin: "role.admin" };
    const result = transform(ast, map, inlineOpts);

    expect(result.modified).toBe(true);
    expect(result.stringsWrapped).toBe(1);
    expect(result.code).toContain('t("Admin", "role.admin")');
    expect(result.code).toMatch(
      /isAdmin\s*\?\s*t\("Admin", "role\.admin"\)\s*:\s*role/,
    );
  });

  it("leaves unmapped template literal and ternary intact", () => {
    const code = "function App({ name }) { return <p>{`Hello ${name}`}</p>; }";
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, {}, inlineOpts);

    expect(result.modified).toBe(false);
    expect(result.stringsWrapped).toBe(0);
    expect(result.code).toContain("`Hello ${name}`");
  });
});

describe("codegen transform (namespace detection)", () => {
  it("assigns namespace when all keys share the same prefix", () => {
    const code = `function Hero() {
  return <div><h1>Welcome to our platform</h1><p>Get started with your journey today</p></div>;
}`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Welcome to our platform": "hero.welcome",
      "Get started with your journey today": "hero.getStarted",
    };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.code).toContain('getTranslations("hero")');
    expect(result.code).toContain('t("welcome")');
    expect(result.code).toContain('t("getStarted")');
    expect(result.code).not.toContain('t("hero.');
  });

  it("does not assign namespace when keys have mixed prefixes", () => {
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const result = transform(ast, textToKey);

    // textToKey has hero.* and common.* → mixed → no namespace
    expect(result.code).toContain("getTranslations()");
    expect(result.code).toContain('t("hero.welcome")');
    expect(result.code).toContain('t("common.signUp")');
  });

  it("does not assign namespace when keys have no dot", () => {
    const code = `function App() { return <h1>Hello</h1>; }`;
    const ast = parseFile(code, "test.tsx");
    const map = { Hello: "greeting" };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.code).toContain("getTranslations()");
    expect(result.code).toContain('t("greeting")');
  });

  it("handles 3+ level keys (namespace = first segment)", () => {
    const code = `function Settings() {
      return <div><h1>Profile Settings</h1><p>Change your name</p></div>;
    }`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Profile Settings": "settings.profile.title",
      "Change your name": "settings.profile.changeName",
    };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.code).toContain('getTranslations("settings")');
    expect(result.code).toContain('t("profile.title")');
    expect(result.code).toContain('t("profile.changeName")');
  });

  it("assigns different namespaces to different components in the same file", () => {
    const code = `function Hero() {
  return <h1>Welcome</h1>;
}
function Footer() {
  return <p>Copyright notice</p>;
}`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      Welcome: "hero.welcome",
      "Copyright notice": "footer.copyright",
    };
    const result = transform(ast, map);

    expect(result.code).toContain('getTranslations("hero")');
    expect(result.code).toContain('getTranslations("footer")');
    expect(result.code).toContain('t("welcome")');
    expect(result.code).toContain('t("copyright")');
  });

  it("returns usedKeys in the result", () => {
    const code = `function Hero() {
  return <div><h1>Welcome to our platform</h1><button>Sign up now</button></div>;
}`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Welcome to our platform": "hero.welcome",
      "Sign up now": "common.signUp",
    };
    const result = transform(ast, map);

    expect(result.usedKeys).toContain("hero.welcome");
    expect(result.usedKeys).toContain("common.signUp");
    expect(result.usedKeys).toHaveLength(2);
  });

  it("returns empty usedKeys when no strings are wrapped", () => {
    const code = `export default function Other() { return <div>No match</div>; }`;
    const ast = parseFile(code, "test.tsx");
    const result = transform(ast, textToKey);

    expect(result.usedKeys).toEqual([]);
  });

  it("updates existing useTranslations() without namespace to include namespace", () => {
    const code = `import { useTranslations } from "next-intl";
"use client";
function Hero() {
  const t = useTranslations();
  return <div><h1>Welcome to our platform</h1><p>Get started with your journey today</p></div>;
}`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Welcome to our platform": "hero.welcome",
      "Get started with your journey today": "hero.getStarted",
    };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.code).toContain('useTranslations("hero")');
    expect(result.code).toContain('t("welcome")');
    expect(result.code).toContain('t("getStarted")');
    expect(result.code).not.toContain('t("hero.');
  });

  it("updates existing useTranslations('other') to the correct namespace", () => {
    const code = `import { useTranslations } from "next-intl";
"use client";
function Hero() {
  const t = useTranslations("other");
  return <h1>Welcome to our platform</h1>;
}`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Welcome to our platform": "hero.welcome",
    };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.code).toContain('useTranslations("hero")');
    expect(result.code).toContain('t("welcome")');
    expect(result.code).not.toContain('useTranslations("other")');
  });

  it("keeps existing useTranslations('hero') when namespace matches", () => {
    const code = `import { useTranslations } from "next-intl";
"use client";
function Hero() {
  const t = useTranslations("hero");
  return <h1>Welcome to our platform</h1>;
}`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Welcome to our platform": "hero.welcome",
    };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.code).toContain('useTranslations("hero")');
    expect(result.code).toContain('t("welcome")');
  });

  it("updates existing await getTranslations() without namespace (server component)", () => {
    const code = `import { getTranslations } from "next-intl/server";
export default async function Hero() {
  const t = await getTranslations();
  return <h1>Welcome to our platform</h1>;
}`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Welcome to our platform": "hero.welcome",
    };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    expect(result.code).toContain('getTranslations("hero")');
    expect(result.code).toContain('t("welcome")');
    expect(result.code).not.toContain('t("hero.');
  });

  it("does NOT strip keys when t exists and keys have mixed namespaces", () => {
    const code = `import { useTranslations } from "next-intl";
"use client";
function Hero() {
  const t = useTranslations();
  return <div><h1>Welcome to our platform</h1><button>Sign up now</button></div>;
}`;
    const ast = parseFile(code, "test.tsx");
    const map = {
      "Welcome to our platform": "hero.welcome",
      "Sign up now": "common.signUp",
    };
    const result = transform(ast, map);

    expect(result.modified).toBe(true);
    // Mixed namespaces → no namespace assigned → keys stay full
    expect(result.code).toContain('t("hero.welcome")');
    expect(result.code).toContain('t("common.signUp")');
    expect(result.code).toContain("useTranslations()");
  });
});

describe("codegen transform (inline client boundary repairs)", () => {
  const inlineOpts: TransformOptions = {
    mode: "inline",
    componentPath: "@/components/t",
  };

  it("rewrites t-server imports to client inline runtime when forceClient is true", () => {
    const code = `import { T, createT } from "@/components/t-server";
export function Logo() {
  const t = createT();
  return <img alt={t("Mimir Logo", "common.mimirLogo")} />;
}`;
    const ast = parseFile(code, "logo.tsx");
    const result = transform(ast, {}, { ...inlineOpts, forceClient: true });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('from "@/components/t"');
    expect(result.code).not.toContain("t-server");
    expect(result.code).toContain("useT");
  });

  it("repairs useT() → createT() in server component body", () => {
    const code = `import { T, useT } from "@/components/t";
export default function Logo() {
  const t = useT();
  return <img alt={t("Mimir Logo", "common.mimirLogo")} />;
}`;
    const ast = parseFile(code, "logo.tsx");
    const result = transform(ast, {}, inlineOpts);

    expect(result.modified).toBe(true);
    // Server file (no "use client") → should use createT, not useT
    expect(result.code).toContain("createT()");
    expect(result.code).not.toMatch(/\buseT\(\)/);
    expect(result.code).toContain("t-server");
  });

  it("repairs createT() → useT() in client component body", () => {
    const code = `"use client";
import { T, createT } from "@/components/t-server";
export default function Logo() {
  const t = createT();
  return <img alt={t("Mimir Logo", "common.mimirLogo")} />;
}`;
    const ast = parseFile(code, "logo.tsx");
    const result = transform(ast, {}, inlineOpts);

    expect(result.modified).toBe(true);
    // Client file → should use useT, not createT
    expect(result.code).toContain("useT()");
    expect(result.code).not.toMatch(/\bcreateT\(\)/);
    expect(result.code).toContain('from "@/components/t"');
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
    const code = readFileSync(join(fixturesDir, "before.tsx"), "utf-8");
    const ast = parseFile(code, "before.tsx");
    const inlineOpts: TransformOptions = {
      mode: "inline",
      componentPath: "@/components/t",
    };
    const result = transform(ast, textToKey, inlineOpts);

    expect(result.modified).toBe(true);
    expect(() => parseFile(result.code, "before.tsx")).not.toThrow();
  });

  it("all fixture transforms produce parseable output", () => {
    const fixtures = [
      { file: "before.tsx", opts: undefined },
      {
        file: "before.tsx",
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

describe("detectNamespace", () => {
  it("returns namespace when all keys share the same prefix", () => {
    expect(detectNamespace(["hero.welcome", "hero.title"])).toBe("hero");
  });

  it("returns null when keys have mixed prefixes", () => {
    expect(detectNamespace(["hero.welcome", "common.signUp"])).toBeNull();
  });

  it("returns null for empty keys array", () => {
    expect(detectNamespace([])).toBeNull();
  });

  it("returns null when any key has no dot", () => {
    expect(detectNamespace(["greeting", "hero.welcome"])).toBeNull();
  });

  it("returns null when all keys have no dot", () => {
    expect(detectNamespace(["greeting", "welcome"])).toBeNull();
  });

  it("returns namespace for single key with dot", () => {
    expect(detectNamespace(["hero.welcome"])).toBe("hero");
  });

  it("returns first segment for deeply nested keys", () => {
    expect(
      detectNamespace(["settings.profile.title", "settings.profile.name"]),
    ).toBe("settings");
  });

  it("returns null for single key without dot", () => {
    expect(detectNamespace(["greeting"])).toBeNull();
  });
});
