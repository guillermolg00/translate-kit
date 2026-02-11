import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateConfigFile,
  updateLayoutWithSelectiveMessages,
} from "../src/init.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "init-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("generateConfigFile", () => {
  const baseOpts = {
    providerKey: "openai" as const,
    modelName: "gpt-4o-mini",
    sourceLocale: "en",
    targetLocales: ["es", "fr"],
    messagesDir: "./messages",
    includePatterns: ["src/**/*.tsx"],
    i18nImport: "next-intl",
    context: "",
    tone: "neutral",
    mode: "keys" as const,
  };

  it("includes splitByNamespace when true", () => {
    const result = generateConfigFile({ ...baseOpts, splitByNamespace: true });
    expect(result).toContain("splitByNamespace: true,");
  });

  it("omits splitByNamespace when false", () => {
    const result = generateConfigFile({ ...baseOpts, splitByNamespace: false });
    expect(result).not.toContain("splitByNamespace");
  });

  it("omits splitByNamespace when undefined", () => {
    const result = generateConfigFile(baseOpts);
    expect(result).not.toContain("splitByNamespace");
  });
});

describe("updateLayoutWithSelectiveMessages", () => {
  async function setupLayout(content: string): Promise<string> {
    const appDir = join(tempDir, "src", "app");
    await mkdir(appDir, { recursive: true });
    const layoutPath = join(appDir, "layout.tsx");
    await writeFile(layoutPath, content, "utf-8");
    return layoutPath;
  }

  const baseLayout = `import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

export const metadata: Metadata = { title: "App" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();

  return (
    <html>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
`;

  it("adds pickMessages helper instead of pick import", async () => {
    await setupLayout(baseLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero", "common"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    expect(content).toContain("pickMessages");
    expect(content).not.toContain('import { NextIntlClientProvider, pick }');
    expect(content).toContain("function pickMessages(");
  });

  it("replaces messages={messages} with messages={clientMessages}", async () => {
    await setupLayout(baseLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    expect(content).toContain("messages={clientMessages}");
    expect(content).not.toContain("messages={messages}");
  });

  it("includes correct namespace list in pickMessages call", async () => {
    await setupLayout(baseLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero", "common"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    expect(content).toContain('pickMessages(messages, ["hero", "common"])');
  });

  it("is idempotent — does not duplicate if clientMessages already present", async () => {
    await setupLayout(baseLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero"]);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero", "common"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    const matches = content.match(/pickMessages/g) ?? [];
    // One for the function definition, one for the call
    expect(matches.length).toBe(2);
  });

  it("updates namespace list on subsequent calls", async () => {
    await setupLayout(baseLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    let content = await readFile(layoutPath, "utf-8");
    expect(content).toContain('pickMessages(messages, ["hero"])');

    // Second call with different namespaces should update the list
    await updateLayoutWithSelectiveMessages(tempDir, ["hero", "auth", "common"]);
    content = await readFile(layoutPath, "utf-8");
    expect(content).toContain('pickMessages(messages, ["hero", "auth", "common"])');
    expect(content).not.toContain('pickMessages(messages, ["hero"])');
  });

  it("does nothing if no client namespaces", async () => {
    await setupLayout(baseLayout);
    await updateLayoutWithSelectiveMessages(tempDir, []);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    expect(content).toBe(baseLayout);
  });

  it("does nothing if NextIntlClientProvider is not present", async () => {
    const simpleLayout = `export default function Layout({ children }) { return <div>{children}</div>; }`;
    await setupLayout(simpleLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    expect(content).toBe(simpleLayout);
  });

  // --- Inline mode (I18nProvider) tests ---

  const inlineLayout = `import type { Metadata } from "next";
import { I18nProvider } from "@/components/t";
import { setServerMessages, setLocale } from "@/components/t-server";
import { getLocale, getMessages } from "@/i18n";

export const metadata: Metadata = { title: "App" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  setLocale(locale);
  const messages = await getMessages(locale);
  setServerMessages(messages);

  return (
    <html>
      <body>
        <I18nProvider messages={messages} locale={locale}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
`;

  it("adds prefix-based pickMessages for inline I18nProvider", async () => {
    await setupLayout(inlineLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero", "common"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    expect(content).toContain("pickMessages");
    expect(content).toContain('key.startsWith(ns + ".")');
  });

  it("replaces messages={messages} with messages={clientMessages} for inline", async () => {
    await setupLayout(inlineLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    expect(content).toContain("messages={clientMessages}");
    expect(content).not.toContain("messages={messages}");
  });

  it("is idempotent for inline layouts", async () => {
    await setupLayout(inlineLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero"]);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero", "common"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    const matches = content.match(/pickMessages/g) ?? [];
    // One for the function definition, one for the call
    expect(matches.length).toBe(2);
  });

  it("updates namespace list on subsequent calls for inline", async () => {
    await setupLayout(inlineLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    let content = await readFile(layoutPath, "utf-8");
    expect(content).toContain('pickMessages(messages, ["hero"])');

    await updateLayoutWithSelectiveMessages(tempDir, ["hero", "auth"]);
    content = await readFile(layoutPath, "utf-8");
    expect(content).toContain('pickMessages(messages, ["hero", "auth"])');
  });

  it("handles getMessages(locale) call pattern for inline", async () => {
    await setupLayout(inlineLayout);
    await updateLayoutWithSelectiveMessages(tempDir, ["hero"]);

    const layoutPath = join(tempDir, "src", "app", "layout.tsx");
    const content = await readFile(layoutPath, "utf-8");

    expect(content).toContain("const messages = await getMessages(locale);");
    expect(content).toContain("const clientMessages = pickMessages(messages,");
  });
});
