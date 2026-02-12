import { join } from "node:path";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { scan } from "./scanner/index.js";
import { generateSemanticKeys } from "./scanner/key-ai.js";
import { codegen, type CodegenResult } from "./codegen/index.js";
import { translateAll } from "./translate.js";
import {
  writeTranslation,
  writeTranslationSplit,
  writeLockFile,
} from "./writer.js";
import { loadJsonFile, loadLockFile, computeDiff } from "./diff.js";
import { flatten, unflatten } from "./flatten.js";
import { logWarning } from "./logger.js";
import { generateNextIntlTypes } from "./typegen.js";
import type { TranslateKitConfig } from "./types.js";

// --- Map file helpers (moved from cli.ts) ---

export async function loadMapFile(
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

export async function writeMapFile(
  messagesDir: string,
  map: Record<string, string>,
): Promise<void> {
  const mapPath = join(messagesDir, ".translate-map.json");
  await mkdir(messagesDir, { recursive: true });
  const content = JSON.stringify(map, null, 2) + "\n";
  await writeFile(mapPath, content, "utf-8");
}

export async function loadSplitMessages(
  dir: string,
): Promise<Record<string, string>> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return {};
  }

  const flat: Record<string, string> = {};
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const ns = file.replace(".json", "");
    const raw = await loadJsonFile(join(dir, file));
    const nsFlat = flatten(raw);
    for (const [key, value] of Object.entries(nsFlat)) {
      if (ns === "_root") {
        flat[key] = value;
      } else {
        flat[`${ns}.${key}`] = value;
      }
    }
  }
  return flat;
}

// --- Scan step ---

export interface ScanStepInput {
  config: TranslateKitConfig;
  cwd: string;
  callbacks?: {
    onScanProgress?: (completed: number, total: number) => void;
    onKeygenProgress?: (completed: number, total: number) => void;
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  };
}

export interface ScanStepResult {
  textToKey: Record<string, string>;
  sourceFlat: Record<string, string>;
  bareStringCount: number;
  fileCount: number;
}

export async function runScanStep(
  input: ScanStepInput,
): Promise<ScanStepResult> {
  const { config, cwd, callbacks } = input;
  const mode = config.mode ?? "keys";

  const result = await scan(config.scan!, cwd, {
    onProgress: callbacks?.onScanProgress,
  });

  // Blacklist filter: exclude already-wrapped strings
  const bareStrings = result.strings.filter((s) => {
    if (s.type === "t-call") return false;
    if (s.type === "T-component" && s.id) return false;
    return true;
  });

  const existingMap = await loadMapFile(config.messagesDir);

  // Inline mode: supplement existingMap with T-components and t-calls from scan
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

  // allTexts includes wrapped strings for key deduplication.
  // In keys mode, wrapped calls usually expose keys (not source text), so we
  // keep existing text entries to avoid pruning valid mappings on re-scans.
  const allTexts = new Set(result.strings.map((s) => s.text));
  if (mode === "keys") {
    for (const text of Object.keys(existingMap)) {
      allTexts.add(text);
    }
  }

  const textToKey = await generateSemanticKeys({
    model: config.model,
    strings: bareStrings,
    existingMap,
    allTexts,
    batchSize: config.translation?.batchSize ?? 50,
    concurrency: config.translation?.concurrency ?? 3,
    retries: config.translation?.retries ?? 2,
    onProgress: callbacks?.onKeygenProgress,
    onUsage: callbacks?.onUsage,
  });

  await writeMapFile(config.messagesDir, textToKey);

  // Keys mode: write source locale JSON
  const sourceFlat: Record<string, string> = {};
  for (const [text, key] of Object.entries(textToKey)) {
    sourceFlat[key] = text;
  }

  if (mode !== "inline") {
    if (config.splitByNamespace) {
      const sourceDir = join(config.messagesDir, config.sourceLocale);
      await writeTranslationSplit(sourceDir, sourceFlat);
    } else {
      const sourceFile = join(
        config.messagesDir,
        `${config.sourceLocale}.json`,
      );
      await mkdir(config.messagesDir, { recursive: true });
      const nested = unflatten(sourceFlat);
      const content = JSON.stringify(nested, null, 2) + "\n";
      await writeFile(sourceFile, content, "utf-8");
    }
    if (config.typeSafe) {
      await generateNextIntlTypes(
        config.messagesDir,
        config.sourceLocale,
        config.splitByNamespace,
      );
    }
  }

  return {
    textToKey,
    sourceFlat,
    bareStringCount: bareStrings.length,
    fileCount: result.fileCount,
  };
}

// --- Codegen step ---

export interface CodegenStepInput {
  config: TranslateKitConfig;
  cwd: string;
  textToKey?: Record<string, string>;
  moduleFactory?: boolean;
  callbacks?: {
    onProgress?: (completed: number, total: number) => void;
  };
}

export async function runCodegenStep(
  input: CodegenStepInput,
): Promise<CodegenResult> {
  const { config, cwd, callbacks } = input;
  const mode = config.mode ?? "keys";

  let textToKey = input.textToKey;
  if (!textToKey) {
    textToKey = await loadMapFile(config.messagesDir);
    if (Object.keys(textToKey).length === 0) {
      throw new Error(
        "No .translate-map.json found. Run 'translate-kit scan' first.",
      );
    }
  }

  return codegen(
    {
      include: config.scan!.include,
      exclude: config.scan!.exclude,
      textToKey,
      i18nImport: config.scan!.i18nImport,
      mode,
      componentPath: config.inline?.componentPath,
      moduleFactory: input.moduleFactory,
      onProgress: callbacks?.onProgress,
    },
    cwd,
  );
}

// --- Translate step ---

export interface TranslateStepInput {
  config: TranslateKitConfig;
  sourceFlat?: Record<string, string>;
  locales?: string[];
  force?: boolean;
  dryRun?: boolean;
  callbacks?: {
    onLocaleProgress?: (
      locale: string,
      completed: number,
      total: number,
    ) => void;
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  };
}

export interface TranslateLocaleResult {
  locale: string;
  translated: number;
  cached: number;
  removed: number;
  errors: number;
  duration: number;
}

export interface TranslateStepResult {
  localeResults: TranslateLocaleResult[];
}

export async function runTranslateStep(
  input: TranslateStepInput,
): Promise<TranslateStepResult> {
  const { config, callbacks } = input;
  const mode = config.mode ?? "keys";
  const locales = input.locales ?? config.targetLocales;

  // Resolve sourceFlat
  let sourceFlat = input.sourceFlat;
  if (!sourceFlat) {
    if (mode === "inline") {
      const mapData = await loadMapFile(config.messagesDir);
      sourceFlat = {};
      for (const [text, key] of Object.entries(mapData)) {
        sourceFlat[key] = text;
      }
    } else if (config.splitByNamespace) {
      const sourceDir = join(config.messagesDir, config.sourceLocale);
      sourceFlat = await loadSplitMessages(sourceDir);
    } else {
      const sourceFile = join(
        config.messagesDir,
        `${config.sourceLocale}.json`,
      );
      const sourceRaw = await loadJsonFile(sourceFile);
      sourceFlat = flatten(sourceRaw);
    }
  }

  const localeResults: TranslateLocaleResult[] = [];

  for (const locale of locales) {
    const start = Date.now();
    let targetFlat: Record<string, string>;

    if (config.splitByNamespace) {
      const targetDir = join(config.messagesDir, locale);
      targetFlat = await loadSplitMessages(targetDir);
    } else {
      const targetFile = join(config.messagesDir, `${locale}.json`);
      const targetRaw = await loadJsonFile(targetFile);
      targetFlat = flatten(targetRaw);
    }

    let lockData = await loadLockFile(config.messagesDir);
    if (input.force) {
      lockData = {};
    }

    const diffResult = computeDiff(sourceFlat, targetFlat, lockData);

    if (input.dryRun) {
      localeResults.push({
        locale,
        translated: 0,
        cached: Object.keys(diffResult.unchanged).length,
        removed: diffResult.removed.length,
        errors: 0,
        duration: Date.now() - start,
      });
      continue;
    }

    const toTranslate = { ...diffResult.added, ...diffResult.modified };
    let translated: Record<string, string> = {};
    let errors = 0;
    let translationFailed = false;

    if (Object.keys(toTranslate).length > 0) {
      try {
        translated = await translateAll({
          model: config.model,
          entries: toTranslate,
          sourceLocale: config.sourceLocale,
          targetLocale: locale,
          options: config.translation,
          onProgress: callbacks?.onLocaleProgress
            ? (c, t) => callbacks.onLocaleProgress!(locale, c, t)
            : undefined,
          onUsage: callbacks?.onUsage,
        });
      } catch (err) {
        errors = Object.keys(toTranslate).length;
        translationFailed = true;
      }
    }

    if (translationFailed) {
      localeResults.push({
        locale,
        translated: 0,
        cached: Object.keys(diffResult.unchanged).length,
        removed: 0,
        errors,
        duration: Date.now() - start,
      });
      continue;
    }

    const finalFlat: Record<string, string> = {
      ...diffResult.unchanged,
      ...translated,
    };

    if (config.splitByNamespace) {
      const targetDir = join(config.messagesDir, locale);
      await writeTranslationSplit(targetDir, finalFlat);
    } else {
      const targetFile = join(config.messagesDir, `${locale}.json`);
      await writeTranslation(targetFile, finalFlat, {
        flat: mode === "inline",
      });
    }

    const allTranslatedKeys = Object.keys(finalFlat);
    const currentLock = await loadLockFile(config.messagesDir);
    await writeLockFile(
      config.messagesDir,
      sourceFlat,
      currentLock,
      allTranslatedKeys,
    );

    localeResults.push({
      locale,
      translated: Object.keys(translated).length,
      cached: Object.keys(diffResult.unchanged).length,
      removed: diffResult.removed.length,
      errors,
      duration: Date.now() - start,
    });
  }

  return { localeResults };
}
