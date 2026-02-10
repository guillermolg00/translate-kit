import { describe, it, expect, vi, beforeEach } from "vitest";
import { translateAll } from "../src/translate.js";
import { generateObject } from "ai";

// Mock the ai module
vi.mock("ai", () => ({
  generateObject: vi.fn(async ({ prompt, schema }) => {
    const keys = Object.keys(schema.shape);
    const object: Record<string, string> = {};
    for (const key of keys) {
      object[key] = `translated_${key}`;
    }
    return { object, usage: { inputTokens: 100, outputTokens: 50 } };
  }),
}));

const mockGenerateObject = vi.mocked(generateObject);

const mockModel = {} as any;

describe("translateAll", () => {
  it("translates a simple set of entries", async () => {
    const result = await translateAll({
      model: mockModel,
      entries: { "app.title": "Hello", "app.sub": "World" },
      sourceLocale: "en",
      targetLocale: "es",
    });

    expect(result).toEqual({
      "app.title": "translated_app.title",
      "app.sub": "translated_app.sub",
    });
  });

  it("returns empty object for empty entries", async () => {
    const result = await translateAll({
      model: mockModel,
      entries: {},
      sourceLocale: "en",
      targetLocale: "es",
    });

    expect(result).toEqual({});
  });

  it("splits entries into batches", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      entries[`key.${i}`] = `value ${i}`;
    }

    const batches: Record<string, string>[] = [];
    const result = await translateAll({
      model: mockModel,
      entries,
      sourceLocale: "en",
      targetLocale: "es",
      options: { batchSize: 2 },
      onBatchComplete: (translated) => batches.push({ ...translated }),
    });

    expect(Object.keys(result)).toHaveLength(5);
    expect(batches.length).toBe(3); // 2 + 2 + 1
  });

  it("calls onBatchComplete for each batch", async () => {
    const onBatchComplete = vi.fn();

    await translateAll({
      model: mockModel,
      entries: { a: "1", b: "2", c: "3" },
      sourceLocale: "en",
      targetLocale: "es",
      options: { batchSize: 2 },
      onBatchComplete,
    });

    expect(onBatchComplete).toHaveBeenCalledTimes(2);
  });
});

describe("placeholder validation", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  it("passes when placeholders are preserved", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { greeting: "Hola {name}!" },
      usage: {} as any,
      finishReason: "stop" as any,
      rawResponse: undefined,
      response: {} as any,
      request: {} as any,
      warnings: undefined,
      experimental_providerMetadata: undefined,
      providerMetadata: undefined,
      toJsonResponse: (() => {}) as any,
    });

    const result = await translateAll({
      model: mockModel,
      entries: { greeting: "Hello {name}!" },
      sourceLocale: "en",
      targetLocale: "es",
    });

    expect(result.greeting).toBe("Hola {name}!");
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("retries when placeholder is missing and succeeds on retry", async () => {
    mockGenerateObject
      .mockResolvedValueOnce({
        object: { greeting: "Hola!" },
        usage: {} as any,
        finishReason: "stop" as any,
        rawResponse: undefined,
        response: {} as any,
        request: {} as any,
        warnings: undefined,
        experimental_providerMetadata: undefined,
        providerMetadata: undefined,
        toJsonResponse: (() => {}) as any,
      })
      .mockResolvedValueOnce({
        object: { greeting: "Hola {name}!" },
        usage: {} as any,
        finishReason: "stop" as any,
        rawResponse: undefined,
        response: {} as any,
        request: {} as any,
        warnings: undefined,
        experimental_providerMetadata: undefined,
        providerMetadata: undefined,
        toJsonResponse: (() => {}) as any,
      });

    const result = await translateAll({
      model: mockModel,
      entries: { greeting: "Hello {name}!" },
      sourceLocale: "en",
      targetLocale: "es",
      options: { retries: 2 },
    });

    expect(result.greeting).toBe("Hola {name}!");
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it("returns result with warning when all retries fail placeholder validation", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { greeting: "Hola!" },
      usage: {} as any,
      finishReason: "stop" as any,
      rawResponse: undefined,
      response: {} as any,
      request: {} as any,
      warnings: undefined,
      experimental_providerMetadata: undefined,
      providerMetadata: undefined,
      toJsonResponse: (() => {}) as any,
    });

    const result = await translateAll({
      model: mockModel,
      entries: { greeting: "Hello {name}!" },
      sourceLocale: "en",
      targetLocale: "es",
      options: { retries: 1 },
    });

    // Should still return the result (not throw)
    expect(result.greeting).toBe("Hola!");
    // 1 initial + 1 retry = 2 calls
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it("skips validation when validatePlaceholders is false", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { greeting: "Hola!" },
      usage: {} as any,
      finishReason: "stop" as any,
      rawResponse: undefined,
      response: {} as any,
      request: {} as any,
      warnings: undefined,
      experimental_providerMetadata: undefined,
      providerMetadata: undefined,
      toJsonResponse: (() => {}) as any,
    });

    const result = await translateAll({
      model: mockModel,
      entries: { greeting: "Hello {name}!" },
      sourceLocale: "en",
      targetLocale: "es",
      options: { validatePlaceholders: false, retries: 2 },
    });

    expect(result.greeting).toBe("Hola!");
    // No retries even though placeholder is missing
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("does not retry for strings without placeholders", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { greeting: "Hola mundo" },
      usage: {} as any,
      finishReason: "stop" as any,
      rawResponse: undefined,
      response: {} as any,
      request: {} as any,
      warnings: undefined,
      experimental_providerMetadata: undefined,
      providerMetadata: undefined,
      toJsonResponse: (() => {}) as any,
    });

    const result = await translateAll({
      model: mockModel,
      entries: { greeting: "Hello world" },
      sourceLocale: "en",
      targetLocale: "es",
    });

    expect(result.greeting).toBe("Hola mundo");
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });
});

describe("onUsage callback", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
    mockGenerateObject.mockImplementation(async ({ schema }: any) => {
      const keys = Object.keys(schema.shape);
      const object: Record<string, string> = {};
      for (const key of keys) {
        object[key] = `translated_${key}`;
      }
      return { object, usage: { inputTokens: 100, outputTokens: 50 } };
    });
  });

  it("calls onUsage with accumulated token counts", async () => {
    const onUsage = vi.fn();

    await translateAll({
      model: mockModel,
      entries: { a: "1", b: "2", c: "3" },
      sourceLocale: "en",
      targetLocale: "es",
      options: { batchSize: 2 },
      onUsage,
    });

    expect(onUsage).toHaveBeenCalledTimes(1);
    const usage = onUsage.mock.calls[0][0];
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
  });
});

describe("onProgress callback", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
    mockGenerateObject.mockImplementation(async ({ schema }: any) => {
      const keys = Object.keys(schema.shape);
      const object: Record<string, string> = {};
      for (const key of keys) {
        object[key] = `translated_${key}`;
      }
      return { object, usage: { inputTokens: 100, outputTokens: 50 } };
    });
  });

  it("calls onProgress with increasing values", async () => {
    const progress: [number, number][] = [];

    await translateAll({
      model: mockModel,
      entries: { a: "1", b: "2", c: "3" },
      sourceLocale: "en",
      targetLocale: "es",
      options: { batchSize: 2, concurrency: 1 },
      onProgress: (c, t) => progress.push([c, t]),
    });

    expect(progress.length).toBe(2); // 2 batches
    expect(progress[progress.length - 1][0]).toBe(3); // all 3 keys completed
    expect(progress[0][1]).toBe(3); // total is always 3
  });
});
