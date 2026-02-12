import { describe, expect, it, vi } from "vitest";
import {
	createUsageTracker,
	estimateCost,
	formatCost,
	formatUsage,
} from "../src/usage.js";

vi.mock("tokenlens", () => ({
	fetchModels: vi.fn(async () => ({
		"openai/gpt-4o": {
			pricing: { prompt: "0.0025", completion: "0.01" },
		},
	})),
	getTokenCosts: vi.fn(
		(args: {
			modelId: string;
			usage: { prompt_tokens: number; completion_tokens: number };
			providers: any;
		}) => ({
			inputUSD: args.usage.prompt_tokens * 0.0000025,
			outputUSD: args.usage.completion_tokens * 0.00001,
			totalUSD:
				args.usage.prompt_tokens * 0.0000025 +
				args.usage.completion_tokens * 0.00001,
		}),
	),
}));

describe("createUsageTracker", () => {
	it("starts at zero", () => {
		const tracker = createUsageTracker();
		expect(tracker.get()).toEqual({
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
		});
	});

	it("accumulates multiple add() calls", () => {
		const tracker = createUsageTracker();
		tracker.add({ inputTokens: 100, outputTokens: 50 });
		tracker.add({ inputTokens: 200, outputTokens: 75 });
		expect(tracker.get()).toEqual({
			inputTokens: 300,
			outputTokens: 125,
			totalTokens: 425,
		});
	});

	it("handles undefined fields gracefully", () => {
		const tracker = createUsageTracker();
		tracker.add({});
		tracker.add({ inputTokens: 10 });
		tracker.add({ outputTokens: 20 });
		expect(tracker.get()).toEqual({
			inputTokens: 10,
			outputTokens: 20,
			totalTokens: 30,
		});
	});
});

describe("formatUsage", () => {
	it("formats usage correctly", () => {
		const result = formatUsage({
			inputTokens: 1500,
			outputTokens: 300,
			totalTokens: 1800,
		});
		expect(result).toContain("1,500");
		expect(result).toContain("300");
		expect(result).toContain("1,800");
		expect(result).toContain("tokens");
	});
});

describe("formatCost", () => {
	it("shows 4 decimals for costs under $0.01", () => {
		expect(formatCost(0.0023)).toBe("~$0.0023");
	});

	it("shows 2 decimals for costs >= $0.01", () => {
		expect(formatCost(0.15)).toBe("~$0.15");
	});

	it("shows 2 decimals for larger costs", () => {
		expect(formatCost(1.5)).toBe("~$1.50");
	});
});

describe("estimateCost", () => {
	it("calculates cost using tokenlens", async () => {
		const mockModel = { provider: "openai", modelId: "gpt-4o" } as any;
		const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };

		const result = await estimateCost(mockModel, usage);

		expect(result).not.toBeNull();
		expect(result!.totalUSD).toBeGreaterThan(0);
		expect(result!.inputUSD).toBeGreaterThan(0);
		expect(result!.outputUSD).toBeGreaterThan(0);
	});

	it("returns null for model without pricing", async () => {
		const { getTokenCosts } = await import("tokenlens");
		vi.mocked(getTokenCosts).mockImplementationOnce(() => {
			throw new Error("Model not found");
		});

		const mockModel = { provider: "unknown", modelId: "unknown-model" } as any;
		const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

		const result = await estimateCost(mockModel, usage);
		expect(result).toBeNull();
	});
});
