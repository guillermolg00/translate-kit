import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import type { ExtractedString } from "../types.js";

interface KeyGenInput {
  model: LanguageModel;
  strings: ExtractedString[];
  existingMap?: Record<string, string>;
  /** All texts found in the codebase (including wrapped). Used to determine which existingMap entries are still active. When omitted, defaults to texts from `strings`. */
  allTexts?: Set<string>;
  batchSize?: number;
  concurrency?: number;
  retries?: number;
  onProgress?: (completed: number, total: number) => void;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

function buildPrompt(strings: ExtractedString[]): string {
  const lines = [
    "Generate semantic i18n keys for these UI strings.",
    "",
    "Rules:",
    "- Use dot notation with max 2 levels (namespace.key)",
    "- Group by feature/section based on file path and component",
    "- Use camelCase for key segments",
    '- Common UI strings use "common." prefix (Save, Cancel, Loading, Submit, Close, Delete, Edit, Back, Next, etc.)',
    '- Auth-related use "auth." prefix (Sign in, Log out, Register, Forgot password, etc.)',
    '- Navigation use "nav." prefix',
    '- Form-related use "form." prefix for generic form labels',
    '- Error messages use "error." prefix',
    "- Be consistent: same text should always get the same key",
    "- Keys should be concise but descriptive",
    "",
    "Strings:",
  ];

  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    const parts: string[] = [`[${i}] "${str.text}"`];
    if (str.componentName) parts.push(`component: ${str.componentName}`);
    if (str.parentTag) parts.push(`tag: ${str.parentTag}`);
    if (str.propName) parts.push(`prop: ${str.propName}`);
    if (str.file) parts.push(`file: ${str.file}`);
    if (str.routePath) parts.push(`route: ${str.routePath}`);
    if (str.sectionHeading) parts.push(`section: "${str.sectionHeading}"`);
    if (str.siblingTexts?.length) {
      parts.push(`siblings: [${str.siblingTexts.slice(0, 3).map((t) => `"${t}"`).join(", ")}]`);
    }
    lines.push(`  ${parts.join(", ")}`);
  }

  return lines.join("\n");
}

interface KeyBatchResult {
  keys: Record<string, string>;
  usage: { inputTokens: number; outputTokens: number };
}

async function generateKeysBatchWithRetry(
  model: LanguageModel,
  strings: ExtractedString[],
  retries: number,
): Promise<KeyBatchResult> {
  const prompt = buildPrompt(strings);
  const texts = strings.map((s) => s.text);

  const schema = z.object({
    mappings: z.array(
      z.object({
        index: z.number().describe("Zero-based index of the string"),
        key: z.string().describe("Semantic i18n key"),
      }),
    ),
  });

  let lastError: Error | undefined;
  let totalUsage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { object, usage } = await generateObject({
        model,
        prompt,
        schema,
      });

      totalUsage.inputTokens += usage.inputTokens ?? 0;
      totalUsage.outputTokens += usage.outputTokens ?? 0;

      const result: Record<string, string> = {};
      for (const mapping of object.mappings) {
        if (mapping.index >= 0 && mapping.index < texts.length) {
          result[texts[mapping.index]] = mapping.key;
        }
      }
      return { keys: result, usage: totalUsage };
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        const delay = Math.min(Math.pow(2, attempt) * 1000, 30_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

function resolveCollisions(
  newKeys: Record<string, string>,
  existingMap: Record<string, string>,
): Record<string, string> {
  const usedKeys = new Set(Object.values(existingMap));
  const result: Record<string, string> = {};

  for (const [text, key] of Object.entries(newKeys)) {
    let finalKey = key;
    let suffix = 2;
    while (usedKeys.has(finalKey)) {
      finalKey = `${key}${suffix}`;
      suffix++;
    }
    usedKeys.add(finalKey);
    result[text] = finalKey;
  }

  return result;
}

export async function generateSemanticKeys(
  input: KeyGenInput,
): Promise<Record<string, string>> {
  const {
    model,
    strings,
    existingMap = {},
    allTexts,
    batchSize = 50,
    concurrency = 3,
    retries = 2,
    onProgress,
    onUsage,
  } = input;

  const activeTexts = allTexts ?? new Set(strings.map((s) => s.text));
  const activeExisting: Record<string, string> = {};
  for (const [text, key] of Object.entries(existingMap)) {
    if (activeTexts.has(text)) {
      activeExisting[text] = key;
    }
  }

  const newStrings = strings.filter((s) => !(s.text in activeExisting));
  if (newStrings.length === 0) return activeExisting;

  const uniqueMap = new Map<string, ExtractedString>();
  for (const str of newStrings) {
    if (!uniqueMap.has(str.text)) {
      uniqueMap.set(str.text, str);
    }
  }
  const uniqueStrings = Array.from(uniqueMap.values());

  const limit = pLimit(concurrency);
  const batches: ExtractedString[][] = [];

  for (let i = 0; i < uniqueStrings.length; i += batchSize) {
    batches.push(uniqueStrings.slice(i, i + batchSize));
  }

  const allNewKeys: Record<string, string> = {};
  let completedStrings = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const { keys, usage } = await generateKeysBatchWithRetry(model, batch, retries);
        Object.assign(allNewKeys, keys);
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        completedStrings += batch.length;
        onProgress?.(completedStrings, uniqueStrings.length);
      }),
    ),
  );

  if (totalInputTokens > 0 || totalOutputTokens > 0) {
    onUsage?.({ inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
  }

  const resolved = resolveCollisions(allNewKeys, activeExisting);

  return { ...activeExisting, ...resolved };
}
