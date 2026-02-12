import type { LanguageModel } from "ai";
import { fetchModels, getTokenCosts } from "tokenlens";

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export function createUsageTracker() {
	let inputTokens = 0;
	let outputTokens = 0;
	return {
		add(usage: { inputTokens?: number; outputTokens?: number }) {
			inputTokens += usage.inputTokens ?? 0;
			outputTokens += usage.outputTokens ?? 0;
		},
		get(): TokenUsage {
			return {
				inputTokens,
				outputTokens,
				totalTokens: inputTokens + outputTokens,
			};
		},
	};
}

export async function estimateCost(
	model: LanguageModel,
	usage: TokenUsage,
): Promise<{ totalUSD: number; inputUSD: number; outputUSD: number } | null> {
	try {
		const m = model as Record<string, unknown>;
		const provider = typeof m.provider === "string" ? m.provider : "unknown";
		const modelId = typeof m.modelId === "string" ? m.modelId : "unknown";
		const fullId = `${provider}/${modelId}`;
		const providers = await fetchModels(provider);
		const costs = getTokenCosts({
			modelId: fullId,
			usage: {
				prompt_tokens: usage.inputTokens,
				completion_tokens: usage.outputTokens,
			},
			providers,
		});
		if (costs.totalUSD == null) return null;
		return {
			totalUSD: costs.totalUSD,
			inputUSD: costs.inputUSD ?? 0,
			outputUSD: costs.outputUSD ?? 0,
		};
	} catch {
		return null;
	}
}

export function formatUsage(usage: TokenUsage): string {
	return `${usage.inputTokens.toLocaleString()} in + ${usage.outputTokens.toLocaleString()} out = ${usage.totalTokens.toLocaleString()} tokens`;
}

export function formatCost(usd: number): string {
	return usd < 0.01 ? `~$${usd.toFixed(4)}` : `~$${usd.toFixed(2)}`;
}
