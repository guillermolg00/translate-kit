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

describe("generateSemanticKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates semantic keys for strings", async () => {
    const mockResponse = {
      "Sign in": "auth.signIn",
      "Welcome to our platform": "hero.welcome",
      Save: "common.save",
      "Search...": "common.searchPlaceholder",
    };

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: mockResponse,
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50 },
      rawResponse: undefined,
      toJsonResponse: () => new Response(),
      request: {} as any,
      response: {} as any,
      warnings: undefined,
      providerMetadata: undefined,
    } as any);

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

    const mockResponse = {
      "Welcome to our platform": "hero.welcome",
      Save: "common.save",
      "Search...": "common.searchPlaceholder",
    };

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: mockResponse,
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50 },
      rawResponse: undefined,
      toJsonResponse: () => new Response(),
      request: {} as any,
      response: {} as any,
      warnings: undefined,
      providerMetadata: undefined,
    } as any);

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

  it("resolves key collisions with numeric suffix", async () => {
    const existingMap = {
      "Sign in": "auth.signIn",
    };

    const mockResponse = {
      "Welcome to our platform": "auth.signIn",
    };

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: mockResponse,
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50 },
      rawResponse: undefined,
      toJsonResponse: () => new Response(),
      request: {} as any,
      response: {} as any,
      warnings: undefined,
      providerMetadata: undefined,
    } as any);

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

    const mockResponse = {
      "Sign in": "auth.signIn",
      "Welcome to our platform": "hero.welcome",
      Save: "common.save",
      "Search...": "common.searchPlaceholder",
    };

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: mockResponse,
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50 },
      rawResponse: undefined,
      toJsonResponse: () => new Response(),
      request: {} as any,
      response: {} as any,
      warnings: undefined,
      providerMetadata: undefined,
    } as any);

    const result = await generateSemanticKeys({
      model: mockModel,
      strings: duplicateStrings,
    });

    expect(Object.keys(result)).toHaveLength(4);
  });
});
