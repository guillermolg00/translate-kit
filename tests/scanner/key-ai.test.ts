import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtractedString } from "../../src/types.js";

// Mock the AI SDK
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from "ai";
import { generateSemanticKeys } from "../../src/scanner/key-ai.js";

const mockModel = {} as any;

const mockStrings: ExtractedString[] = [
  {
    text: "Sign in",
    type: "jsx-text",
    file: "src/auth/LoginForm.tsx",
    line: 5,
    column: 0,
    componentName: "LoginForm",
    parentTag: "button",
  },
  {
    text: "Welcome to our platform",
    type: "jsx-text",
    file: "src/components/Hero.tsx",
    line: 3,
    column: 0,
    componentName: "Hero",
    parentTag: "h1",
  },
  {
    text: "Save",
    type: "jsx-text",
    file: "src/components/EditModal.tsx",
    line: 10,
    column: 0,
    componentName: "EditModal",
    parentTag: "button",
  },
  {
    text: "Search...",
    type: "jsx-attribute",
    file: "src/components/SearchBar.tsx",
    line: 4,
    column: 0,
    componentName: "SearchBar",
    propName: "placeholder",
    parentTag: "input",
  },
];

function makeMockResponse(mappings: { index: number; key: string }[]) {
  return {
    object: { mappings },
    finishReason: "stop",
    usage: { inputTokens: 100, outputTokens: 50 },
    rawResponse: undefined,
    toJsonResponse: () => new Response(),
    request: {} as any,
    response: {} as any,
    warnings: undefined,
    providerMetadata: undefined,
  } as any;
}

describe("generateSemanticKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates semantic keys for strings", async () => {
    // After sort by file: LoginForm(0), EditModal(1), Hero(2), SearchBar(3)
    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "auth.signIn" },
        { index: 1, key: "common.save" },
        { index: 2, key: "hero.welcome" },
        { index: 3, key: "common.searchPlaceholder" },
      ]),
    );

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: mockStrings,
    });

    expect(result["Sign in"]).toBe("auth.signIn");
    expect(result["Welcome to our platform"]).toBe("hero.welcome");
    expect(result["Save"]).toBe("common.save");
    expect(result["Search..."]).toBe("common.searchPlaceholder");
  });

  it("preserves existing map entries", async () => {
    const existingMap = {
      "Sign in": "auth.signIn",
    };

    // After sort by file (without Sign in): EditModal(0), Hero(1), SearchBar(2)
    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "common.save" },
        { index: 1, key: "hero.welcome" },
        { index: 2, key: "common.searchPlaceholder" },
      ]),
    );

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: mockStrings,
      existingMap,
    });

    expect(result["Sign in"]).toBe("auth.signIn");
    expect(result["Welcome to our platform"]).toBe("hero.welcome");
    expect(result["Save"]).toBe("common.save");
  });

  it("returns existing map when no new strings", async () => {
    const existingMap = {
      "Sign in": "auth.signIn",
      "Welcome to our platform": "hero.welcome",
      Save: "common.save",
      "Search...": "common.searchPlaceholder",
    };

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: mockStrings,
      existingMap,
    });

    expect(generateObject).not.toHaveBeenCalled();
    expect(result).toEqual(existingMap);
  });

  it("prunes keys from existingMap when text is no longer in strings", async () => {
    const existingMap = {
      "Sign in": "auth.signIn",
      "Welcome to our platform": "hero.welcome",
      "Old removed text": "old.removedText",
      "Another removed": "another.removed",
    };

    // Only "Sign in" and "Welcome" are still in code
    const currentStrings = mockStrings.slice(0, 2);

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: currentStrings,
      existingMap,
    });

    // No new strings → AI should not be called
    expect(generateObject).not.toHaveBeenCalled();
    expect(result["Sign in"]).toBe("auth.signIn");
    expect(result["Welcome to our platform"]).toBe("hero.welcome");
    expect(result["Old removed text"]).toBeUndefined();
    expect(result["Another removed"]).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("preserves existingMap entries for wrapped strings when allTexts is provided", async () => {
    // Simulates: after codegen, most strings are wrapped (T-components/t-calls).
    // scan passes only bare (new) strings, but allTexts includes all texts.
    const existingMap = {
      "Sign in": "auth.signIn",
      "Welcome to our platform": "hero.welcome",
      Save: "common.save",
      "Search...": "common.searchPlaceholder",
    };

    // Only 1 new bare string
    const bareStrings: ExtractedString[] = [
      {
        text: "New feature",
        type: "jsx-text",
        file: "src/components/New.tsx",
        line: 1,
        column: 0,
        componentName: "New",
        parentTag: "h2",
      },
    ];

    // allTexts includes wrapped strings' texts + the new bare string
    const allTexts = new Set([
      "Sign in",
      "Welcome to our platform",
      "Save",
      "Search...",
      "New feature",
    ]);

    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([{ index: 0, key: "features.newFeature" }]),
    );

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: bareStrings,
      existingMap,
      allTexts,
    });

    // All existing entries preserved
    expect(result["Sign in"]).toBe("auth.signIn");
    expect(result["Welcome to our platform"]).toBe("hero.welcome");
    expect(result["Save"]).toBe("common.save");
    expect(result["Search..."]).toBe("common.searchPlaceholder");
    // New entry added
    expect(result["New feature"]).toBe("features.newFeature");
    expect(Object.keys(result)).toHaveLength(5);
  });

  it("without allTexts, only bare strings determine active entries (old behavior)", async () => {
    // This demonstrates the bug when allTexts is NOT provided:
    // existingMap entries whose text is not in `strings` get dropped
    const existingMap = {
      "Sign in": "auth.signIn",
      "Welcome to our platform": "hero.welcome",
    };

    // Only "Sign in" is a bare string; "Welcome" is wrapped
    const bareStrings: ExtractedString[] = [mockStrings[0]]; // "Sign in"

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: bareStrings,
      existingMap,
      // No allTexts → falls back to strings.map(s => s.text)
    });

    // Only "Sign in" is preserved (the one in bare strings)
    expect(result["Sign in"]).toBe("auth.signIn");
    expect(result["Welcome to our platform"]).toBeUndefined(); // Dropped!
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("resolves key collisions with numeric suffix", async () => {
    const existingMap = {
      "Sign in": "auth.signIn",
    };

    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "auth.signIn" },
      ]),
    );

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: [mockStrings[0], mockStrings[1]], // Sign in + Welcome
      existingMap,
    });

    expect(result["Sign in"]).toBe("auth.signIn");
    expect(result["Welcome to our platform"]).toBe("auth.signIn2");
  });

  it("deduplicates strings with same text", async () => {
    const duplicateStrings: ExtractedString[] = [
      ...mockStrings,
      {
        text: "Sign in",
        type: "jsx-text",
        file: "src/other/OtherForm.tsx",
        line: 8,
        column: 0,
        componentName: "OtherForm",
        parentTag: "button",
      },
    ];

    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "auth.signIn" },
        { index: 1, key: "hero.welcome" },
        { index: 2, key: "common.save" },
        { index: 3, key: "common.searchPlaceholder" },
      ]),
    );

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: duplicateStrings,
    });

    expect(Object.keys(result)).toHaveLength(4);
  });

  it("calls onUsage with accumulated tokens", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "auth.signIn" },
        { index: 1, key: "hero.welcome" },
        { index: 2, key: "common.save" },
        { index: 3, key: "common.searchPlaceholder" },
      ]),
    );

    const onUsage = vi.fn();
    await generateSemanticKeys({
      model: mockModel,
      strings: mockStrings,
      onUsage,
    });

    expect(onUsage).toHaveBeenCalledTimes(1);
    const usage = onUsage.mock.calls[0][0];
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
  });

  it("calls onProgress during batch processing", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "auth.signIn" },
        { index: 1, key: "hero.welcome" },
        { index: 2, key: "common.save" },
        { index: 3, key: "common.searchPlaceholder" },
      ]),
    );

    const onProgress = vi.fn();
    await generateSemanticKeys({
      model: mockModel,
      strings: mockStrings,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBe(lastCall[1]); // completed === total
  });

  it("includes route and sibling info in prompt when present", async () => {
    const enrichedStrings: ExtractedString[] = [
      {
        text: "Dashboard",
        type: "jsx-text",
        file: "src/app/dashboard/page.tsx",
        line: 1,
        column: 0,
        componentName: "DashboardPage",
        parentTag: "h1",
        routePath: "dashboard",
        siblingTexts: ["Welcome back", "Your stats"],
        sectionHeading: "Dashboard",
      },
    ];

    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([{ index: 0, key: "dashboard.title" }]),
    );

    await generateSemanticKeys({
      model: mockModel,
      strings: enrichedStrings,
    });

    const call = vi.mocked(generateObject).mock.calls[0][0];
    const prompt = call.prompt as string;
    expect(prompt).toContain("route: dashboard");
    expect(prompt).toContain('siblings: ["Welcome back", "Your stats"]');
  });

  it("groups strings by file in the prompt", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "auth.signIn" },
        { index: 1, key: "hero.welcome" },
        { index: 2, key: "editModal.save" },
        { index: 3, key: "searchBar.placeholder" },
      ]),
    );

    await generateSemanticKeys({
      model: mockModel,
      strings: mockStrings,
    });

    const call = vi.mocked(generateObject).mock.calls[0][0];
    const prompt = call.prompt as string;
    expect(prompt).toContain("--- File: src/auth/LoginForm.tsx ---");
    expect(prompt).toContain("--- File: src/components/Hero.tsx ---");
    expect(prompt).toContain("--- File: src/components/EditModal.tsx ---");
    expect(prompt).toContain("--- File: src/components/SearchBar.tsx ---");
  });

  it("includes existing keys context in prompt", async () => {
    const existingMap = {
      "Sign in": "auth.signIn",
    };

    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "hero.welcome" },
        { index: 1, key: "editModal.save" },
        { index: 2, key: "searchBar.placeholder" },
      ]),
    );

    await generateSemanticKeys({
      model: mockModel,
      strings: mockStrings,
      existingMap,
    });

    const call = vi.mocked(generateObject).mock.calls[0][0];
    const prompt = call.prompt as string;
    expect(prompt).toContain("Existing keys (maintain consistency with these namespaces):");
    expect(prompt).toContain('"Sign in" → auth.signIn');
  });

  it("includes namespace-per-component rules in prompt", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "auth.signIn" },
        { index: 1, key: "hero.welcome" },
        { index: 2, key: "editModal.save" },
        { index: 3, key: "searchBar.placeholder" },
      ]),
    );

    await generateSemanticKeys({
      model: mockModel,
      strings: mockStrings,
    });

    const call = vi.mocked(generateObject).mock.calls[0][0];
    const prompt = call.prompt as string;
    expect(prompt).toContain("CRITICAL: All strings within the same React component MUST share the same namespace prefix");
    expect(prompt).toContain("Derive namespace from: route path > component name > file path section");
    expect(prompt).toContain("Only use cross-cutting namespaces");
  });

  it("resolves path conflicts where a key is both leaf and branch", async () => {
    // AI generates "integrations.integration" as a leaf
    // AND "integrations.integration.name" as another key
    // → "integrations.integration" must be renamed to avoid unflatten conflict
    const conflictStrings: ExtractedString[] = [
      {
        text: "Integration",
        type: "jsx-text",
        file: "src/Integrations.tsx",
        line: 1,
        column: 0,
        componentName: "Integrations",
        parentTag: "h2",
      },
      {
        text: "Integration Name",
        type: "jsx-text",
        file: "src/Integrations.tsx",
        line: 2,
        column: 0,
        componentName: "Integrations",
        parentTag: "span",
      },
      {
        text: "Integration Description",
        type: "jsx-text",
        file: "src/Integrations.tsx",
        line: 3,
        column: 0,
        componentName: "Integrations",
        parentTag: "p",
      },
    ];

    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "integrations.integration" },
        { index: 1, key: "integrations.integration.name" },
        { index: 2, key: "integrations.integration.description" },
      ]),
    );

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: conflictStrings,
    });

    // The leaf key should be renamed to avoid conflict
    expect(result["Integration"]).toBe("integrations.integrationLabel");
    // Child keys remain unchanged
    expect(result["Integration Name"]).toBe("integrations.integration.name");
    expect(result["Integration Description"]).toBe(
      "integrations.integration.description",
    );
  });

  it("sorts strings by file and component before batching", async () => {
    const unorderedStrings: ExtractedString[] = [
      {
        text: "Zebra",
        type: "jsx-text",
        file: "src/z/ZPage.tsx",
        line: 1,
        column: 0,
        componentName: "ZPage",
        parentTag: "h1",
      },
      {
        text: "Alpha",
        type: "jsx-text",
        file: "src/a/APage.tsx",
        line: 1,
        column: 0,
        componentName: "APage",
        parentTag: "h1",
      },
    ];

    vi.mocked(generateObject).mockResolvedValueOnce(
      makeMockResponse([
        { index: 0, key: "aPage.alpha" },
        { index: 1, key: "zPage.zebra" },
      ]),
    );

    await generateSemanticKeys({
      model: mockModel,
      strings: unorderedStrings,
    });

    const call = vi.mocked(generateObject).mock.calls[0][0];
    const prompt = call.prompt as string;
    // After sorting, APage should appear before ZPage
    const aPos = prompt.indexOf("--- File: src/a/APage.tsx ---");
    const zPos = prompt.indexOf("--- File: src/z/ZPage.tsx ---");
    expect(aPos).toBeLessThan(zPos);
  });
});
