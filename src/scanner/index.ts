import { readFile } from "node:fs/promises";
import { glob } from "tinyglobby";
import pLimit from "p-limit";
import { parseFile } from "./parser.js";
import { extractStrings } from "./extractor.js";
import { enrichStrings } from "./context-enricher.js";
import { logVerbose } from "../logger.js";
import type { ExtractedString, ScanOptions } from "../types.js";

export interface ScanResult {
  strings: ExtractedString[];
  fileCount: number;
}

export interface ScanCallbacks {
  onProgress?: (completed: number, total: number) => void;
}

export async function scan(
  options: ScanOptions,
  cwd: string = process.cwd(),
  callbacks?: ScanCallbacks,
): Promise<ScanResult> {
  const files = await glob(options.include, {
    ignore: options.exclude ?? [],
    cwd,
    absolute: true,
  });

  const allStrings: ExtractedString[] = [];

  const limit = pLimit(10);
  let completed = 0;

  const fileResults = await Promise.all(
    files.map((filePath) =>
      limit(async () => {
        const code = await readFile(filePath, "utf-8");
        let ast;
        try {
          ast = parseFile(code, filePath);
        } catch (err) {
          logVerbose(
            `Skipping unparseable file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
            false,
          );
          completed++;
          callbacks?.onProgress?.(completed, files.length);
          return null;
        }
        const raw = extractStrings(ast, filePath, options.translatableProps);
        const strings = enrichStrings(raw, filePath);
        completed++;
        callbacks?.onProgress?.(completed, files.length);
        return { strings, filePath };
      }),
    ),
  );

  for (const result of fileResults) {
    if (!result) continue;
    allStrings.push(...result.strings);
  }

  return {
    strings: allStrings,
    fileCount: files.length,
  };
}
