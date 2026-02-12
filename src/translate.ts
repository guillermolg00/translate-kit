import { generateObject, type LanguageModel } from "ai";
import pLimit from "p-limit";
import { z } from "zod";
import { logWarning } from "./logger.js";
import type { TranslationOptions } from "./types.js";
import { validateBatch } from "./validate.js";

interface TranslateBatchInput {
	model: LanguageModel;
	entries: Record<string, string>;
	sourceLocale: string;
	targetLocale: string;
	options?: TranslationOptions;
}

function buildPrompt(
	entries: Record<string, string>,
	sourceLocale: string,
	targetLocale: string,
	options?: TranslationOptions,
): string {
	const lines = [
		`Translate the following strings from "${sourceLocale}" to "${targetLocale}".`,
		"",
		"Rules:",
		"- Preserve all placeholders like {name}, {{count}}, %s, %d exactly as-is",
		"- Preserve HTML tags and markdown formatting",
		"- Do NOT translate proper nouns, brand names, or technical identifiers",
		"- Maintain the same level of formality and register",
		"- Return natural, fluent translations (not word-for-word)",
	];

	if (options?.tone) {
		lines.push(`- Use a ${options.tone} tone`);
	}

	if (options?.context) {
		lines.push(`\nContext: ${options.context}`);
	}

	if (options?.glossary && Object.keys(options.glossary).length > 0) {
		lines.push("\nGlossary (use these exact translations):");
		for (const [term, translation] of Object.entries(options.glossary)) {
			lines.push(`  "${term}" → "${translation}"`);
		}
	}

	lines.push("\nStrings to translate:");
	for (const [key, value] of Object.entries(entries)) {
		lines.push(`  "${key}": "${value}"`);
	}

	return lines.join("\n");
}

function buildSchema(keys: string[]): z.ZodObject<Record<string, z.ZodString>> {
	const shape: Record<string, z.ZodString> = {};
	for (const key of keys) {
		shape[key] = z.string();
	}
	return z.object(shape);
}

interface BatchResult {
	translations: Record<string, string>;
	usage: { inputTokens: number; outputTokens: number };
}

async function translateBatchWithRetry(
	input: TranslateBatchInput,
	retries: number,
): Promise<BatchResult> {
	const { model, entries, sourceLocale, targetLocale, options } = input;
	const keys = Object.keys(entries);
	const prompt = buildPrompt(entries, sourceLocale, targetLocale, options);
	const schema = buildSchema(keys);

	const shouldValidate = options?.validatePlaceholders !== false;
	let lastError: Error | undefined;
	const totalUsage = { inputTokens: 0, outputTokens: 0 };

	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const { object, usage } = await generateObject({
				model,
				prompt,
				schema,
			});

			totalUsage.inputTokens += usage.inputTokens ?? 0;
			totalUsage.outputTokens += usage.outputTokens ?? 0;

			if (shouldValidate) {
				const validation = validateBatch(entries, object);
				if (!validation.valid) {
					if (attempt < retries) {
						logWarning(
							`Placeholder mismatch in batch (attempt ${attempt + 1}/${retries + 1}), retrying...`,
						);
						continue;
					}
					for (const failure of validation.failures) {
						logWarning(
							`Placeholder mismatch for key "${failure.key}": missing=[${failure.missing.join(", ")}] extra=[${failure.extra.join(", ")}]`,
						);
					}
				}
			}

			return { translations: object, usage: totalUsage };
		} catch (error) {
			lastError = error as Error;
			if (attempt < retries) {
				const delay = Math.min(2 ** attempt * 1000, 30_000);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	throw lastError;
}

export interface TranslateAllInput {
	model: LanguageModel;
	entries: Record<string, string>;
	sourceLocale: string;
	targetLocale: string;
	options?: TranslationOptions;
	onBatchComplete?: (translated: Record<string, string>) => void;
	onProgress?: (completed: number, total: number) => void;
	onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export async function translateAll(
	input: TranslateAllInput,
): Promise<Record<string, string>> {
	const {
		model,
		entries,
		sourceLocale,
		targetLocale,
		options,
		onBatchComplete,
		onProgress,
		onUsage,
	} = input;

	const keys = Object.keys(entries);
	if (keys.length === 0) return {};

	const batchSize = options?.batchSize ?? 50;
	const concurrency = options?.concurrency ?? 3;
	const retries = options?.retries ?? 2;
	const limit = pLimit(concurrency);

	const batches: Record<string, string>[] = [];
	for (let i = 0; i < keys.length; i += batchSize) {
		const batchKeys = keys.slice(i, i + batchSize);
		const batch: Record<string, string> = {};
		for (const key of batchKeys) {
			batch[key] = entries[key];
		}
		batches.push(batch);
	}

	const results: Record<string, string> = {};
	let completedKeys = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;

	await Promise.all(
		batches.map((batch) =>
			limit(async () => {
				const { translations, usage } = await translateBatchWithRetry(
					{ model, entries: batch, sourceLocale, targetLocale, options },
					retries,
				);
				Object.assign(results, translations);
				totalInputTokens += usage.inputTokens;
				totalOutputTokens += usage.outputTokens;
				completedKeys += Object.keys(batch).length;
				onProgress?.(completedKeys, keys.length);
				onBatchComplete?.(translations);
			}),
		),
	);

	if (totalInputTokens > 0 || totalOutputTokens > 0) {
		onUsage?.({
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
		});
	}

	return results;
}
