import { readFile, writeFile } from "node:fs/promises";
import { glob } from "tinyglobby";
import pLimit from "p-limit";
import { parseFile } from "../scanner/parser.js";
import { transform, type TransformOptions } from "./transform.js";
import { logWarning } from "../logger.js";

export interface CodegenOptions {
  include: string[];
  exclude?: string[];
  textToKey: Record<string, string>;
  i18nImport?: string;
  mode?: "keys" | "inline";
  componentPath?: string;
  onProgress?: (completed: number, total: number) => void;
}

export interface CodegenResult {
  filesModified: number;
  stringsWrapped: number;
  filesProcessed: number;
  filesSkipped: number;
}

export async function codegen(
  options: CodegenOptions,
  cwd: string = process.cwd(),
): Promise<CodegenResult> {
  const files = await glob(options.include, {
    ignore: options.exclude ?? [],
    cwd,
    absolute: true,
  });

  const transformOpts: TransformOptions = {
    i18nImport: options.i18nImport,
    mode: options.mode,
    componentPath: options.componentPath,
  };

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
          logWarning(
            `Skipping unparseable file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          );
          completed++;
          options.onProgress?.(completed, files.length);
          return { modified: false, wrapped: 0, skipped: false };
        }

        const result = transform(ast, options.textToKey, transformOpts);

        if (result.modified) {
          try {
            parseFile(result.code, filePath);
          } catch {
            logWarning(
              `Codegen produced invalid syntax for ${filePath}, file was NOT modified.`,
            );
            completed++;
            options.onProgress?.(completed, files.length);
            return { modified: false, wrapped: 0, skipped: true };
          }

          await writeFile(filePath, result.code, "utf-8");
          completed++;
          options.onProgress?.(completed, files.length);
          return { modified: true, wrapped: result.stringsWrapped, skipped: false };
        }

        completed++;
        options.onProgress?.(completed, files.length);
        return { modified: false, wrapped: 0, skipped: false };
      }),
    ),
  );

  let filesModified = 0;
  let stringsWrapped = 0;
  let filesSkipped = 0;

  for (const r of fileResults) {
    if (r.modified) {
      filesModified++;
      stringsWrapped += r.wrapped;
    }
    if (r.skipped) filesSkipped++;
  }

  return {
    filesModified,
    stringsWrapped,
    filesProcessed: files.length,
    filesSkipped,
  };
}
