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
    expect(modified).toContain('t("app.helloWorld")');
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
