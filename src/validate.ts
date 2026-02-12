const PLACEHOLDER_REGEX =
	/\{\{[\w.]+\}\}|\{[\w.]+\}|\{\d+\}|%[sd@]|%\.\d+f|<\/?[\w-]+(?:\s[^>]*)?\s*\/?>|<\/[\w-]+>/g;

export function extractPlaceholders(text: string): string[] {
	const matches = text.match(PLACEHOLDER_REGEX);
	if (!matches) return [];
	return matches.slice().sort();
}

export interface PlaceholderValidation {
	valid: boolean;
	missing: string[];
	extra: string[];
}

export function validatePlaceholders(
	source: string,
	translated: string,
): PlaceholderValidation {
	const sourcePlaceholders = extractPlaceholders(source);
	const translatedPlaceholders = extractPlaceholders(translated);

	const sourceCount = new Map<string, number>();
	for (const p of sourcePlaceholders) {
		sourceCount.set(p, (sourceCount.get(p) ?? 0) + 1);
	}

	const translatedCount = new Map<string, number>();
	for (const p of translatedPlaceholders) {
		translatedCount.set(p, (translatedCount.get(p) ?? 0) + 1);
	}

	const missing: string[] = [];
	const extra: string[] = [];

	for (const [placeholder, count] of sourceCount) {
		const tCount = translatedCount.get(placeholder) ?? 0;
		for (let i = 0; i < count - tCount; i++) {
			missing.push(placeholder);
		}
	}

	for (const [placeholder, count] of translatedCount) {
		const sCount = sourceCount.get(placeholder) ?? 0;
		for (let i = 0; i < count - sCount; i++) {
			extra.push(placeholder);
		}
	}

	return {
		valid: missing.length === 0 && extra.length === 0,
		missing,
		extra,
	};
}

export interface BatchValidation {
	valid: boolean;
	failures: Array<{
		key: string;
		missing: string[];
		extra: string[];
	}>;
}

export function validateBatch(
	sourceEntries: Record<string, string>,
	translatedEntries: Record<string, string>,
): BatchValidation {
	const failures: BatchValidation["failures"] = [];

	for (const key of Object.keys(sourceEntries)) {
		const source = sourceEntries[key];
		const translated = translatedEntries[key];
		if (translated == null) continue;

		const result = validatePlaceholders(source, translated);
		if (!result.valid) {
			failures.push({ key, missing: result.missing, extra: result.extra });
		}
	}

	return {
		valid: failures.length === 0,
		failures,
	};
}
