import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import type { ExtractedString } from "../types.js";

interface KeyGenInput {
  model: LanguageModel;
  strings: ExtractedString[];
  existingMap?: Record<string, string>;
  batchSize?: number;
  concurrency?: number;
  retries?: number;
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

  for (const str of strings) {
    const parts: string[] = [`"${str.text}"`];
    if (str.componentName) parts.push(`component: ${str.componentName}`);
    if (str.parentTag) parts.push(`tag: ${str.parentTag}`);
    if (str.propName) parts.push(`prop: ${str.propName}`);
    if (str.file) parts.push(`file: ${str.file}`);
    lines.push(`  ${parts.join(", ")}`);
  }

  return lines.join("\n");
}

async function generateKeysBatchWithRetry(
  model: LanguageModel,
  strings: ExtractedString[],
  retries: number,
): Promise<Record<string, string>> {
  const prompt = buildPrompt(strings);
  const texts = strings.map((s) => s.text);

  const shape: Record<string, z.ZodString> = {};
  for (const text of texts) {
    shape[text] = z.string().describe(`Semantic key for "${text}"`);
  }
  const schema = z.object(shape);

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
    batchSize = 50,
    concurrency = 3,
    retries = 2,
  } = input;

  const newStrings = strings.filter((s) => !(s.text in existingMap));
  if (newStrings.length === 0) return { ...existingMap };

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

  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const keys = await generateKeysBatchWithRetry(model, batch, retries);
        Object.assign(allNewKeys, keys);
      }),
    ),
  );

  const resolved = resolveCollisions(allNewKeys, existingMap);

  return { ...existingMap, ...resolved };
}
