export function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateEntryTokens(key: string, value: string): number {
	return estimateTokens(key) + estimateTokens(value);
}

export function estimateTotalTokens(entries: Record<string, string>): number {
	let total = 0;
	for (const [key, value] of Object.entries(entries)) {
		total += estimateEntryTokens(key, value);
	}
	return total;
}
