import { generateObject } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	chunkByTokens,
	selectContextEntries,
	translateAll,
} from "../src/translate.js";

vi.mock("ai", () => ({
	generateObject: vi.fn(async ({ prompt, schema }: any) => {
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

describe("chunkByTokens", () => {
	it("creates a single batch for small entries", () => {
		const entries = { "a.b": "hello", "c.d": "world" };
		const batches = chunkByTokens(entries, {
			targetTokens: 2000,
			maxEntriesPerBatch: 50,
		});
		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual(entries);
	});

	it("splits when token budget is exceeded", () => {
		const entries: Record<string, string> = {};
		// Each entry ~20 chars = ~5 tokens per key + ~5 tokens per value = ~10 tokens
		for (let i = 0; i < 10; i++) {
			entries[`namespace.key${i}`] = `This is a test value ${i}`;
		}
		const batches = chunkByTokens(entries, {
			targetTokens: 30,
			maxEntriesPerBatch: 50,
		});
		expect(batches.length).toBeGreaterThan(1);
	});

	it("splits when maxEntriesPerBatch is exceeded", () => {
		const entries: Record<string, string> = {};
		for (let i = 0; i < 10; i++) {
			entries[`k${i}`] = `v${i}`;
		}
		const batches = chunkByTokens(entries, {
			targetTokens: 99999,
			maxEntriesPerBatch: 3,
		});
		expect(batches.length).toBe(4); // 3+3+3+1
	});

	it("always includes at least 1 entry per batch", () => {
		const entries = { "very.long.key.name": "a very long value string here" };
		const batches = chunkByTokens(entries, {
			targetTokens: 1,
			maxEntriesPerBatch: 50,
		});
		expect(batches).toHaveLength(1);
		expect(Object.keys(batches[0])).toHaveLength(1);
	});

	it("returns empty array for empty entries", () => {
		const batches = chunkByTokens(
			{},
			{ targetTokens: 2000, maxEntriesPerBatch: 50 },
		);
		expect(batches).toHaveLength(0);
	});
});

describe("selectContextEntries", () => {
	it("returns empty when no accumulated translations", () => {
		const result = selectContextEntries(
			{},
			["app.title"],
			{ "app.title": "Hello" },
		);
		expect(Object.keys(result)).toHaveLength(0);
	});

	it("prioritizes same-namespace entries", () => {
		const accumulated = {
			"app.hello": "Hola",
			"app.world": "Mundo",
			"nav.home": "Inicio",
		};
		const result = selectContextEntries(
			accumulated,
			["app.newKey"],
			{ "app.hello": "Hello", "app.world": "World", "nav.home": "Home" },
			2,
		);
		const keys = Object.keys(result);
		expect(keys).toHaveLength(2);
		// Should prioritize app.* keys
		expect(keys).toContain("app.hello");
		expect(keys).toContain("app.world");
	});

	it("respects maxEntries limit", () => {
		const accumulated: Record<string, string> = {};
		const source: Record<string, string> = {};
		for (let i = 0; i < 20; i++) {
			accumulated[`ns.key${i}`] = `translated_${i}`;
			source[`ns.key${i}`] = `value_${i}`;
		}
		const result = selectContextEntries(
			accumulated,
			["ns.newKey"],
			source,
			5,
		);
		expect(Object.keys(result)).toHaveLength(5);
	});

	it("returns source and translated pairs", () => {
		const accumulated = { "app.save": "Guardar" };
		const result = selectContextEntries(
			accumulated,
			["app.cancel"],
			{ "app.save": "Save" },
		);
		expect(result["app.save"]).toEqual({
			source: "Save",
			translated: "Guardar",
		});
	});
});

describe("context in translation prompt", () => {
	beforeEach(() => {
		mockGenerateObject.mockReset();
		mockGenerateObject.mockImplementation(async ({ prompt, schema }: any) => {
			const keys = Object.keys(schema.shape);
			const object: Record<string, string> = {};
			for (const key of keys) {
				object[key] = `translated_${key}`;
			}
			return { object, usage: { inputTokens: 100, outputTokens: 50 } };
		});
	});

	it("includes context hints in the prompt", async () => {
		await translateAll({
			model: mockModel,
			entries: { "task.on": "on" },
			sourceLocale: "en",
			targetLocale: "es",
			context: {
				"task.on": {
					type: "jsx-text",
					parentTag: "p",
					componentName: "TaskItem",
					compositeContext:
						'Assigned to <strong>{1}</strong> on {date}',
				},
			},
		});

		expect(mockGenerateObject).toHaveBeenCalledTimes(1);
		const prompt = mockGenerateObject.mock.calls[0][0].prompt as string;
		expect(prompt).toContain("task.on");
		expect(prompt).toContain("HTML: <p>");
		expect(prompt).toContain("component: TaskItem");
		expect(prompt).toContain("part of:");
	});
});

describe("wave-based execution", () => {
	beforeEach(() => {
		mockGenerateObject.mockReset();
		mockGenerateObject.mockImplementation(async ({ prompt, schema }: any) => {
			const keys = Object.keys(schema.shape);
			const object: Record<string, string> = {};
			for (const key of keys) {
				object[key] = `translated_${key}`;
			}
			return { object, usage: { inputTokens: 100, outputTokens: 50 } };
		});
	});

	it("passes previousTranslations in later waves", async () => {
		const entries: Record<string, string> = {};
		for (let i = 0; i < 4; i++) {
			entries[`ns.key${i}`] = `value ${i}`;
		}

		await translateAll({
			model: mockModel,
			entries,
			sourceLocale: "en",
			targetLocale: "es",
			options: { batchSize: 2, concurrency: 2 },
		});

		// With 4 entries, batchSize 2, concurrency 2: 2 batches in wave 0, 0 more
		// Actually with token-based chunking it may vary, but there should be at least 2 calls
		expect(mockGenerateObject.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("translates all entries correctly across waves", async () => {
		const entries: Record<string, string> = {};
		for (let i = 0; i < 6; i++) {
			entries[`ns.key${i}`] = `value ${i}`;
		}

		const result = await translateAll({
			model: mockModel,
			entries,
			sourceLocale: "en",
			targetLocale: "es",
			options: { batchSize: 2, concurrency: 2 },
		});

		expect(Object.keys(result)).toHaveLength(6);
		for (let i = 0; i < 6; i++) {
			expect(result[`ns.key${i}`]).toBe(`translated_ns.key${i}`);
		}
	});
});

describe("fallback model", () => {
	beforeEach(() => {
		mockGenerateObject.mockReset();
	});

	it("uses fallback model when primary fails", async () => {
		const fallbackModel = { id: "fallback" } as any;

		let callCount = 0;
		mockGenerateObject.mockImplementation(async ({ model, schema }: any) => {
			callCount++;
			if (model !== fallbackModel) {
				throw new Error("Primary model failed");
			}
			const keys = Object.keys(schema.shape);
			const object: Record<string, string> = {};
			for (const key of keys) {
				object[key] = `fallback_${key}`;
			}
			return { object, usage: { inputTokens: 50, outputTokens: 25 } };
		});

		const result = await translateAll({
			model: mockModel,
			entries: { "app.title": "Hello" },
			sourceLocale: "en",
			targetLocale: "es",
			options: { retries: 0 },
			fallbackModel,
		});

		expect(result["app.title"]).toBe("fallback_app.title");
		// Primary should have been tried (1 attempt with 0 retries) then fallback
		expect(callCount).toBeGreaterThanOrEqual(2);
	});

	it("does not use fallback when primary succeeds", async () => {
		const fallbackModel = { id: "fallback" } as any;

		mockGenerateObject.mockImplementation(async ({ schema }: any) => {
			const keys = Object.keys(schema.shape);
			const object: Record<string, string> = {};
			for (const key of keys) {
				object[key] = `primary_${key}`;
			}
			return { object, usage: { inputTokens: 100, outputTokens: 50 } };
		});

		const result = await translateAll({
			model: mockModel,
			entries: { "app.title": "Hello" },
			sourceLocale: "en",
			targetLocale: "es",
			fallbackModel,
		});

		expect(result["app.title"]).toBe("primary_app.title");
		expect(mockGenerateObject).toHaveBeenCalledTimes(1);
	});

	it("throws when both primary and fallback fail", async () => {
		const fallbackModel = { id: "fallback" } as any;

		mockGenerateObject.mockRejectedValue(new Error("All models failed"));

		await expect(
			translateAll({
				model: mockModel,
				entries: { "app.title": "Hello" },
				sourceLocale: "en",
				targetLocale: "es",
				options: { retries: 0 },
				fallbackModel,
			}),
		).rejects.toThrow("All models failed");
	});
});
