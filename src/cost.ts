import type { LanguageModel } from "ai";
import { estimateTotalTokens } from "./tokens.js";
import type { TranslationOptions } from "./types.js";
import { estimateCost } from "./usage.js";

export interface CostEstimate {
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
	totalTokens: number;
	estimatedCostUSD: number | null;
}

export async function estimateTranslationCost(
	model: LanguageModel,
	entries: Record<string, string>,
	localeCount: number,
	options?: TranslationOptions,
): Promise<CostEstimate> {
	const entryTokens = estimateTotalTokens(entries);
	const batchSize = options?.batchSize ?? 50;
	const entryCount = Object.keys(entries).length;
	const batchCount = Math.max(1, Math.ceil(entryCount / batchSize));

	// Prompt overhead: ~200 tokens per batch for instructions/rules
	const promptOverhead = batchCount * 200;
	const estimatedInputTokens = (entryTokens + promptOverhead) * localeCount;
	// Output tokens roughly equal to entry tokens (translated strings ~ same length)
	const estimatedOutputTokens = entryTokens * localeCount;
	const totalTokens = estimatedInputTokens + estimatedOutputTokens;

	let estimatedCostUSD: number | null = null;
	const costResult = await estimateCost(model, {
		inputTokens: estimatedInputTokens,
		outputTokens: estimatedOutputTokens,
		totalTokens,
	});
	if (costResult) {
		estimatedCostUSD = costResult.totalUSD;
	}

	return {
		estimatedInputTokens,
		estimatedOutputTokens,
		totalTokens,
		estimatedCostUSD,
	};
}
