import { generateObject, type LanguageModel } from "ai";
import pLimit from "p-limit";
import { z } from "zod";
import { logWarning } from "../logger.js";
import type { ExtractedString } from "../types.js";

interface KeyGenInput {
	model: LanguageModel;
	fallbackModel?: LanguageModel;
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

function buildPrompt(
	strings: ExtractedString[],
	existingMap?: Record<string, string>,
): string {
	const lines = [
		"Generate semantic i18n keys for these UI strings.",
		"",
		"Rules:",
		"- Use dot notation with max 2 levels (namespace.key)",
		"- Use camelCase for key segments",
		"- CRITICAL: All strings within the same React component MUST share the same namespace prefix.",
		'  This is because the generated code will use useTranslations("namespace") / getTranslations("namespace")',
		"  from next-intl, which scopes all t() calls to that namespace.",
		'  Example: A Hero component with "Welcome" and "Get Started" → both must be "hero.welcome" and "hero.getStarted", NOT "hero.welcome" and "common.getStarted".',
		"- Derive namespace from: route path > component name > file path section, in that priority order.",
		'  Example: file src/app/dashboard/page.tsx, component DashboardPage → namespace "dashboard"',
		'  Example: file src/components/hero/Hero.tsx, component Hero → namespace "hero"',
		"- Only use cross-cutting namespaces (common, auth, nav, form, error) for strings that are truly generic",
		'  and appear in multiple unrelated components. If "Save" only appears in SettingsForm, use "settings.save" not "common.save".',
		"- For shared/layout components (Header, Footer, Sidebar), use their component name as namespace.",
		'- Auth-related use "auth." prefix (Sign in, Log out, Register, Forgot password, etc.)',
		'- Navigation use "nav." prefix',
		'- Form-related use "form." prefix for generic form labels',
		'- Error messages use "error." prefix',
		"- Be consistent: same text should always get the same key",
		"- Keys should be concise but descriptive",
	];

	// Add existing keys context for namespace consistency
	if (existingMap && Object.keys(existingMap).length > 0) {
		const entries = Object.entries(existingMap).slice(0, 30);
		lines.push("");
		lines.push("Existing keys (maintain consistency with these namespaces):");
		for (const [text, key] of entries) {
			lines.push(`  "${text}" → ${key}`);
		}
	}

	// Group strings by file for better context
	lines.push("");
	lines.push("Strings:");

	const byFile = new Map<string, { index: number; str: ExtractedString }[]>();
	for (let i = 0; i < strings.length; i++) {
		const str = strings[i];
		const file = str.file || "(unknown)";
		if (!byFile.has(file)) byFile.set(file, []);
		byFile.get(file)!.push({ index: i, str });
	}

	for (const [file, entries] of byFile) {
		const routePart = entries[0].str.routePath
			? ` (route: ${entries[0].str.routePath})`
			: "";
		lines.push(`--- File: ${file}${routePart} ---`);

		for (const { index, str } of entries) {
			const parts: string[] = [`[${index}] "${str.text}"`];
			if (str.componentName) parts.push(`component: ${str.componentName}`);
			if (str.parentTag) parts.push(`tag: ${str.parentTag}`);
			if (str.propName) parts.push(`prop: ${str.propName}`);
			if (str.parentConstName) parts.push(`const: ${str.parentConstName}`);
			if (str.sectionHeading) parts.push(`section: "${str.sectionHeading}"`);
			if (str.siblingTexts?.length) {
				parts.push(
					`siblings: [${str.siblingTexts
						.slice(0, 3)
						.map((t) => `"${t}"`)
						.join(", ")}]`,
				);
			}
			if (str.compositeContext) parts.push(`composite: "${str.compositeContext}"`);
			lines.push(`  ${parts.join(", ")}`);
		}
	}

	return lines.join("\n");
}

interface KeyBatchResult {
	keys: Record<string, string>;
	usage: { inputTokens: number; outputTokens: number };
}

function inferNamespace(str: ExtractedString): string {
	// 1. Component name: "FeaturesGrid" → "featuresGrid", "Newsletter" → "newsletter"
	if (str.componentName && str.componentName.length > 0) {
		return str.componentName[0].toLowerCase() + str.componentName.slice(1);
	}

	// 2. Route path: "/dashboard/settings" → "settings"
	// Skip dynamic segments like [id], [...slug]
	if (str.routePath) {
		const segments = str.routePath
			.split("/")
			.filter((s) => s.length > 0 && !s.startsWith("["));
		if (segments.length > 0) {
			return segments[segments.length - 1].toLowerCase();
		}
	}

	// 3. File path: "src/components/sections/hero.tsx" → "hero"
	// For generic names (index, page, layout), use parent directory
	if (str.file) {
		const parts = str.file.replace(/\.\w+$/, "").split("/");
		const fileName = parts[parts.length - 1];
		if (
			fileName &&
			fileName !== "index" &&
			fileName !== "page" &&
			fileName !== "layout"
		) {
			return fileName[0].toLowerCase() + fileName.slice(1);
		}
		// Use parent directory for generic filenames
		if (parts.length >= 2) {
			const dir = parts[parts.length - 2];
			if (dir && !dir.startsWith("[") && !dir.startsWith("(")) {
				return dir[0].toLowerCase() + dir.slice(1);
			}
		}
	}

	return "common";
}

async function attemptKeyGeneration(
	targetModel: LanguageModel,
	strings: ExtractedString[],
	retries: number,
	existingMap?: Record<string, string>,
): Promise<KeyBatchResult> {
	const prompt = buildPrompt(strings, existingMap);
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

			const result: Record<string, string> = {};
			for (const mapping of object.mappings) {
				if (mapping.index >= 0 && mapping.index < texts.length) {
					let key = mapping.key;
					if (!key.includes(".")) {
						// Infer namespace from component name or file path
						const str = strings[mapping.index];
						const ns = inferNamespace(str);
						key = `${ns}.${key}`;
						logWarning(
							`AI generated single-segment key "${mapping.key}" for "${texts[mapping.index]}". Auto-prefixed to "${key}".`,
						);
					}
					result[texts[mapping.index]] = key;
				}
			}
			return { keys: result, usage: totalUsage };
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

async function generateKeysBatchWithRetry(
	model: LanguageModel,
	strings: ExtractedString[],
	retries: number,
	existingMap?: Record<string, string>,
	fallbackModel?: LanguageModel,
): Promise<KeyBatchResult> {
	try {
		return await attemptKeyGeneration(model, strings, retries, existingMap);
	} catch (primaryError) {
		if (fallbackModel) {
			logWarning("Primary model failed for key generation, falling back to secondary model...");
			return await attemptKeyGeneration(fallbackModel, strings, retries, existingMap);
		}
		throw primaryError;
	}
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

/**
 * Detects and resolves path conflicts where a key is both a leaf (string value)
 * and a prefix of other keys (branch node). When unflattened, the leaf value
 * would be overwritten by the branch object.
 *
 * Example: "integrations.integration" (leaf) + "integrations.integration.name" (child)
 * → renames leaf to "integrations.integrationLabel"
 */
function resolvePathConflicts(
	map: Record<string, string>,
): Record<string, string> {
	const allKeys = new Set(Object.values(map));
	const result: Record<string, string> = {};

	for (const [text, key] of Object.entries(map)) {
		let hasChild = false;
		const prefix = `${key}.`;
		for (const other of allKeys) {
			if (other.startsWith(prefix)) {
				hasChild = true;
				break;
			}
		}

		if (!hasChild) {
			result[text] = key;
			continue;
		}

		// Key is both leaf and branch — rename by appending "Label" to last segment
		const dotIdx = key.lastIndexOf(".");
		let renamed: string;
		if (dotIdx === -1) {
			renamed = `${key}Label`;
		} else {
			renamed = `${key.slice(0, dotIdx + 1) + key.slice(dotIdx + 1)}Label`;
		}

		// Ensure the renamed key doesn't collide
		let finalKey = renamed;
		let suffix = 2;
		while (allKeys.has(finalKey)) {
			finalKey = `${renamed}${suffix}`;
			suffix++;
		}

		allKeys.delete(key);
		allKeys.add(finalKey);
		result[text] = finalKey;
		logWarning(
			`Key path conflict: "${key}" is both a value and a prefix of other keys. Renamed to "${finalKey}".`,
		);
	}

	return result;
}

export async function generateSemanticKeys(
	input: KeyGenInput,
): Promise<Record<string, string>> {
	const {
		model,
		fallbackModel,
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
	const uniqueStrings = Array.from(uniqueMap.values()).sort((a, b) => {
		const fileCmp = (a.file || "").localeCompare(b.file || "");
		if (fileCmp !== 0) return fileCmp;
		return (a.componentName || "").localeCompare(b.componentName || "");
	});

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
				const { keys, usage } = await generateKeysBatchWithRetry(
					model,
					batch,
					retries,
					activeExisting,
					fallbackModel,
				);
				Object.assign(allNewKeys, keys);
				totalInputTokens += usage.inputTokens;
				totalOutputTokens += usage.outputTokens;
				completedStrings += batch.length;
				onProgress?.(completedStrings, uniqueStrings.length);
			}),
		),
	);

	if (totalInputTokens > 0 || totalOutputTokens > 0) {
		onUsage?.({
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
		});
	}

	const resolved = resolveCollisions(allNewKeys, activeExisting);
	const merged = { ...activeExisting, ...resolved };

	return resolvePathConflicts(merged);
}
