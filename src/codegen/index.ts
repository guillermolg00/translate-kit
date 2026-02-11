import { dirname, extname, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import _traverse from "@babel/traverse";
import type { File } from "@babel/types";
import { glob } from "tinyglobby";
import pLimit from "p-limit";
import { parseFile } from "../scanner/parser.js";
import { resolveDefault } from "../utils/ast-helpers.js";
import {
  detectClientFile,
  transform,
  type TransformOptions,
} from "./transform.js";
import { logWarning } from "../logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TraverseFn = (ast: File, opts: Record<string, any>) => void;
const traverse = resolveDefault(_traverse) as unknown as TraverseFn;

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
  clientNamespaces: string[];
}

interface ParsedFileEntry {
  filePath: string;
  code: string;
  ast?: File;
  parseError?: string;
  isClientRoot: boolean;
}

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];

interface PathAliasResolver {
  prefix: string;
  exact: boolean;
  targets: string[];
}

function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

async function loadPathAliasResolvers(cwd: string): Promise<PathAliasResolver[]> {
  const configNames = ["tsconfig.json", "jsconfig.json"];

  for (const configName of configNames) {
    let raw: string;
    try {
      raw = await readFile(join(cwd, configName), "utf-8");
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonComments(raw));
    } catch {
      continue;
    }

    const compilerOptions = (
      parsed as { compilerOptions?: { baseUrl?: string; paths?: unknown } }
    ).compilerOptions;
    if (!compilerOptions?.paths || typeof compilerOptions.paths !== "object") {
      return [];
    }

    const baseUrl =
      typeof compilerOptions.baseUrl === "string"
        ? compilerOptions.baseUrl
        : ".";
    const baseDir = resolve(join(cwd, baseUrl));
    const resolvers: PathAliasResolver[] = [];

    for (const [pattern, replacements] of Object.entries(compilerOptions.paths)) {
      if (!Array.isArray(replacements) || replacements.length === 0) continue;

      const wildcard = pattern.endsWith("/*");
      const prefix = wildcard ? pattern.slice(0, -1) : pattern;
      const targets = replacements
        .filter((r): r is string => typeof r === "string")
        .map((r) => (wildcard && r.endsWith("/*") ? r.slice(0, -1) : r))
        .map((r) => resolve(join(baseDir, r)));

      if (targets.length === 0) continue;
      resolvers.push({ prefix, exact: !wildcard, targets });
    }

    resolvers.sort((a, b) => b.prefix.length - a.prefix.length);
    return resolvers;
  }

  return [];
}

function collectRuntimeImportSources(ast: File): string[] {
  const sources = new Set<string>();

  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration") {
      if (node.importKind === "type") continue;

      const allTypeSpecifiers =
        node.specifiers.length > 0 &&
        node.specifiers.every(
          (spec) =>
            spec.type === "ImportSpecifier" && spec.importKind === "type",
        );
      if (allTypeSpecifiers) continue;

      sources.add(node.source.value);
      continue;
    }

    if (node.type === "ExportNamedDeclaration" && node.source) {
      if (node.exportKind !== "type") {
        sources.add(node.source.value);
      }
      continue;
    }

    if (node.type === "ExportAllDeclaration") {
      if (node.exportKind !== "type") {
        sources.add(node.source.value);
      }
    }
  }

  traverse(ast, {
    ImportExpression(path: any) {
      if (path.node.source.type === "StringLiteral") {
        sources.add(path.node.source.value);
      }
    },
    CallExpression(path: any) {
      // Babel can represent import() as CallExpression with Import callee.
      if (
        path.node.callee.type === "Import" &&
        path.node.arguments[0]?.type === "StringLiteral"
      ) {
        sources.add(path.node.arguments[0].value);
      }
    },
    noScope: true,
  });

  return [...sources];
}

function resolveFileCandidate(
  basePath: string,
  knownFiles: Set<string>,
): string | null {
  const candidates = new Set<string>();
  const resolvedBase = resolve(basePath);
  const baseExt = extname(resolvedBase);

  candidates.add(resolvedBase);

  if (!baseExt) {
    for (const ext of SOURCE_EXTENSIONS) {
      candidates.add(resolve(`${resolvedBase}${ext}`));
      candidates.add(resolve(join(resolvedBase, `index${ext}`)));
    }
  }

  // ESM imports may reference .js while source files are .ts/.tsx
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(baseExt)) {
    const noExt = resolvedBase.slice(0, -baseExt.length);
    for (const ext of SOURCE_EXTENSIONS) {
      candidates.add(resolve(`${noExt}${ext}`));
    }
  }

  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}

function resolveLocalImport(
  importerPath: string,
  source: string,
  cwd: string,
  knownFiles: Set<string>,
  pathAliases: PathAliasResolver[],
): string | null {
  const baseCandidates: string[] = [];

  if (source.startsWith(".")) {
    baseCandidates.push(resolve(dirname(importerPath), source));
  } else if (source.startsWith("@/")) {
    baseCandidates.push(resolve(join(cwd, "src", source.slice(2))));
    baseCandidates.push(resolve(join(cwd, source.slice(2))));
  } else if (source.startsWith("~/")) {
    baseCandidates.push(resolve(join(cwd, source.slice(2))));
  } else if (source.startsWith("/")) {
    baseCandidates.push(resolve(join(cwd, source.slice(1))));
  } else {
    for (const alias of pathAliases) {
      if (alias.exact) {
        if (source !== alias.prefix) continue;
        baseCandidates.push(...alias.targets);
      } else if (source.startsWith(alias.prefix)) {
        const suffix = source.slice(alias.prefix.length);
        for (const target of alias.targets) {
          baseCandidates.push(resolve(join(target, suffix)));
        }
      }
    }
    if (baseCandidates.length === 0) return null;
  }

  for (const base of baseCandidates) {
    const resolved = resolveFileCandidate(base, knownFiles);
    if (resolved) return resolved;
  }

  return null;
}

function buildClientGraph(
  entries: ParsedFileEntry[],
  cwd: string,
  pathAliases: PathAliasResolver[],
): Set<string> {
  const parsedEntries = entries.filter((e) => e.ast != null);
  const knownFiles = new Set(parsedEntries.map((e) => e.filePath));
  const depsByImporter = new Map<string, string[]>();

  for (const entry of parsedEntries) {
    const deps: string[] = [];
    const imports = collectRuntimeImportSources(entry.ast!);
    for (const source of imports) {
      const dep = resolveLocalImport(
        entry.filePath,
        source,
        cwd,
        knownFiles,
        pathAliases,
      );
      if (dep) deps.push(dep);
    }
    depsByImporter.set(entry.filePath, deps);
  }

  const clientReachable = new Set<string>();
  const queue: string[] = [];

  for (const entry of parsedEntries) {
    if (!entry.isClientRoot) continue;
    clientReachable.add(entry.filePath);
    queue.push(entry.filePath);
  }

  while (queue.length > 0) {
    const filePath = queue.shift()!;
    const deps = depsByImporter.get(filePath) ?? [];
    for (const dep of deps) {
      if (clientReachable.has(dep)) continue;
      clientReachable.add(dep);
      queue.push(dep);
    }
  }

  return clientReachable;
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

  const parseLimit = pLimit(10);
  const parsedEntries = await Promise.all(
    files.map((filePath) =>
      parseLimit(async (): Promise<ParsedFileEntry> => {
        const code = await readFile(filePath, "utf-8");
        try {
          const ast = parseFile(code, filePath);
          return {
            filePath,
            code,
            ast,
            isClientRoot: detectClientFile(ast),
          };
        } catch (err) {
          return {
            filePath,
            code,
            parseError: err instanceof Error ? err.message : String(err),
            isClientRoot: false,
          };
        }
      }),
    ),
  );

  const pathAliases = await loadPathAliasResolvers(cwd);
  const forceClientSet = buildClientGraph(parsedEntries, cwd, pathAliases);

  const limit = pLimit(10);
  let completed = 0;
  const clientNamespacesSet = new Set<string>();

  const fileResults = await Promise.all(
    parsedEntries.map((entry) =>
      limit(async () => {
        if (!entry.ast) {
          logWarning(
            `Skipping unparseable file ${entry.filePath}: ${entry.parseError ?? "unknown parse error"}`,
          );
          completed++;
          options.onProgress?.(completed, files.length);
          return { modified: false, wrapped: 0, skipped: false };
        }

        const isClient =
          forceClientSet.has(entry.filePath) || entry.isClientRoot;
        const fileTransformOpts: TransformOptions = {
          ...transformOpts,
          forceClient: forceClientSet.has(entry.filePath),
        };

        const result = transform(
          entry.ast,
          options.textToKey,
          fileTransformOpts,
        );

        // Collect namespaces from client files for selective message passing
        if (isClient && result.usedKeys.length > 0) {
          for (const key of result.usedKeys) {
            const dot = key.indexOf(".");
            if (dot > 0) {
              clientNamespacesSet.add(key.slice(0, dot));
            }
          }
        }

        if (result.modified) {
          try {
            parseFile(result.code, entry.filePath);
          } catch {
            logWarning(
              `Codegen produced invalid syntax for ${entry.filePath}, file was NOT modified.`,
            );
            completed++;
            options.onProgress?.(completed, files.length);
            return { modified: false, wrapped: 0, skipped: true };
          }

          await writeFile(entry.filePath, result.code, "utf-8");
          completed++;
          options.onProgress?.(completed, files.length);
          return {
            modified: true,
            wrapped: result.stringsWrapped,
            skipped: false,
          };
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
    clientNamespaces: [...clientNamespacesSet].sort(),
  };
}
