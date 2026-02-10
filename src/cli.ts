import "dotenv/config";
import { defineCommand, runMain } from "citty";
import { join } from "node:path";
import { loadTranslateKitConfig } from "./config.js";
import { flatten, unflatten } from "./flatten.js";
import { loadJsonFile, loadLockFile, computeDiff } from "./diff.js";
import { translateAll } from "./translate.js";
import { writeTranslation, writeLockFile } from "./writer.js";
import { scan } from "./scanner/index.js";
import { generateSemanticKeys } from "./scanner/key-ai.js";
import { codegen } from "./codegen/index.js";
import {
  logStart,
  logLocaleStart,
  logLocaleResult,
  logSummary,
  logDryRun,
  logScanResult,
  logError,
  logInfo,
  logSuccess,
  logVerbose,
  logWarning,
  logUsage,
  logProgress,
  logProgressClear,
} from "./logger.js";
import { createUsageTracker, estimateCost, formatUsage, formatCost } from "./usage.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { TranslationResult } from "./types.js";
import { parseTranslateFlags, validateLocale } from "./cli-utils.js";

async function loadMapFile(
  messagesDir: string,
): Promise<Record<string, string>> {
  const mapPath = join(messagesDir, ".translate-map.json");
  let content: string;
  try {
    content = await readFile(mapPath, "utf-8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(content);
  } catch {
    logWarning(
      `.translate-map.json is corrupted (invalid JSON). Starting fresh.`,
    );
    return {};
  }
}

async function writeMapFile(
  messagesDir: string,
  map: Record<string, string>,
): Promise<void> {
  const mapPath = join(messagesDir, ".translate-map.json");
  await mkdir(messagesDir, { recursive: true });
  const content = JSON.stringify(map, null, 2) + "\n";
  await writeFile(mapPath, content, "utf-8");
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
    const opts = config.translation ?? {};
    const verbose = args.verbose;
    const mode = config.mode ?? "keys";

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

    let sourceFlat: Record<string, string>;

    if (mode === "inline") {
      const mapData = await loadMapFile(messagesDir);
      sourceFlat = {};
      for (const [text, key] of Object.entries(mapData)) {
        sourceFlat[key] = text;
      }
    } else {
      const sourceFile = join(messagesDir, `${sourceLocale}.json`);
      const sourceRaw = await loadJsonFile(sourceFile);
      sourceFlat = flatten(sourceRaw);
    }

    if (Object.keys(sourceFlat).length === 0) {
      logError(
        mode === "inline"
          ? `No keys found in .translate-map.json. Run 'translate-kit scan' first.`
          : `No keys found in ${join(messagesDir, `${sourceLocale}.json`)}`,
      );
      process.exit(1);
    }

    logStart(sourceLocale, locales);

    const results: TranslationResult[] = [];
    const usageTracker = createUsageTracker();

    for (const locale of locales) {
      const start = Date.now();
      const targetFile = join(messagesDir, `${locale}.json`);

      logLocaleStart(locale);

      const targetRaw = await loadJsonFile(targetFile);
      const targetFlat = flatten(targetRaw);

      let lockData = await loadLockFile(messagesDir);

      if (args.force) {
        lockData = {};
      }

      const diffResult = computeDiff(sourceFlat, targetFlat, lockData);
      const toTranslate = { ...diffResult.added, ...diffResult.modified };

      if (args["dry-run"]) {
        logDryRun(
          locale,
          Object.keys(diffResult.added).length,
          Object.keys(diffResult.modified).length,
          diffResult.removed.length,
          Object.keys(diffResult.unchanged).length,
        );
        continue;
      }

      let translated: Record<string, string> = {};
      let errors = 0;
      let translationFailed = false;

      if (Object.keys(toTranslate).length > 0) {
        try {
          translated = await translateAll({
            model,
            entries: toTranslate,
            sourceLocale,
            targetLocale: locale,
            options: opts,
            onBatchComplete: (batch) => {
              logVerbose(
                `Batch complete: ${Object.keys(batch).length} keys`,
                verbose,
              );
            },
            onProgress: (c, t) => logProgress(c, t, `Translating ${locale}...`),
            onUsage: (usage) => usageTracker.add(usage),
          });
          logProgressClear();
        } catch (err) {
          logProgressClear();
          errors = Object.keys(toTranslate).length;
          translationFailed = true;
          logError(
            `Translation failed for ${locale}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (translationFailed) {
        const result: TranslationResult = {
          locale,
          translated: 0,
          cached: Object.keys(diffResult.unchanged).length,
          removed: 0,
          errors,
          duration: Date.now() - start,
        };
        logLocaleResult(result);
        results.push(result);
        continue;
      }

      const finalFlat: Record<string, string> = {
        ...diffResult.unchanged,
        ...translated,
      };

      await writeTranslation(targetFile, finalFlat, {
        flat: mode === "inline",
      });

      const allTranslatedKeys = Object.keys(finalFlat);
      const currentLock = await loadLockFile(messagesDir);
      await writeLockFile(
        messagesDir,
        sourceFlat,
        currentLock,
        allTranslatedKeys,
      );

      const result: TranslationResult = {
        locale,
        translated: Object.keys(translated).length,
        cached: Object.keys(diffResult.unchanged).length,
        removed: diffResult.removed.length,
        errors,
        duration: Date.now() - start,
      };

      logLocaleResult(result);
      results.push(result);
    }

    if (!args["dry-run"]) {
      logSummary(results);
      const usage = usageTracker.get();
      if (usage.totalTokens > 0) {
        const cost = await estimateCost(model, usage);
        logUsage(formatUsage(usage), cost ? formatCost(cost.totalUSD) : undefined);
      }
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
    const mode = config.mode ?? "keys";

    if (!config.scan) {
      logError(
        "No scan configuration found. Add a 'scan' section to your config.",
      );
      process.exit(1);
    }

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

    if (args["dry-run"]) {
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

    const existingMap = await loadMapFile(config.messagesDir);

    if (mode === "inline") {
      const existingTComponents = result.strings.filter(
        (s) => s.type === "T-component" && s.id,
      );
      for (const tc of existingTComponents) {
        if (tc.id && !(tc.text in existingMap)) {
          existingMap[tc.text] = tc.id;
        }
      }
      const existingInlineTCalls = result.strings.filter(
        (s) => s.type === "t-call" && s.id,
      );
      for (const tc of existingInlineTCalls) {
        if (tc.id && !(tc.text in existingMap)) {
          existingMap[tc.text] = tc.id;
        }
      }
    }

    logInfo("Generating semantic keys...");
    const scanUsageTracker = createUsageTracker();
    const textToKey = await generateSemanticKeys({
      model: config.model,
      strings: bareStrings,
      existingMap,
      batchSize: config.translation?.batchSize ?? 50,
      concurrency: config.translation?.concurrency ?? 3,
      retries: config.translation?.retries ?? 2,
      onProgress: (c, t) => logProgress(c, t, "Generating keys..."),
      onUsage: (usage) => scanUsageTracker.add(usage),
    });
    logProgressClear();

    await writeMapFile(config.messagesDir, textToKey);
    logSuccess(
      `Written .translate-map.json (${Object.keys(textToKey).length} keys)`,
    );

    if (mode === "inline") {
      logInfo(
        "Inline mode: source text stays in code, no source locale JSON created.",
      );
    } else {
      const messages: Record<string, string> = {};
      for (const [text, key] of Object.entries(textToKey)) {
        messages[key] = text;
      }

      const sourceFile = join(
        config.messagesDir,
        `${config.sourceLocale}.json`,
      );
      await mkdir(config.messagesDir, { recursive: true });
      const nested = unflatten(messages);
      const content = JSON.stringify(nested, null, 2) + "\n";
      await writeFile(sourceFile, content, "utf-8");

      logSuccess(`Written to ${sourceFile}`);
    }

    const scanUsage = scanUsageTracker.get();
    if (scanUsage.totalTokens > 0) {
      const cost = await estimateCost(config.model, scanUsage);
      logUsage(formatUsage(scanUsage), cost ? formatCost(cost.totalUSD) : undefined);
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
  },
  async run({ args }) {
    const config = await loadTranslateKitConfig();
    const mode = config.mode ?? "keys";

    if (!config.scan) {
      logError(
        "No scan configuration found. Add a 'scan' section to your config.",
      );
      process.exit(1);
    }

    const textToKey = await loadMapFile(config.messagesDir);

    if (Object.keys(textToKey).length === 0) {
      logError("No .translate-map.json found. Run 'translate-kit scan' first.");
      process.exit(1);
    }

    if (args["dry-run"]) {
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

    const result = await codegen({
      include: config.scan.include,
      exclude: config.scan.exclude,
      textToKey,
      i18nImport: config.scan.i18nImport,
      mode,
      componentPath: config.inline?.componentPath,
      onProgress: (c, t) => logProgress(c, t, "Processing files..."),
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
    init: initCommand,
  },
  // Default to translate command
  async run({ rawArgs }) {
    if (rawArgs.length === 0 || rawArgs[0]?.startsWith("-")) {
      const { dryRun, force, verbose, locale } = parseTranslateFlags(rawArgs);

      await translateCommand.run!({
        args: {
          _: rawArgs,
          "dry-run": dryRun,
          force,
          verbose,
          locale,
        },
        rawArgs,
        cmd: translateCommand,
      });
    }
  },
});

runMain(main);
