import { readFile, writeFile } from "node:fs/promises";
import { glob } from "tinyglobby";
import { parseFile } from "../scanner/parser.js";
import { transform, type TransformOptions } from "./transform.js";
import { logVerbose } from "../logger.js";

export interface CodegenOptions {
  include: string[];
  exclude?: string[];
  textToKey: Record<string, string>;
  i18nImport?: string;
  mode?: "keys" | "inline";
  componentPath?: string;
}

export interface CodegenResult {
  filesModified: number;
  stringsWrapped: number;
  filesProcessed: number;
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

  let filesModified = 0;
  let stringsWrapped = 0;

  const transformOpts: TransformOptions = {
    i18nImport: options.i18nImport,
    mode: options.mode,
    componentPath: options.componentPath,
  };

  for (const filePath of files) {
    const code = await readFile(filePath, "utf-8");

    let ast;
    try {
      ast = parseFile(code, filePath);
    } catch (err) {
      logVerbose(`Skipping unparseable file ${filePath}: ${err instanceof Error ? err.message : String(err)}`, true);
      continue;
    }

    const result = transform(ast, options.textToKey, transformOpts);

    if (result.modified) {
      await writeFile(filePath, result.code, "utf-8");
      filesModified++;
      stringsWrapped += result.stringsWrapped;
    }
  }

  return {
    filesModified,
    stringsWrapped,
    filesProcessed: files.length,
  };
}
