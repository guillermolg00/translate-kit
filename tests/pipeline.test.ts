import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from "ai";
import {
  loadMapFile,
  loadSplitMessages,
  writeMapFile,
  runScanStep,
  runCodegenStep,
  runTranslateStep,
} from "../src/pipeline.js";
import type { TranslateKitConfig } from "../src/types.js";

const mockModel = {} as any;

function makeConfig(overrides?: Partial<TranslateKitConfig>): TranslateKitConfig {
  return {
    model: mockModel,
    mode: "keys",
    sourceLocale: "en",
    targetLocales: ["es"],
    messagesDir: "./messages",
    scan: {
      include: ["src/**/*.tsx"],
      exclude: [],
    },
    translation: {
      batchSize: 50,
      concurrency: 1,
      retries: 0,
    },
    ...overrides,
  };
}

describe("loadMapFile / writeMapFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty object when no file exists", async () => {
    const result = await loadMapFile(join(tempDir, "nonexistent"));
    expect(result).toEqual({});
  });

  it("roundtrips map data", async () => {
    const map = { Hello: "common.hello", "Save changes": "form.save" };
    await writeMapFile(tempDir, map);
    const loaded = await loadMapFile(tempDir);
    expect(loaded).toEqual(map);
  });

  it("returns empty object for corrupted JSON", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, ".translate-map.json"), "not json", "utf-8");
    const result = await loadMapFile(tempDir);
    expect(result).toEqual({});
  });
});

describe("runScanStep", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-scan-"));
    vi.mocked(generateObject).mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("scans files, filters bare strings, and generates keys", async () => {
    // Create a source file with translatable text
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "App.tsx"),
      `export default function App() {
  return <div><h1>Hello World</h1><p>Welcome</p></div>;
}`,
      "utf-8",
    );

    const messagesDir = join(tempDir, "messages");

    // Mock AI response for key generation (schema: { mappings: [{ index, key }] })
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        mappings: [
          { index: 0, key: "app.helloWorld" },
          { index: 1, key: "app.welcome" },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as any);

    const config = makeConfig({
      messagesDir,
      typeSafe: true,
      scan: { include: ["src/**/*.tsx"], exclude: [] },
    });

    const result = await runScanStep({ config, cwd: tempDir });

    expect(result.bareStringCount).toBe(2);
    expect(result.fileCount).toBe(1);
    expect(Object.keys(result.textToKey)).toHaveLength(2);
    expect(result.textToKey["Hello World"]).toBe("app.helloWorld");
    expect(result.textToKey["Welcome"]).toBe("app.welcome");

    // sourceFlat should be key→text (inverted)
    expect(result.sourceFlat["app.helloWorld"]).toBe("Hello World");
    expect(result.sourceFlat["app.welcome"]).toBe("Welcome");

    // Map file should be written
    const mapData = await loadMapFile(messagesDir);
    expect(mapData).toEqual(result.textToKey);

    // Source locale JSON should be written (keys mode)
    const sourceJson = JSON.parse(
      await readFile(join(messagesDir, "en.json"), "utf-8"),
    );
    expect(sourceJson.app.helloWorld).toBe("Hello World");

    // next-intl.d.ts should be generated (keys mode + typeSafe)
    const dtsContent = await readFile(
      join(messagesDir, "next-intl.d.ts"),
      "utf-8",
    );
    expect(dtsContent).toContain('import messages from "./en.json"');
    expect(dtsContent).toContain("Messages: typeof messages");
  });

  it("excludes t-call and T-component with id from bare strings", async () => {
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });
    // File with already-wrapped strings + one new bare string
    await writeFile(
      join(srcDir, "Page.tsx"),
      `import { useTranslations } from "next-intl";
export default function Page() {
  const t = useTranslations();
  return <div><p>New text</p><p>{t("existing.key")}</p></div>;
}`,
      "utf-8",
    );

    const messagesDir = join(tempDir, "messages");

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        mappings: [{ index: 0, key: "page.newText" }],
      },
      usage: { inputTokens: 50, outputTokens: 25 },
    } as any);

    const config = makeConfig({
      messagesDir,
      scan: { include: ["src/**/*.tsx"], exclude: [], i18nImport: "next-intl" },
    });

    const result = await runScanStep({ config, cwd: tempDir });

    // Only the bare "New text" should be counted, not the t-call
    expect(result.bareStringCount).toBe(1);
    expect(result.textToKey["New text"]).toBe("page.newText");
  });

  it("preserves existing map entries on keys-mode re-scan of already wrapped files", async () => {
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "Page.tsx"),
      `import { useTranslations } from "next-intl";
export default function Page() {
  const t = useTranslations("common");
  return <div>{t("hello")}</div>;
}`,
      "utf-8",
    );

    const messagesDir = join(tempDir, "messages");
    const existingMap = { Hello: "common.hello" };
    await writeMapFile(messagesDir, existingMap);

    const config = makeConfig({
      mode: "keys",
      messagesDir,
      scan: { include: ["src/**/*.tsx"], exclude: [], i18nImport: "next-intl" },
    });

    const result = await runScanStep({ config, cwd: tempDir });

    expect(result.bareStringCount).toBe(0);
    expect(result.textToKey).toEqual(existingMap);
    expect(result.sourceFlat).toEqual({ "common.hello": "Hello" });
    expect(generateObject).not.toHaveBeenCalled();

    const mapData = await loadMapFile(messagesDir);
    expect(mapData).toEqual(existingMap);
  });
});

describe("runCodegenStep", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-codegen-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("applies codegen with provided textToKey", async () => {
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "App.tsx"),
      `export default function App() {
  return <h1>Hello World</h1>;
}`,
      "utf-8",
    );

    const config = makeConfig({
      messagesDir: join(tempDir, "messages"),
      scan: {
        include: ["src/**/*.tsx"],
        exclude: [],
        i18nImport: "next-intl",
      },
    });

    const result = await runCodegenStep({
      config,
      cwd: tempDir,
      textToKey: { "Hello World": "app.helloWorld" },
    });

    expect(result.filesModified).toBe(1);
    expect(result.stringsWrapped).toBe(1);

    const modified = await readFile(join(srcDir, "App.tsx"), "utf-8");
    // Single namespace "app" → key stripped to "helloWorld"
    expect(modified).toContain('t("helloWorld")');
    expect(modified).toContain('getTranslations("app")');
  });

  it("loads textToKey from map file when not provided", async () => {
    const srcDir = join(tempDir, "src");
    const messagesDir = join(tempDir, "messages");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "App.tsx"),
      `export default function App() {
  return <h1>Hello</h1>;
}`,
      "utf-8",
    );

    await writeMapFile(messagesDir, { Hello: "common.hello" });

    const config = makeConfig({
      messagesDir,
      scan: {
        include: ["src/**/*.tsx"],
        exclude: [],
        i18nImport: "next-intl",
      },
    });

    const result = await runCodegenStep({ config, cwd: tempDir });
    expect(result.stringsWrapped).toBe(1);
  });

  it("throws when no map file and no textToKey", async () => {
    const config = makeConfig({
      messagesDir: join(tempDir, "nonexistent-messages"),
      scan: { include: ["src/**/*.tsx"], exclude: [] },
    });

    await expect(
      runCodegenStep({ config, cwd: tempDir }),
    ).rejects.toThrow("No .translate-map.json found");
  });
});

describe("runTranslateStep", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-translate-"));
    vi.mocked(generateObject).mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("translates source keys to target locale", async () => {
    const messagesDir = join(tempDir, "messages");
    await mkdir(messagesDir, { recursive: true });

    // Write source locale file
    await writeFile(
      join(messagesDir, "en.json"),
      JSON.stringify({ greeting: "Hello" }),
      "utf-8",
    );

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { greeting: "Hola" },
      usage: { inputTokens: 50, outputTokens: 25 },
    } as any);

    const config = makeConfig({
      messagesDir,
      targetLocales: ["es"],
    });

    const result = await runTranslateStep({
      config,
      sourceFlat: { greeting: "Hello" },
    });

    expect(result.localeResults).toHaveLength(1);
    expect(result.localeResults[0].locale).toBe("es");
    expect(result.localeResults[0].translated).toBe(1);

    const targetJson = JSON.parse(
      await readFile(join(messagesDir, "es.json"), "utf-8"),
    );
    expect(targetJson.greeting).toBe("Hola");
  });

  it("dryRun does not call translateAll", async () => {
    const messagesDir = join(tempDir, "messages");
    await mkdir(messagesDir, { recursive: true });
    await writeFile(
      join(messagesDir, "en.json"),
      JSON.stringify({ greeting: "Hello" }),
      "utf-8",
    );

    const config = makeConfig({ messagesDir, targetLocales: ["es"] });

    const result = await runTranslateStep({
      config,
      sourceFlat: { greeting: "Hello" },
      dryRun: true,
    });

    expect(result.localeResults).toHaveLength(1);
    expect(result.localeResults[0].translated).toBe(0);
    // generateObject should NOT be called during dry-run
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("force bypasses lock file cache", async () => {
    const messagesDir = join(tempDir, "messages");
    await mkdir(messagesDir, { recursive: true });

    await writeFile(
      join(messagesDir, "en.json"),
      JSON.stringify({ greeting: "Hello" }),
      "utf-8",
    );

    // Write existing target + lock to simulate a cached state
    await writeFile(
      join(messagesDir, "es.json"),
      JSON.stringify({ greeting: "Hola" }),
      "utf-8",
    );

    // Create a lock file that marks greeting as already translated
    const { hashValue } = await import("../src/diff.js");
    const lockData = { greeting: hashValue("Hello") };
    await writeFile(
      join(messagesDir, ".translate-lock.json"),
      JSON.stringify(lockData),
      "utf-8",
    );

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { greeting: "Hola (updated)" },
      usage: { inputTokens: 50, outputTokens: 25 },
    } as any);

    const config = makeConfig({ messagesDir, targetLocales: ["es"] });

    const result = await runTranslateStep({
      config,
      sourceFlat: { greeting: "Hello" },
      force: true,
    });

    // Should have re-translated despite lock
    expect(result.localeResults[0].translated).toBe(1);
    expect(generateObject).toHaveBeenCalled();
  });

  it("caches unchanged translations", async () => {
    const messagesDir = join(tempDir, "messages");
    await mkdir(messagesDir, { recursive: true });

    await writeFile(
      join(messagesDir, "en.json"),
      JSON.stringify({ greeting: "Hello" }),
      "utf-8",
    );
    await writeFile(
      join(messagesDir, "es.json"),
      JSON.stringify({ greeting: "Hola" }),
      "utf-8",
    );

    const { hashValue } = await import("../src/diff.js");
    await writeFile(
      join(messagesDir, ".translate-lock.json"),
      JSON.stringify({ greeting: hashValue("Hello") }),
      "utf-8",
    );

    const config = makeConfig({ messagesDir, targetLocales: ["es"] });

    const result = await runTranslateStep({
      config,
      sourceFlat: { greeting: "Hello" },
    });

    // Everything cached, nothing new to translate
    expect(result.localeResults[0].translated).toBe(0);
    expect(result.localeResults[0].cached).toBe(1);
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe("loadSplitMessages", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-split-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads and merges namespace files into flat map", async () => {
    const dir = join(tempDir, "en");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hero.json"),
      JSON.stringify({ welcome: "Welcome", getStarted: "Get started" }),
      "utf-8",
    );
    await writeFile(
      join(dir, "common.json"),
      JSON.stringify({ save: "Save" }),
      "utf-8",
    );

    const flat = await loadSplitMessages(dir);
    expect(flat["hero.welcome"]).toBe("Welcome");
    expect(flat["hero.getStarted"]).toBe("Get started");
    expect(flat["common.save"]).toBe("Save");
  });

  it("returns empty object for non-existent directory", async () => {
    const flat = await loadSplitMessages(join(tempDir, "nonexistent"));
    expect(flat).toEqual({});
  });

  it("handles nested keys within namespace files", async () => {
    const dir = join(tempDir, "en");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ profile: { title: "Profile" } }),
      "utf-8",
    );

    const flat = await loadSplitMessages(dir);
    expect(flat["settings.profile.title"]).toBe("Profile");
  });

  it("loads _root.json keys without prefix", async () => {
    const dir = join(tempDir, "en");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "_root.json"),
      JSON.stringify({ greeting: "Hello" }),
      "utf-8",
    );
    await writeFile(
      join(dir, "hero.json"),
      JSON.stringify({ welcome: "Welcome" }),
      "utf-8",
    );

    const flat = await loadSplitMessages(dir);
    expect(flat["greeting"]).toBe("Hello");
    expect(flat["hero.welcome"]).toBe("Welcome");
    expect(flat).not.toHaveProperty("_root.greeting");
  });
});

describe("runScanStep with splitByNamespace", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-split-scan-"));
    vi.mocked(generateObject).mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes split namespace files instead of single JSON", async () => {
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "App.tsx"),
      `export default function App() {
  return <div><h1>Hello World</h1><p>Welcome</p></div>;
}`,
      "utf-8",
    );

    const messagesDir = join(tempDir, "messages");

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        mappings: [
          { index: 0, key: "app.helloWorld" },
          { index: 1, key: "app.welcome" },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as any);

    const config = makeConfig({
      messagesDir,
      splitByNamespace: true,
      scan: { include: ["src/**/*.tsx"], exclude: [] },
    });

    const result = await runScanStep({ config, cwd: tempDir });

    expect(result.bareStringCount).toBe(2);

    // Should write split files
    const appJson = JSON.parse(
      await readFile(join(messagesDir, "en", "app.json"), "utf-8"),
    );
    expect(appJson).toEqual({ helloWorld: "Hello World", welcome: "Welcome" });
  });
});

describe("runTranslateStep with splitByNamespace", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-split-translate-"));
    vi.mocked(generateObject).mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads from split source and writes split target", async () => {
    const messagesDir = join(tempDir, "messages");
    const sourceDir = join(messagesDir, "en");
    await mkdir(sourceDir, { recursive: true });

    await writeFile(
      join(sourceDir, "hero.json"),
      JSON.stringify({ welcome: "Welcome" }),
      "utf-8",
    );

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { "hero.welcome": "Bienvenido" },
      usage: { inputTokens: 50, outputTokens: 25 },
    } as any);

    const config = makeConfig({
      messagesDir,
      splitByNamespace: true,
      targetLocales: ["es"],
    });

    const result = await runTranslateStep({ config, locales: ["es"] });

    expect(result.localeResults).toHaveLength(1);
    expect(result.localeResults[0].translated).toBe(1);

    // Target should be written as split files
    const heroJson = JSON.parse(
      await readFile(join(messagesDir, "es", "hero.json"), "utf-8"),
    );
    expect(heroJson.welcome).toBe("Bienvenido");
  });
});
