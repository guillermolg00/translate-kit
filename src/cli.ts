import "dotenv/config";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { defineCommand, runMain } from "citty";
import { parseTranslateFlags, validateLocale } from "./cli-utils.js";
import { loadTranslateKitConfig } from "./config.js";
import type { CostEstimate } from "./cost.js";
import {
	logDryRun,
	logError,
	logInfo,
	logLocaleResult,
	logLocaleStart,
	logProgress,
	logProgressClear,
	logScanResult,
	logStart,
	logSuccess,
	logSummary,
	logUsage,
	logWarning,
} from "./logger.js";
import {
	loadMapFile,
	loadSourceFlat,
	runCodegenStep,
	runScanStep,
	runTranslateStep,
} from "./pipeline.js";
import { scan } from "./scanner/index.js";
import { generateNextIntlTypes } from "./typegen.js";
import type { TranslateKitConfig, TranslationResult } from "./types.js";
import {
	createUsageTracker,
	estimateCost,
	formatCost,
	formatUsage,
} from "./usage.js";

function requireScanConfig(
	config: TranslateKitConfig,
): asserts config is TranslateKitConfig & {
	scan: NonNullable<TranslateKitConfig["scan"]>;
} {
	if (!config.scan) {
		logError(
			"No scan configuration found. Add a 'scan' section to your config.",
		);
		process.exit(1);
	}
}

function requireNonEmptySource(
	sourceFlat: Record<string, string>,
	mode: string,
	messagesDir: string,
	sourceLocale: string,
): void {
	if (Object.keys(sourceFlat).length === 0) {
		logError(
			mode === "inline"
				? "No keys found in .translate-map.json. Run 'translate-kit scan' first."
				: `No keys found in ${join(messagesDir, `${sourceLocale}.json`)}`,
		);
		process.exit(1);
	}
}

function buildCostConfirmCallback(
	config: TranslateKitConfig,
): ((estimate: CostEstimate) => Promise<boolean>) | undefined {
	const confirmAbove = config.translation?.confirmAbove;
	if (confirmAbove == null) return undefined;

	return async (estimate: CostEstimate) => {
		if (estimate.estimatedCostUSD == null) return true;
		if (estimate.estimatedCostUSD <= confirmAbove) return true;

		logInfo(
			`Estimated cost: ~$${estimate.estimatedCostUSD.toFixed(4)} (${estimate.totalTokens.toLocaleString()} tokens)`,
		);

		const confirmed = await p.confirm({
			message: `Estimated cost $${estimate.estimatedCostUSD.toFixed(4)} exceeds $${confirmAbove.toFixed(2)} threshold. Continue?`,
		});

		return confirmed === true;
	};
}

const translateCommand = defineCommand({
	meta: {
		name: "translate",
		description: "Translate messages to target locales",
	},
	args: {
		"dry-run": {
			type: "boolean",
			description: "Show what would be translated without executing",
			default: false,
		},
		force: {
			type: "boolean",
			description: "Ignore cache, re-translate everything",
			default: false,
		},
		locale: {
			type: "string",
			description: "Only translate a specific locale",
		},
		verbose: {
			type: "boolean",
			description: "Verbose output",
			default: false,
		},
	},
	async run({ args }) {
		const config = await loadTranslateKitConfig();
		const { sourceLocale, targetLocales, messagesDir, model } = config;
		const mode = config.mode;

		if (args.locale && !validateLocale(args.locale)) {
			logError(
				`Invalid locale "${args.locale}". Locale must only contain letters, numbers, hyphens, and underscores.`,
			);
			process.exit(1);
		}

		const locales = args.locale ? [args.locale] : targetLocales;

		if (args.locale && !targetLocales.includes(args.locale)) {
			logWarning(
				`Locale "${args.locale}" is not in targetLocales [${targetLocales.join(", ")}]`,
			);
		}

		// Dry-run: show diff counts per locale without translating
		if (args["dry-run"]) {
			const sourceFlat = await loadSourceFlat(config);

			requireNonEmptySource(sourceFlat, mode, messagesDir, sourceLocale);

			const dryResult = await runTranslateStep({
				config,
				sourceFlat,
				locales,
				force: args.force,
				dryRun: true,
			});

			logStart(sourceLocale, locales);
			for (const r of dryResult.localeResults) {
				logDryRun(r.locale, 0, 0, r.removed, r.cached);
			}
			return;
		}

		// Normal translation
		const sourceFlat = await loadSourceFlat(config);

		requireNonEmptySource(sourceFlat, mode, messagesDir, sourceLocale);

		logStart(sourceLocale, locales);

		const usageTracker = createUsageTracker();
		const results: TranslationResult[] = [];

		const translateResult = await runTranslateStep({
			config,
			sourceFlat,
			locales,
			force: args.force,
			onConfirmCost: buildCostConfirmCallback(config),
			callbacks: {
				onLocaleProgress: (locale, c, t) =>
					logProgress(c, t, `Translating ${locale}...`),
				onUsage: (usage) => usageTracker.add(usage),
			},
		});

		for (const r of translateResult.localeResults) {
			logLocaleStart(r.locale);
			logProgressClear();
			logLocaleResult(r);
			results.push(r);
		}

		logSummary(results);
		const usage = usageTracker.get();
		if (usage.totalTokens > 0) {
			const cost = await estimateCost(model, usage);
			logUsage(
				formatUsage(usage),
				cost ? formatCost(cost.totalUSD) : undefined,
			);
		}
	},
});

const scanCommand = defineCommand({
	meta: {
		name: "scan",
		description: "Scan source code for translatable strings",
	},
	args: {
		"dry-run": {
			type: "boolean",
			description: "Show found strings without writing files",
			default: false,
		},
	},
	async run({ args }) {
		const config = await loadTranslateKitConfig();
		const mode = config.mode;
		requireScanConfig(config);

		// Dry-run: show found strings without writing anything
		if (args["dry-run"]) {
			const result = await scan(config.scan, process.cwd(), {
				onProgress: (c, t) => logProgress(c, t, "Scanning..."),
			});
			logProgressClear();

			const bareStrings = result.strings.filter((s) => {
				if (s.type === "t-call") return false;
				if (s.type === "T-component" && s.id) return false;
				return true;
			});

			logScanResult(bareStrings.length, result.fileCount);

			for (const str of bareStrings) {
				logInfo(
					`"${str.text}" (${str.componentName ?? "unknown"}, ${str.file})`,
				);
			}
			if (mode === "inline") {
				logInfo(
					"\n  Inline mode: no source locale JSON will be created. Source text remains in code.",
				);
			}
			return;
		}

		// Normal scan
		const scanUsageTracker = createUsageTracker();
		const scanResult = await runScanStep({
			config,
			cwd: process.cwd(),
			callbacks: {
				onScanProgress: (c, t) => logProgress(c, t, "Scanning..."),
				onKeygenProgress: (c, t) => logProgress(c, t, "Generating keys..."),
				onUsage: (usage) => scanUsageTracker.add(usage),
			},
		});
		logProgressClear();

		logScanResult(scanResult.bareStringCount, scanResult.fileCount);
		logSuccess(
			`Written .translate-map.json (${Object.keys(scanResult.textToKey).length} keys)`,
		);

		if (mode === "inline" && config.splitByNamespace) {
			logInfo(
				"Inline mode + split: source text stays in code, translations split by namespace.",
			);
		} else if (mode === "inline") {
			logInfo(
				"Inline mode: source text stays in code, no source locale JSON created.",
			);
		} else if (config.splitByNamespace) {
			logSuccess(
				`Written to ${join(config.messagesDir, config.sourceLocale)}/`,
			);
		} else {
			const sourceFile = join(
				config.messagesDir,
				`${config.sourceLocale}.json`,
			);
			logSuccess(`Written to ${sourceFile}`);
		}

		const scanUsage = scanUsageTracker.get();
		if (scanUsage.totalTokens > 0) {
			const cost = await estimateCost(config.model, scanUsage);
			logUsage(
				formatUsage(scanUsage),
				cost ? formatCost(cost.totalUSD) : undefined,
			);
		}
	},
});

const codegenCommand = defineCommand({
	meta: {
		name: "codegen",
		description: "Replace strings in source code with t() calls",
	},
	args: {
		"dry-run": {
			type: "boolean",
			description: "Show what would be changed without modifying files",
			default: false,
		},
		"module-factory": {
			type: "boolean",
			description:
				"Convert module-level constants with translatable strings into factory functions",
			default: false,
		},
	},
	async run({ args }) {
		const config = await loadTranslateKitConfig();
		const mode = config.mode;
		requireScanConfig(config);

		// Dry-run: show what would be changed
		if (args["dry-run"]) {
			const textToKey = await loadMapFile(config.messagesDir);

			if (Object.keys(textToKey).length === 0) {
				logError(
					"No .translate-map.json found. Run 'translate-kit scan' first.",
				);
				process.exit(1);
			}

			if (mode === "inline") {
				logInfo(
					`\n  Would wrap ${Object.keys(textToKey).length} strings with <T> components\n`,
				);
				for (const [text, key] of Object.entries(textToKey)) {
					logInfo(`"${text}" → <T id="${key}">${text}</T>`);
				}
			} else {
				logInfo(
					`\n  Would replace ${Object.keys(textToKey).length} strings with t() calls\n`,
				);
				for (const [text, key] of Object.entries(textToKey)) {
					logInfo(`"${text}" → t("${key}")`);
				}
			}
			return;
		}

		// Normal codegen
		const result = await runCodegenStep({
			config,
			cwd: process.cwd(),
			moduleFactory: args["module-factory"],
			callbacks: {
				onProgress: (c, t) => logProgress(c, t, "Processing files..."),
			},
		});
		logProgressClear();

		logSuccess(
			`Codegen complete: ${result.stringsWrapped} strings wrapped in ${result.filesModified} files (${result.filesProcessed} files processed)`,
		);
		if (result.filesSkipped > 0) {
			logWarning(
				`${result.filesSkipped} file(s) skipped due to invalid generated syntax`,
			);
		}
	},
});

const typegenCommand = defineCommand({
	meta: {
		name: "typegen",
		description: "Generate TypeScript types for message keys (next-intl.d.ts)",
	},
	async run() {
		const config = await loadTranslateKitConfig();
		if (config.mode === "inline") {
			logWarning("Type generation is only available in keys mode.");
			return;
		}
		await generateNextIntlTypes(
			config.messagesDir,
			config.sourceLocale,
			config.splitByNamespace,
		);
		logSuccess(`Generated ${join(config.messagesDir, "next-intl.d.ts")}`);
	},
});

const runCommand = defineCommand({
	meta: {
		name: "run",
		description: "Run the full pipeline: scan → codegen → translate",
	},
	args: {
		"dry-run": {
			type: "boolean",
			default: false,
			description: "Preview without writing",
		},
		force: {
			type: "boolean",
			default: false,
			description: "Ignore translation cache",
		},
		"module-factory": {
			type: "boolean",
			description:
				"Convert module-level constants with translatable strings into factory functions",
			default: false,
		},
		verbose: {
			type: "boolean",
			default: false,
			description: "Verbose output",
		},
	},
	async run({ args }) {
		const config = await loadTranslateKitConfig();
		requireScanConfig(config);

		// --- DRY-RUN ---
		if (args["dry-run"]) {
			const scanResult = await runScanStep({
				config,
				cwd: process.cwd(),
				callbacks: {
					onScanProgress: (c, t) => logProgress(c, t, "Scanning..."),
					onKeygenProgress: (c, t) => logProgress(c, t, "Generating keys..."),
				},
			});
			logProgressClear();
			logScanResult(scanResult.bareStringCount, scanResult.fileCount);

			const mode = config.mode;
			if (mode === "inline") {
				logInfo(
					`\n  Would wrap ${Object.keys(scanResult.textToKey).length} strings with <T> components\n`,
				);
			} else {
				logInfo(
					`\n  Would replace ${Object.keys(scanResult.textToKey).length} strings with t() calls\n`,
				);
			}

			const dryResult = await runTranslateStep({
				config,
				sourceFlat: scanResult.sourceFlat,
				locales: config.targetLocales,
				force: args.force,
				dryRun: true,
			});
			logStart(config.sourceLocale, config.targetLocales);
			for (const r of dryResult.localeResults) {
				logDryRun(r.locale, 0, 0, r.removed, r.cached);
			}
			return;
		}

		const usageTracker = createUsageTracker();

		// --- SCAN ---
		logInfo("Scanning...");
		const scanResult = await runScanStep({
			config,
			cwd: process.cwd(),
			callbacks: {
				onScanProgress: (c, t) => logProgress(c, t, "Scanning..."),
				onKeygenProgress: (c, t) => logProgress(c, t, "Generating keys..."),
				onUsage: (usage) => usageTracker.add(usage),
			},
		});
		logProgressClear();
		logSuccess(
			`Scan: ${scanResult.bareStringCount} strings from ${scanResult.fileCount} files`,
		);

		if (
			scanResult.bareStringCount === 0 &&
			Object.keys(scanResult.textToKey).length === 0
		) {
			logWarning("No translatable strings found.");
			return;
		}

		// --- CODEGEN ---
		const codegenResult = await runCodegenStep({
			config,
			cwd: process.cwd(),
			textToKey: scanResult.textToKey,
			moduleFactory: args["module-factory"],
			callbacks: {
				onProgress: (c, t) => logProgress(c, t, "Codegen..."),
			},
		});
		logProgressClear();
		logSuccess(
			`Codegen: ${codegenResult.stringsWrapped} strings wrapped in ${codegenResult.filesModified} files`,
		);

		// --- TRANSLATE ---
		const locales = config.targetLocales;
		logStart(config.sourceLocale, locales);

		const translateResult = await runTranslateStep({
			config,
			sourceFlat: scanResult.sourceFlat,
			locales,
			force: args.force,
			onConfirmCost: buildCostConfirmCallback(config),
			callbacks: {
				onLocaleProgress: (locale, c, t) =>
					logProgress(c, t, `Translating ${locale}...`),
				onUsage: (usage) => usageTracker.add(usage),
			},
		});

		for (const r of translateResult.localeResults) {
			logLocaleStart(r.locale);
			logProgressClear();
			logLocaleResult(r);
		}
		logSummary(translateResult.localeResults);

		const usage = usageTracker.get();
		if (usage.totalTokens > 0) {
			const cost = await estimateCost(config.model, usage);
			logUsage(
				formatUsage(usage),
				cost ? formatCost(cost.totalUSD) : undefined,
			);
		}
	},
});

const initCommand = defineCommand({
	meta: {
		name: "init",
		description: "Interactive setup wizard for translate-kit",
	},
	async run() {
		const { runInitWizard } = await import("./init.js");
		await runInitWizard();
	},
});

const rulesCommand = defineCommand({
	meta: {
		name: "rules",
		description: "Generate AI agent rules for translate-kit workflow",
	},
	async run() {
		const { runRulesCommand } = await import("./rules.js");
		await runRulesCommand();
	},
});

const main = defineCommand({
	meta: {
		name: "translate-kit",
		version: "0.1.0",
		description: "AI-powered translation SDK for build time",
	},
	subCommands: {
		translate: translateCommand,
		scan: scanCommand,
		codegen: codegenCommand,
		run: runCommand,
		typegen: typegenCommand,
		init: initCommand,
		rules: rulesCommand,
	},
	async run({ rawArgs }) {
		if (rawArgs.length === 0) {
			console.log(`
  translate-kit — AI-powered translation SDK for build time

  Usage:
    translate-kit <command> [flags]

  Commands:
    init        Interactive setup wizard
    run         Full pipeline: scan → codegen → translate
    scan        Scan source code for translatable strings
    codegen     Replace strings with t() calls
    translate   Translate messages to target locales
    typegen     Generate TypeScript types for message keys
    rules       Generate AI agent rules for your IDE/editor

  Flags:
    --dry-run          Preview without writing files
    --force            Ignore translation cache
    --locale           Only translate a specific locale
    --module-factory   Convert module-level constants into factory functions
    --verbose          Verbose output

  Examples:
    translate-kit init              # Set up a new project
    translate-kit run               # Full pipeline
    translate-kit translate         # Translate only (incremental)
    translate-kit translate --force # Re-translate everything
`);
			return;
		}

		if (rawArgs[0]?.startsWith("-")) {
			const { dryRun, force, verbose, locale } = parseTranslateFlags(rawArgs);

			await translateCommand.run!({
				args: {
					_: rawArgs,
					"dry-run": dryRun,
					force,
					verbose,
					locale: locale ?? "",
				},
				rawArgs,
				cmd: translateCommand,
			});
		}
	},
});

runMain(main);
