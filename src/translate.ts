import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import type { TranslationOptions } from "./types.js";

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

async function translateBatchWithRetry(
  input: TranslateBatchInput,
  retries: number,
): Promise<Record<string, string>> {
  const { model, entries, sourceLocale, targetLocale, options } = input;
  const keys = Object.keys(entries);
  const prompt = buildPrompt(entries, sourceLocale, targetLocale, options);
  const schema = buildSchema(keys);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { object } = await generateObject({
        model,
        prompt,
        schema,
      });
      return object;
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
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
}

export async function translateAll(
  input: TranslateAllInput,
): Promise<Record<string, string>> {
  const { model, entries, sourceLocale, targetLocale, options, onBatchComplete } =
    input;

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

  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const translated = await translateBatchWithRetry(
          { model, entries: batch, sourceLocale, targetLocale, options },
          retries,
        );
        Object.assign(results, translated);
        onBatchComplete?.(translated);
      }),
    ),
  );

  return results;
}
