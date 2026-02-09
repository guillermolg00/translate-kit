import { describe, it, expect, vi } from "vitest";
import { translateAll } from "../src/translate.js";

// Mock the ai module
vi.mock("ai", () => ({
  generateObject: vi.fn(async ({ prompt, schema }) => {
    // Parse keys from the schema and return mock translations
    const keys = Object.keys(schema.shape);
    const object: Record<string, string> = {};
    for (const key of keys) {
      object[key] = `translated_${key}`;
    }
    return { object };
  }),
}));

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
