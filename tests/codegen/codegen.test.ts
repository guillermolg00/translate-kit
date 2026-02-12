import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { codegen } from "../../src/codegen/index.js";

describe("codegen integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codegen-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes file when output is valid", async () => {
    const filePath = join(tempDir, "valid.tsx");
    await writeFile(
      filePath,
      `export default function Page() { return <h1>Hello World</h1>; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: { "Hello World": "page.hello" },
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);
    expect(result.filesSkipped).toBe(0);

    const content = await readFile(filePath, "utf-8");
    // Single namespace "page" → key stripped to "hello"
    expect(content).toContain('t("hello")');
    expect(content).toContain('getTranslations("page")');
  });

  it("skips file when transform produces invalid syntax", async () => {
    const filePath = join(tempDir, "test.tsx");
    const originalContent = `export default function Page() { return <h1>Hello World</h1>; }`;
    await writeFile(filePath, originalContent, "utf-8");

    // Mock transform to return invalid code
    const transformModule = await import("../../src/codegen/transform.js");
    const originalTransform = transformModule.transform;
    vi.spyOn(transformModule, "transform").mockReturnValueOnce({
      code: "function {{{",
      modified: true,
      stringsWrapped: 1,
    });

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: { "Hello World": "page.hello" },
      },
      tempDir,
    );

    expect(result.filesSkipped).toBe(1);
    expect(result.filesModified).toBe(0);

    // Original file should be preserved
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe(originalContent);

    vi.restoreAllMocks();
  });

  it("continues processing after a failed file", async () => {
    const file1 = join(tempDir, "a.tsx");
    const file2 = join(tempDir, "b.tsx");
    await writeFile(
      file1,
      `export default function A() { return <h1>Hello World</h1>; }`,
      "utf-8",
    );
    await writeFile(
      file2,
      `export default function B() { return <h1>Hello World</h1>; }`,
      "utf-8",
    );

    const transformModule = await import("../../src/codegen/transform.js");
    // First call returns invalid, second call uses real transform
    vi.spyOn(transformModule, "transform").mockReturnValueOnce({
      code: "function {{{",
      modified: true,
      stringsWrapped: 1,
    });

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: { "Hello World": "page.hello" },
      },
      tempDir,
    );

    expect(result.filesSkipped).toBe(1);
    expect(result.filesModified).toBe(1);

    vi.restoreAllMocks();
  });

  it("forces client inline runtime for files imported by client boundaries", async () => {
    const appDir = join(tempDir, "src", "app");
    const componentsDir = join(tempDir, "src", "components");
    await mkdir(appDir, { recursive: true });
    await mkdir(componentsDir, { recursive: true });

    const clientPage = join(appDir, "page.tsx");
    const logoFile = join(componentsDir, "logo.tsx");

    await writeFile(
      clientPage,
      `"use client";
import { Logo } from "@/components/logo";
export default function Page() { return <Logo />; }`,
      "utf-8",
    );

    await writeFile(
      logoFile,
      `export function Logo() { return <img alt="Mimir Logo" />; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.tsx"],
        mode: "inline",
        componentPath: "@/components/t",
        textToKey: { "Mimir Logo": "common.mimirLogo" },
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);

    const logoOut = await readFile(logoFile, "utf-8");
    expect(logoOut).toContain('from "@/components/t"');
    expect(logoOut).not.toContain("t-server");
    expect(logoOut).toContain("useT");
    expect(logoOut).toContain('t("Mimir Logo", "common.mimirLogo")');
    expect(logoOut).toContain('"use client"');
  });

  it("forces client inline runtime through dynamic import dependencies", async () => {
    const appDir = join(tempDir, "src", "app");
    const componentsDir = join(tempDir, "src", "components");
    await mkdir(appDir, { recursive: true });
    await mkdir(componentsDir, { recursive: true });

    const clientPage = join(appDir, "page.tsx");
    const logoFile = join(componentsDir, "logo.tsx");

    await writeFile(
      clientPage,
      `"use client";
export default function Page() {
  void import("../components/logo");
  return null;
}`,
      "utf-8",
    );

    await writeFile(
      logoFile,
      `export function Logo() { return <img alt="Mimir Logo" />; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.tsx"],
        mode: "inline",
        componentPath: "@/components/t",
        textToKey: { "Mimir Logo": "common.mimirLogo" },
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);

    const logoOut = await readFile(logoFile, "utf-8");
    expect(logoOut).toContain('from "@/components/t"');
    expect(logoOut).not.toContain("t-server");
    expect(logoOut).toContain("useT");
    expect(logoOut).toContain('t("Mimir Logo", "common.mimirLogo")');
    expect(logoOut).toContain('"use client"');
  });

  it("resolves tsconfig path aliases in client dependency graph", async () => {
    const appDir = join(tempDir, "src", "app");
    const componentsDir = join(tempDir, "src", "components");
    await mkdir(appDir, { recursive: true });
    await mkdir(componentsDir, { recursive: true });

    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@ui/*": ["src/components/*"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const clientPage = join(appDir, "page.tsx");
    const logoFile = join(componentsDir, "logo.tsx");

    await writeFile(
      clientPage,
      `"use client";
import { Logo } from "@ui/logo";
export default function Page() { return <Logo />; }`,
      "utf-8",
    );

    await writeFile(
      logoFile,
      `export function Logo() { return <h1>Hello World</h1>; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.tsx"],
        textToKey: { "Hello World": "hero.welcome" },
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);

    const logoOut = await readFile(logoFile, "utf-8");
    expect(logoOut).toContain('"use client"');
    expect(logoOut).toContain('import { useTranslations } from "next-intl"');
    expect(logoOut).toContain('const t = useTranslations("hero")');
    expect(logoOut).toContain('t("welcome")');
    expect(logoOut).not.toContain("getTranslations");
  });

  it("returns clientNamespaces for client files", async () => {
    const filePath = join(tempDir, "page.tsx");
    await writeFile(
      filePath,
      `"use client";
export default function Page() {
  return <div><h1>Welcome</h1><p>Get started</p></div>;
}`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: { Welcome: "hero.welcome", "Get started": "hero.getStarted" },
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);
    expect(result.clientNamespaces).toEqual(["hero"]);
  });

  it("returns empty clientNamespaces for server-only files", async () => {
    const filePath = join(tempDir, "page.tsx");
    await writeFile(
      filePath,
      `export default function Page() { return <h1>Hello World</h1>; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: { "Hello World": "page.hello" },
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);
    expect(result.clientNamespaces).toEqual([]);
  });

  it("collects multiple client namespaces across files", async () => {
    const file1 = join(tempDir, "hero.tsx");
    const file2 = join(tempDir, "nav.tsx");
    await writeFile(
      file1,
      `"use client";
export function Hero() { return <h1>Welcome</h1>; }`,
      "utf-8",
    );
    await writeFile(
      file2,
      `"use client";
export function Nav() { return <nav>Home</nav>; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: { Welcome: "hero.welcome", Home: "nav.home" },
      },
      tempDir,
    );

    expect(result.clientNamespaces).toEqual(["hero", "nav"]);
  });

  it("module factory: transforms defining file and importing file", async () => {
    const dataDir = join(tempDir, "src", "data");
    const componentsDir = join(tempDir, "src", "components");
    await mkdir(dataDir, { recursive: true });
    await mkdir(componentsDir, { recursive: true });

    const dataFile = join(dataDir, "links.ts");
    const compFile = join(componentsDir, "footer.tsx");

    await writeFile(
      dataFile,
      `export const footerLinks = [
  { title: "About", href: "/about" },
  { title: "Contact", href: "/contact" },
];`,
      "utf-8",
    );

    await writeFile(
      compFile,
      `"use client";
import { footerLinks } from "../data/links";
export function Footer() {
  return <ul>{footerLinks.map(l => <li key={l.href}>{l.title}</li>)}</ul>;
}`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.{ts,tsx}"],
        textToKey: { About: "footer.about", Contact: "footer.contact" },
        moduleFactory: true,
      },
      tempDir,
    );

    expect(result.filesModified).toBe(2);

    const dataOut = await readFile(dataFile, "utf-8");
    expect(dataOut).toContain("t: any) =>");
    expect(dataOut).toContain("t(");

    const compOut = await readFile(compFile, "utf-8");
    expect(compOut).toContain("footerLinks(t)");
  });

  it("module factory: skips const used outside function (unsafe)", async () => {
    const filePath = join(tempDir, "data.tsx");
    await writeFile(
      filePath,
      `export const items = [{ title: "Hello" }];
console.log(items);
export function App() { return <div />; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: { Hello: "app.hello" },
        moduleFactory: true,
      },
      tempDir,
    );

    // items is referenced outside function (console.log) → unsafe → skip
    const content = await readFile(filePath, "utf-8");
    expect(content).not.toContain("(t) =>");
  });

  it("module factory: skips namespace imports", async () => {
    const dataDir = join(tempDir, "src");
    await mkdir(dataDir, { recursive: true });

    const dataFile = join(dataDir, "data.ts");
    const compFile = join(dataDir, "comp.tsx");

    await writeFile(
      dataFile,
      `export const items = [{ title: "Hello" }];`,
      "utf-8",
    );

    await writeFile(
      compFile,
      `import * as data from "./data";
export function App() { return <div>{data.items.map(i => <p>{i.title}</p>)}</div>; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.{ts,tsx}"],
        textToKey: { Hello: "app.hello" },
        moduleFactory: true,
      },
      tempDir,
    );

    const compOut = await readFile(compFile, "utf-8");
    // namespace import → should not be rewritten
    expect(compOut).not.toContain("data(");
  });

  it("module factory: local usage in same file is rewritten", async () => {
    const filePath = join(tempDir, "page.tsx");
    await writeFile(
      filePath,
      `export const links = [
  { title: "About", href: "/about" },
];
export function Footer() {
  return <ul>{links.map(l => <li key={l.href}>{l.title}</li>)}</ul>;
}`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: { About: "footer.about" },
        moduleFactory: true,
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);
    const content = await readFile(filePath, "utf-8");
    // Const should be wrapped as factory
    expect(content).toContain("t: any) =>");
    // Local usage should be rewritten
    expect(content).toContain("links(t)");
  });

  it("module factory: unsafe importer blocks source transformation", async () => {
    const dataDir = join(tempDir, "src");
    await mkdir(dataDir, { recursive: true });

    const dataFile = join(dataDir, "data.ts");
    const compFile = join(dataDir, "comp.tsx");

    await writeFile(
      dataFile,
      `export const links = [{ title: "About", href: "/about" }];`,
      "utf-8",
    );

    // links is used outside a component function (module level console.log)
    await writeFile(
      compFile,
      `import { links } from "./data";
console.log(links);
export function App() { return <div />; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.{ts,tsx}"],
        textToKey: { About: "footer.about" },
        moduleFactory: true,
      },
      tempDir,
    );

    // Both files should remain unchanged because the importer is unsafe
    const dataOut = await readFile(dataFile, "utf-8");
    expect(dataOut).not.toContain("t: any) =>");

    const compOut = await readFile(compFile, "utf-8");
    expect(compOut).not.toContain("links(t)");
  });

  it("module factory: import-only file gets t injected", async () => {
    const dataDir = join(tempDir, "src");
    const componentsDir = join(tempDir, "src", "components");
    await mkdir(dataDir, { recursive: true });
    await mkdir(componentsDir, { recursive: true });

    const dataFile = join(dataDir, "links.ts");
    const compFile = join(componentsDir, "footer.tsx");

    await writeFile(
      dataFile,
      `export const footerLinks = [
  { title: "About", href: "/about" },
];`,
      "utf-8",
    );

    // Component has NO own translatable strings — only uses the factory import
    await writeFile(
      compFile,
      `"use client";
import { footerLinks } from "../links";
export function Footer() {
  return <ul>{footerLinks.map(l => <li key={l.href}>{l.title}</li>)}</ul>;
}`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.{ts,tsx}"],
        textToKey: { About: "footer.about" },
        moduleFactory: true,
      },
      tempDir,
    );

    expect(result.filesModified).toBe(2);

    const compOut = await readFile(compFile, "utf-8");
    // t must be injected even though the component has no own strings
    expect(compOut).toContain("useTranslations");
    expect(compOut).toContain("footerLinks(t)");
  });

  it("module factory: transforms typed consts (preserves type annotation as return type)", async () => {
    const filePath = join(tempDir, "config.ts");
    await writeFile(
      filePath,
      `import type { NavItem } from "./types";
export const sidebarLinks: NavItem[] = [
  { title: "About", href: "/about" },
  { title: "Contact", href: "/contact" },
];`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.ts"],
        textToKey: { About: "sidebar.about", Contact: "sidebar.contact" },
        moduleFactory: true,
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);

    const content = await readFile(filePath, "utf-8");
    // Should be wrapped as factory with type annotation preserved as return type
    expect(content).toContain("=>");
    expect(content).toContain("): NavItem[]");
    expect(content).toContain('t("sidebar.about")');
  });

  it("module factory: detects indexed assignment as mutation (unsafe)", async () => {
    const dataDir = join(tempDir, "src");
    await mkdir(dataDir, { recursive: true });

    const dataFile = join(dataDir, "data.ts");
    const compFile = join(dataDir, "comp.tsx");

    await writeFile(
      dataFile,
      `export const items = [{ title: "Hello", href: "/hello" }];`,
      "utf-8",
    );

    await writeFile(
      compFile,
      `import { items } from "./data";
export function App() {
  items[0] = { title: "Updated", href: "/updated" };
  return <div />;
}`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.{ts,tsx}"],
        textToKey: { Hello: "app.hello" },
        moduleFactory: true,
      },
      tempDir,
    );

    // Both files should remain unchanged because the importer mutates
    const dataOut = await readFile(dataFile, "utf-8");
    expect(dataOut).not.toContain("t: any) =>");
  });

  it("module factory: external importer outside include scope blocks const", async () => {
    // Simulates the numa365 scenario: config/site.ts defines siteConfig,
    // lib/utils.ts (outside include scope) imports siteConfig at module level.
    // siteConfig should NOT be wrapped as factory.
    const configDir = join(tempDir, "config");
    const libDir = join(tempDir, "lib");
    await mkdir(configDir, { recursive: true });
    await mkdir(libDir, { recursive: true });

    const configFile = join(configDir, "site.ts");
    const libFile = join(libDir, "utils.ts");

    await writeFile(
      configFile,
      `export const siteConfig = {
  name: "MySite",
  description: "Unlock the power",
  url: "http://localhost:3000",
};
export const footerLinks = [
  { title: "About", href: "/about" },
];`,
      "utf-8",
    );

    // External file uses siteConfig at module level — can't be rewritten
    await writeFile(
      libFile,
      `import { siteConfig } from "../config/site";
const BASE_URL = siteConfig.url;
export function getUrl() { return BASE_URL; }`,
      "utf-8",
    );

    const result = await codegen(
      {
        // Only config/ is in include scope; lib/ is NOT
        include: ["config/**/*.ts"],
        textToKey: {
          "Unlock the power": "site.unlockPower",
          About: "footer.about",
        },
        moduleFactory: true,
      },
      tempDir,
    );

    const configOut = await readFile(configFile, "utf-8");
    // siteConfig should NOT be wrapped — external importer blocks it
    expect(configOut).not.toMatch(/siteConfig\s*=\s*\(?t\)?/);
    // footerLinks should still be wrapped (no external importer)
    expect(configOut).toContain('t("footer.about")');
    // The file IS modified because footerLinks was wrapped
    expect(result.filesModified).toBe(1);
  });

  it("module factory: skips Next.js metadata export (framework reserved)", async () => {
    const filePath = join(tempDir, "page.tsx");
    await writeFile(
      filePath,
      `import { constructMetadata } from "@/lib/utils";
export const metadata = constructMetadata({
  title: "Analytics",
  description: "Overview of metrics",
});
export default function Page() {
  return <h1>Hello</h1>;
}`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.tsx"],
        textToKey: {
          Analytics: "dashboard.analyticsTitle",
          "Overview of metrics": "dashboard.analyticsDescription",
          Hello: "page.hello",
        },
        moduleFactory: true,
      },
      tempDir,
    );

    const content = await readFile(filePath, "utf-8");
    // metadata must NOT be wrapped as factory (framework reserved export)
    expect(content).not.toMatch(/metadata\s*=\s*\(?t\)?/);
    // metadata strings should remain untransformed
    expect(content).toContain('"Analytics"');
    // Regular JSX should still be transformed (key stripped by namespace)
    expect(content).toContain('t("hello")');
  });

  it("module factory: data-only file does not get spurious next-intl import", async () => {
    const filePath = join(tempDir, "data.ts");
    await writeFile(
      filePath,
      `export const links = [{ title: "About", href: "/about" }];`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["**/*.ts"],
        textToKey: { About: "nav.about" },
        moduleFactory: true,
      },
      tempDir,
    );

    expect(result.filesModified).toBe(1);
    const content = await readFile(filePath, "utf-8");
    // Factory should be created
    expect(content).toContain("t: any) =>");
    // But no next-intl import should be added (no React components)
    expect(content).not.toContain("next-intl");
    expect(content).not.toContain("useTranslations");
    expect(content).not.toContain("getTranslations");
  });

  it("module factory: helper function does not get hooks injected (PascalCase filter)", async () => {
    const dataDir = join(tempDir, "src");
    await mkdir(dataDir, { recursive: true });

    const dataFile = join(dataDir, "links.ts");
    const compFile = join(dataDir, "footer.tsx");

    await writeFile(
      dataFile,
      `export const footerLinks = [{ title: "About", href: "/about" }];`,
      "utf-8",
    );

    // formatLinks is NOT PascalCase → should be treated as unsafe
    await writeFile(
      compFile,
      `import { footerLinks } from "./links";
function formatLinks(links: any[]) {
  return links.map(l => ({ ...l, active: true }));
}
export function Footer() {
  const formatted = formatLinks(footerLinks);
  return <ul>{formatted.map(l => <li key={l.href}>{l.title}</li>)}</ul>;
}`,
      "utf-8",
    );

    const result = await codegen(
      {
        include: ["src/**/*.{ts,tsx}"],
        textToKey: { About: "footer.about" },
        moduleFactory: true,
      },
      tempDir,
    );

    // footerLinks is used inside Footer (PascalCase) as arg to formatLinks
    // formatLinks itself is not a component, but the reference is from Footer
    expect(result.filesModified).toBeGreaterThanOrEqual(1);

    const compOut = await readFile(compFile, "utf-8");
    // The ref inside Footer should be rewritten since it's in a PascalCase function
    expect(compOut).toContain("footerLinks(t)");
    // formatLinks should NOT get useTranslations injected
    expect(compOut).not.toMatch(/function formatLinks[\s\S]*?useTranslations/);
  });
});
