import type { LanguageModel } from "ai";

export interface TranslationOptions {
	batchSize?: number;
	targetBatchTokens?: number;
	context?: string;
	glossary?: Record<string, string>;
	tone?: string;
	retries?: number;
	concurrency?: number;
	validatePlaceholders?: boolean;
	maxCostPerRun?: number;
	confirmAbove?: number;
}

export interface ScanOptions {
	include: string[];
	exclude?: string[];
	translatableProps?: string[];
	i18nImport?: string;
}

export interface InlineOptions {
	componentPath: string;
}

export interface TranslateKitConfig {
	model: LanguageModel;
	fallbackModel?: LanguageModel;
	mode: "keys" | "inline";
	sourceLocale: string;
	targetLocales: string[];
	messagesDir: string;
	splitByNamespace?: boolean;
	typeSafe?: boolean;
	translation?: TranslationOptions;
	scan?: ScanOptions;
	inline?: InlineOptions;
}

export interface DiffResult {
	added: Record<string, string>;
	modified: Record<string, string>;
	removed: string[];
	unchanged: Record<string, string>;
}

export interface LockFile {
	[key: string]: string;
}

export interface ExtractedString {
	text: string;
	type:
		| "jsx-text"
		| "jsx-attribute"
		| "jsx-expression"
		| "object-property"
		| "module-object-property"
		| "t-call"
		| "T-component";
	file: string;
	line: number;
	column: number;
	componentName?: string;
	propName?: string;
	parentTag?: string;
	id?: string;
	siblingTexts?: string[];
	routePath?: string;
	sectionHeading?: string;
	parentConstName?: string;
	compositeContext?: string;
}

export interface TranslationContextEntry {
	componentName?: string;
	parentTag?: string;
	routePath?: string;
	sectionHeading?: string;
	siblingTexts?: string[];
	compositeContext?: string;
	propName?: string;
	type: ExtractedString["type"];
}

export interface TranslationResult {
	locale: string;
	translated: number;
	cached: number;
	removed: number;
	errors: number;
	duration: number;
}
