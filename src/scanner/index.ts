import { readFile } from "node:fs/promises";
import { glob } from "tinyglobby";
import { parseFile } from "./parser.js";
import { extractStrings } from "./extractor.js";
import { generateKey } from "./key-generator.js";
import { logVerbose } from "../logger.js";
import type { ExtractedString, ScanOptions } from "../types.js";

export interface ScanResult {
  strings: ExtractedString[];
  messages: Record<string, string>;
  fileCount: number;
}

export async function scan(
  options: ScanOptions,
  cwd: string = process.cwd(),
): Promise<ScanResult> {
  const files = await glob(options.include, {
    ignore: options.exclude ?? [],
    cwd,
    absolute: true,
  });

  const allStrings: ExtractedString[] = [];
  const messages: Record<string, string> = {};
  const keyStrategy = options.keyStrategy ?? "hash";

  for (const filePath of files) {
    const code = await readFile(filePath, "utf-8");

    let ast;
    try {
      ast = parseFile(code, filePath);
    } catch (err) {
      logVerbose(
        `Skipping unparseable file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
      continue;
    }

    const strings = extractStrings(ast, filePath, options.translatableProps);

    for (const str of strings) {
      const key = generateKey(str, keyStrategy);
      if (!(key in messages)) {
        messages[key] = str.text;
      }
      allStrings.push(str);
    }
  }

  return {
    strings: allStrings,
    messages,
    fileCount: files.length,
  };
}
