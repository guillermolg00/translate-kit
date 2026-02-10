import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
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
    expect(content).toContain('t("page.hello")');
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
    vi.spyOn(transformModule, "transform")
      .mockReturnValueOnce({
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
});
