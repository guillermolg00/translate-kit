import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/usage.js", () => ({
	estimateCost: vi.fn(),
}));

import { estimateCost } from "../src/usage.js";
import { estimateTranslationCost } from "../src/cost.js";

const mockModel = {} as any;
const mockEstimateCost = vi.mocked(estimateCost);

describe("estimateTranslationCost", () => {
	beforeEach(() => {
		mockEstimateCost.mockReset();
	});

	it("returns token estimates for given entries and locale count", async () => {
		mockEstimateCost.mockResolvedValue(null);

		const result = await estimateTranslationCost(
			mockModel,
			{ "app.hello": "Hello", "app.world": "World" },
			3,
		);

		expect(result.estimatedInputTokens).toBeGreaterThan(0);
		expect(result.estimatedOutputTokens).toBeGreaterThan(0);
		expect(result.totalTokens).toBe(
			result.estimatedInputTokens + result.estimatedOutputTokens,
		);
	});

	it("returns null cost when estimateCost returns null", async () => {
		mockEstimateCost.mockResolvedValue(null);

		const result = await estimateTranslationCost(
			mockModel,
			{ "app.hello": "Hello" },
			2,
		);

		expect(result.estimatedCostUSD).toBeNull();
	});

	it("returns cost USD when estimateCost returns a value", async () => {
		mockEstimateCost.mockResolvedValue({
			totalUSD: 0.05,
			inputUSD: 0.03,
			outputUSD: 0.02,
		});

		const result = await estimateTranslationCost(
			mockModel,
			{ "app.hello": "Hello", "app.world": "World" },
			2,
		);

		expect(result.estimatedCostUSD).toBe(0.05);
	});

	it("scales with locale count", async () => {
		mockEstimateCost.mockResolvedValue(null);

		const entries = { "app.hello": "Hello world" };
		const result1 = await estimateTranslationCost(mockModel, entries, 1);
		const result2 = await estimateTranslationCost(mockModel, entries, 5);

		expect(result2.estimatedInputTokens).toBeGreaterThan(
			result1.estimatedInputTokens,
		);
		expect(result2.estimatedOutputTokens).toBe(
			result1.estimatedOutputTokens * 5,
		);
	});
});
