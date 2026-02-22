import { generateObject, type LanguageModel } from "ai";
import pLimit from "p-limit";
import { z } from "zod";
import { logWarning } from "./logger.js";
import { estimateEntryTokens } from "./tokens.js";
import type { TranslationContextEntry, TranslationOptions } from "./types.js";
import { validateBatch } from "./validate.js";

interface TranslateBatchInput {
	model: LanguageModel;
	entries: Record<string, string>;
	sourceLocale: string;
	targetLocale: string;
	options?: TranslationOptions;
	context?: Record<string, TranslationContextEntry>;
	previousTranslations?: Record<string, { source: string; translated: string }>;
	fallbackModel?: LanguageModel;
}

function buildContextHint(
	key: string,
	ctx: TranslationContextEntry,
): string | undefined {
	const hints: string[] = [];
	if (ctx.compositeContext) hints.push(`part of: "${ctx.compositeContext}"`);
	if (ctx.parentTag) hints.push(`HTML: <${ctx.parentTag}>`);
	if (ctx.componentName) hints.push(`component: ${ctx.componentName}`);
	if (ctx.propName) hints.push(`prop: ${ctx.propName}`);
	if (ctx.routePath) hints.push(`route: ${ctx.routePath}`);
	if (hints.length === 0) return undefined;
	return `    ^ ${hints.join(", ")}`;
}

function buildPrompt(
	entries: Record<string, string>,
	sourceLocale: string,
	targetLocale: string,
	options?: TranslationOptions,
	context?: Record<string, TranslationContextEntry>,
	previousTranslations?: Record<string, { source: string; translated: string }>,
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

	if (previousTranslations && Object.keys(previousTranslations).length > 0) {
		lines.push("\nPreviously translated (maintain consistency):");
		for (const [key, { source, translated }] of Object.entries(previousTranslations)) {
			lines.push(`  "${key}": "${source}" → "${translated}"`);
		}
	}

	lines.push("\nStrings to translate:");
	for (const [key, value] of Object.entries(entries)) {
		lines.push(`  "${key}": "${value}"`);
		if (context?.[key]) {
			const hint = buildContextHint(key, context[key]);
			if (hint) lines.push(hint);
		}
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

async function attemptTranslation(
	targetModel: LanguageModel,
	entries: Record<string, string>,
	prompt: string,
	schema: z.ZodObject<Record<string, z.ZodString>>,
	retries: number,
	shouldValidate: boolean,
): Promise<BatchResult> {
	let lastError: Error | undefined;
	const totalUsage = { inputTokens: 0, outputTokens: 0 };

	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const { object, usage } = await generateObject({
				model: targetModel,
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

async function translateBatchWithRetry(
	input: TranslateBatchInput,
	retries: number,
): Promise<BatchResult> {
	const { model, entries, sourceLocale, targetLocale, options, context, previousTranslations, fallbackModel } = input;
	const keys = Object.keys(entries);
	const prompt = buildPrompt(entries, sourceLocale, targetLocale, options, context, previousTranslations);
	const schema = buildSchema(keys);
	const shouldValidate = options?.validatePlaceholders !== false;

	try {
		return await attemptTranslation(model, entries, prompt, schema, retries, shouldValidate);
	} catch (primaryError) {
		if (fallbackModel) {
			logWarning("Primary model failed, falling back to secondary model...");
			return await attemptTranslation(fallbackModel, entries, prompt, schema, retries, shouldValidate);
		}
		throw primaryError;
	}
}

export interface TranslateAllInput {
	model: LanguageModel;
	entries: Record<string, string>;
	sourceLocale: string;
	targetLocale: string;
	options?: TranslationOptions;
	context?: Record<string, TranslationContextEntry>;
	fallbackModel?: LanguageModel;
	onBatchComplete?: (translated: Record<string, string>) => void;
	onProgress?: (completed: number, total: number) => void;
	onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export function chunkByTokens(
	entries: Record<string, string>,
	options: { targetTokens: number; maxEntriesPerBatch: number },
): Record<string, string>[] {
	const { targetTokens, maxEntriesPerBatch } = options;
	const batches: Record<string, string>[] = [];
	let current: Record<string, string> = {};
	let currentTokens = 0;
	let currentCount = 0;

	for (const [key, value] of Object.entries(entries)) {
		const entryTokens = estimateEntryTokens(key, value);

		if (currentCount > 0 && (currentTokens + entryTokens > targetTokens || currentCount >= maxEntriesPerBatch)) {
			batches.push(current);
			current = {};
			currentTokens = 0;
			currentCount = 0;
		}

		current[key] = value;
		currentTokens += entryTokens;
		currentCount++;
	}

	if (currentCount > 0) {
		batches.push(current);
	}

	return batches;
}

export function selectContextEntries(
	accumulated: Record<string, string>,
	currentBatchKeys: string[],
	sourceEntries: Record<string, string>,
	maxEntries = 15,
): Record<string, { source: string; translated: string }> {
	const result: Record<string, { source: string; translated: string }> = {};
	const accKeys = Object.keys(accumulated);
	if (accKeys.length === 0) return result;

	// Determine the namespaces of the current batch
	const batchNamespaces = new Set(
		currentBatchKeys.map((k) => k.split(".")[0]).filter(Boolean),
	);

	// Prioritize entries from the same namespace
	const sameNs: string[] = [];
	const otherNs: string[] = [];
	for (const key of accKeys) {
		const ns = key.split(".")[0];
		if (ns && batchNamespaces.has(ns)) {
			sameNs.push(key);
		} else {
			otherNs.push(key);
		}
	}

	const ordered = [...sameNs, ...otherNs];
	for (const key of ordered.slice(0, maxEntries)) {
		const source = sourceEntries[key];
		if (source) {
			result[key] = { source, translated: accumulated[key] };
		}
	}

	return result;
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
		context,
		fallbackModel,
		onBatchComplete,
		onProgress,
		onUsage,
	} = input;

	const keys = Object.keys(entries);
	if (keys.length === 0) return {};

	const concurrency = options?.concurrency ?? 3;
	const retries = options?.retries ?? 2;
	const targetTokens = options?.targetBatchTokens ?? 2000;
	const maxEntriesPerBatch = options?.batchSize ?? 50;

	const batches = chunkByTokens(entries, { targetTokens, maxEntriesPerBatch });

	// Wave-based execution: groups of `concurrency` batches
	const waves: Record<string, string>[][] = [];
	for (let i = 0; i < batches.length; i += concurrency) {
		waves.push(batches.slice(i, i + concurrency));
	}

	const results: Record<string, string> = {};
	const accumulated: Record<string, string> = {};
	let completedKeys = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;

	const limit = pLimit(concurrency);

	for (const wave of waves) {
		const previousTranslations = selectContextEntries(
			accumulated,
			wave.flatMap((b) => Object.keys(b)),
			entries,
		);

		await Promise.all(
			wave.map((batch) =>
				limit(async () => {
					const batchInput: TranslateBatchInput = {
						model,
						entries: batch,
						sourceLocale,
						targetLocale,
						options,
						context,
						previousTranslations: Object.keys(previousTranslations).length > 0 ? previousTranslations : undefined,
						fallbackModel,
					};

					const { translations, usage } = await translateBatchWithRetry(
						batchInput,
						retries,
					);
					Object.assign(results, translations);
					Object.assign(accumulated, translations);
					totalInputTokens += usage.inputTokens;
					totalOutputTokens += usage.outputTokens;
					completedKeys += Object.keys(batch).length;
					onProgress?.(completedKeys, keys.length);
					onBatchComplete?.(translations);
				}),
			),
		);
	}

	if (totalInputTokens > 0 || totalOutputTokens > 0) {
		onUsage?.({
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
		});
	}

	return results;
}
