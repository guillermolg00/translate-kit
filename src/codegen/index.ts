import { basename, dirname, extname, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import _traverse from "@babel/traverse";
import type { File } from "@babel/types";
import { glob } from "tinyglobby";
import pLimit from "p-limit";
import { parseFile } from "../scanner/parser.js";
import { resolveDefault, getComponentName, isPascalCase } from "../utils/ast-helpers.js";
import {
  detectClientFile,
  transform,
  type TransformOptions,
} from "./transform.js";
import { isContentProperty } from "../scanner/filters.js";
import { buildTemplateLiteralText } from "../utils/template-literal.js";
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
  moduleFactory?: boolean;
  translatableProps?: string[];
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

// --- Module factory planning ---

interface ModuleFactoryPlan {
  factoryConstsByFile: Map<string, string[]>;
  factoryImportsByFile: Map<string, string[]>;
}

/**
 * Check whether an AST value node contains a translatable string present in textToKey.
 * Handles StringLiteral, TemplateLiteral (static only), and ConditionalExpression branches.
 */
function hasTranslatableValue(
  node: import("@babel/types").Node,
  textToKey: Record<string, string>,
): boolean {
  if (node.type === "StringLiteral") {
    const text = node.value.trim();
    return !!text && text in textToKey;
  }
  if (node.type === "TemplateLiteral") {
    const info = buildTemplateLiteralText(node.quasis, node.expressions);
    return !!info && info.text in textToKey;
  }
  if (node.type === "ConditionalExpression") {
    return (
      hasTranslatableValue(node.consequent, textToKey) ||
      hasTranslatableValue(node.alternate, textToKey)
    );
  }
  return false;
}

// Next.js/framework special exports that must never be wrapped as factories.
// These are read directly by the framework and must remain plain objects.
const FRAMEWORK_RESERVED_EXPORTS = new Set([
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "generateStaticParams",
]);

function collectModuleFactoryCandidates(
  entries: ParsedFileEntry[],
  textToKey: Record<string, string>,
): Map<string, Set<string>> {
  // file → set of const names that have translatable object properties
  const candidates = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (!entry.ast) continue;

    // Collect top-level const declarations
    const topLevelConsts = new Map<string, { exported: boolean; typed: boolean }>();
    for (const node of entry.ast.program.body) {
      let decl: import("@babel/types").VariableDeclaration | undefined;
      let exported = false;
      if (node.type === "VariableDeclaration" && node.kind === "const") {
        decl = node;
      } else if (
        node.type === "ExportNamedDeclaration" &&
        node.declaration?.type === "VariableDeclaration" &&
        node.declaration.kind === "const"
      ) {
        decl = node.declaration;
        exported = true;
      }
      if (!decl) continue;

      for (const declarator of decl.declarations) {
        if (declarator.id.type !== "Identifier") continue;
        const typed = !!(declarator.id as import("@babel/types").Identifier & { typeAnnotation?: unknown }).typeAnnotation;
        topLevelConsts.set(declarator.id.name, { exported, typed });
      }
    }

    // Find which consts contain translatable object properties
    traverse(entry.ast, {
      ObjectProperty(path: any) {
        // Must be at module level (not inside a function)
        let current = path.parentPath;
        let insideFunction = false;
        let constName: string | undefined;
        while (current) {
          if (
            current.isFunctionDeclaration?.() ||
            current.isFunctionExpression?.() ||
            current.isArrowFunctionExpression?.()
          ) {
            insideFunction = true;
            break;
          }
          if (current.isVariableDeclarator?.()) {
            const id = current.node.id;
            if (id.type === "Identifier" && topLevelConsts.has(id.name)) {
              constName = id.name;
            }
          }
          current = current.parentPath;
        }
        if (insideFunction || !constName) return;

        const info = topLevelConsts.get(constName);
        if (!info) return;

        // Skip framework-reserved exports (e.g. Next.js metadata)
        if (info.exported && FRAMEWORK_RESERVED_EXPORTS.has(constName)) return;

        const keyNode = path.node.key;
        if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral") return;
        const propName = keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
        if (!isContentProperty(propName)) return;

        const valueNode = path.node.value;
        if (!hasTranslatableValue(valueNode, textToKey)) return;

        if (!candidates.has(entry.filePath)) {
          candidates.set(entry.filePath, new Set());
        }
        candidates.get(entry.filePath)!.add(constName);
      },
      noScope: true,
    });
  }

  return candidates;
}

function collectModuleFactoryImportEdges(
  entries: ParsedFileEntry[],
  candidates: Map<string, Set<string>>,
  cwd: string,
  knownFiles: Set<string>,
  pathAliases: PathAliasResolver[],
): Map<string, string[]> {
  // importerFile → list of local names that reference a factory const
  const importsByFile = new Map<string, string[]>();

  // Build a set of all (file, exportedName) pairs
  const factoryExports = new Map<string, Set<string>>();
  for (const [file, names] of candidates) {
    factoryExports.set(file, names);
  }

  for (const entry of entries) {
    if (!entry.ast) continue;

    for (const node of entry.ast.program.body) {
      if (node.type !== "ImportDeclaration") continue;
      // Skip namespace imports
      if (node.specifiers.some((s: any) => s.type === "ImportNamespaceSpecifier")) continue;

      const source = node.source.value;
      const resolved = resolveLocalImport(
        entry.filePath,
        source,
        cwd,
        knownFiles,
        pathAliases,
      );
      if (!resolved || !factoryExports.has(resolved)) continue;

      const exportedNames = factoryExports.get(resolved)!;

      for (const spec of node.specifiers) {
        if (spec.type !== "ImportSpecifier") continue;
        const importedName = spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
        if (!exportedNames.has(importedName)) continue;

        const localName = spec.local.name;
        if (!importsByFile.has(entry.filePath)) {
          importsByFile.set(entry.filePath, []);
        }
        importsByFile.get(entry.filePath)!.push(localName);
      }
    }
  }

  return importsByFile;
}

/**
 * Check if a file that defines factory consts also uses them locally in
 * component functions.  Returns the const names that are referenced inside
 * a function with a PascalCase name (React component heuristic).
 */
function collectLocalFactoryUsages(
  ast: File,
  constNames: Set<string>,
): string[] {
  const used = new Set<string>();
  traverse(ast, {
    Identifier(path: any) {
      if (!constNames.has(path.node.name)) return;
      const parent = path.parent;
      // Skip declaration id
      if (parent.type === "VariableDeclarator" && parent.id === path.node) return;
      // Skip import/export specifiers
      if (
        parent.type === "ImportSpecifier" ||
        parent.type === "ExportSpecifier" ||
        parent.type === "ImportDefaultSpecifier"
      ) return;
      // Must be inside a React component (PascalCase function)
      const compName = getComponentName(path);
      if (compName && isPascalCase(compName)) {
        used.add(path.node.name);
      }
    },
    noScope: true,
  });
  return [...used];
}

/**
 * Given an unsafe local name in an importer file, resolve which source file
 * and exported name it corresponds to, then record it as unsafe.
 */
function markUnsafeExport(
  importerAst: File,
  localName: string,
  importerFile: string,
  safeCandidates: Map<string, Set<string>>,
  entries: ParsedFileEntry[],
  cwd: string,
  knownFiles: Set<string>,
  pathAliases: PathAliasResolver[],
  unsafeExportedNames: Map<string, Set<string>>,
): void {
  for (const node of importerAst.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    for (const spec of node.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;
      if (spec.local.name !== localName) continue;
      const exportedName =
        spec.imported.type === "Identifier"
          ? spec.imported.name
          : spec.imported.value;
      const resolved = resolveLocalImport(
        importerFile,
        node.source.value,
        cwd,
        knownFiles,
        pathAliases,
      );
      if (resolved && safeCandidates.has(resolved)) {
        if (!unsafeExportedNames.has(resolved)) {
          unsafeExportedNames.set(resolved, new Set());
        }
        unsafeExportedNames.get(resolved)!.add(exportedName);
      }
    }
  }
  // For local usages (self-references), the localName IS the exported name
  if (safeCandidates.has(importerFile) && safeCandidates.get(importerFile)!.has(localName)) {
    if (!unsafeExportedNames.has(importerFile)) {
      unsafeExportedNames.set(importerFile, new Set());
    }
    unsafeExportedNames.get(importerFile)!.add(localName);
  }
}

/**
 * Given a local name in an importer AST, find which exported name it maps to
 * from a given source file.
 */
function resolveLocalToExportedName(
  importerAst: File | undefined,
  localName: string,
  importerFile: string,
  sourceFile: string,
  cwd: string,
  knownFiles: Set<string>,
  pathAliases: PathAliasResolver[],
): string | undefined {
  if (!importerAst) return undefined;
  for (const node of importerAst.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    for (const spec of node.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;
      if (spec.local.name !== localName) continue;
      // Verify this import points to the source file
      const resolved = resolveLocalImport(
        importerFile,
        node.source.value,
        cwd,
        knownFiles,
        pathAliases,
      );
      if (resolved !== sourceFile) continue;
      return spec.imported.type === "Identifier"
        ? spec.imported.name
        : spec.imported.value;
    }
  }
  // For self-references (local usage in the same file), localName is the exported name
  if (importerFile === sourceFile) return localName;
  return undefined;
}

function getBindingSafety(
  ast: File,
  bindingName: string,
): { safe: boolean; reason?: string } {
  let unsafe = false;
  let reason: string | undefined;

  traverse(ast, {
    Identifier(path: any) {
      if (unsafe) return;
      if (path.node.name !== bindingName) return;

      // Use scope to verify this Identifier refers to the top-level binding,
      // not a shadowed local variable or destructuring parameter.
      const binding = path.scope?.getBinding(bindingName);
      if (!binding) return;

      const bPath = binding.path;
      const isTopLevel =
        bPath.isVariableDeclarator?.() &&
        bPath.parentPath?.isVariableDeclaration?.() &&
        (bPath.parentPath.parentPath?.isProgram?.() ||
          bPath.parentPath.parentPath?.isExportNamedDeclaration?.());
      const isImportBinding =
        bPath.isImportSpecifier?.() || bPath.isImportDefaultSpecifier?.();
      if (!isTopLevel && !isImportBinding) return;

      const parent = path.parent;

      // Skip import/export specifiers
      if (
        parent.type === "ImportSpecifier" ||
        parent.type === "ImportDefaultSpecifier" ||
        parent.type === "ExportSpecifier"
      ) {
        return;
      }

      // Skip type contexts
      if (
        parent.type === "TSTypeReference" ||
        parent.type === "TSTypeQuery" ||
        parent.type === "TSTypeAnnotation"
      ) {
        return;
      }

      // Skip the declaration itself (e.g. `const FOO = ...` — the `FOO` id)
      if (
        parent.type === "VariableDeclarator" &&
        (parent as import("@babel/types").VariableDeclarator).id === path.node
      ) {
        return;
      }

      // Must be inside a React component (PascalCase name)
      const compName = getComponentName(path);
      if (!compName || !isPascalCase(compName)) {
        unsafe = true;
        reason = `"${bindingName}" is referenced outside a React component`;
        return;
      }

      // Mutation: direct assignment
      if (
        parent.type === "AssignmentExpression" &&
        parent.left === path.node
      ) {
        unsafe = true;
        reason = `"${bindingName}" is mutated via assignment`;
        return;
      }

      // Mutation via member expression
      if (parent.type === "MemberExpression" && parent.object === path.node) {
        const grandParent = path.parentPath?.parent;
        // Method mutations (.push(), .splice(), etc.)
        if (
          grandParent?.type === "CallExpression" &&
          grandParent.callee === parent &&
          parent.property.type === "Identifier" &&
          ["push", "splice", "pop", "shift", "unshift", "sort", "reverse", "fill"].includes(parent.property.name)
        ) {
          unsafe = true;
          reason = `"${bindingName}" is mutated via .${parent.property.name}()`;
          return;
        }
        // Property/indexed assignment (items[0] = ..., items.foo = ...)
        if (
          grandParent?.type === "AssignmentExpression" &&
          grandParent.left === parent
        ) {
          unsafe = true;
          reason = `"${bindingName}" is mutated via property/indexed assignment`;
          return;
        }
        // delete items.foo
        if (
          grandParent?.type === "UnaryExpression" &&
          (grandParent as import("@babel/types").UnaryExpression).operator === "delete"
        ) {
          unsafe = true;
          reason = `"${bindingName}" is mutated via delete`;
          return;
        }
      }

      // UpdateExpression (++items, items++)
      if (parent.type === "UpdateExpression") {
        unsafe = true;
        reason = `"${bindingName}" is mutated via ${(parent as import("@babel/types").UpdateExpression).operator}`;
        return;
      }
    },
  });

  return unsafe ? { safe: false, reason } : { safe: true };
}

/**
 * Scan project files outside the include scope for imports of factory candidates.
 * ANY external import of a factory const blocks it, because we cannot rewrite the
 * external file to call the factory.
 */
async function findExternalImportersOfCandidates(
  candidates: Map<string, Set<string>>,
  entries: ParsedFileEntry[],
  cwd: string,
  pathAliases: PathAliasResolver[],
): Promise<Map<string, Set<string>>> {
  const blocked = new Map<string, Set<string>>();
  if (candidates.size === 0) return blocked;

  const allFiles = await glob(["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"], {
    ignore: ["node_modules/**", "dist/**", "build/**", ".next/**", ".output/**"],
    cwd,
    absolute: true,
  });

  const includedFiles = new Set(entries.map((e) => e.filePath));
  const externalFiles = allFiles.filter((f) => !includedFiles.has(f));
  if (externalFiles.length === 0) return blocked;

  // Quick pre-filter: basenames of candidate files (without extension)
  const candidateBasenames = new Set<string>();
  for (const file of candidates.keys()) {
    candidateBasenames.add(basename(file).replace(/\.[^.]+$/, ""));
  }

  const allKnownFiles = new Set(allFiles);
  const parseLimit = pLimit(10);

  await Promise.all(
    externalFiles.map((extFile) =>
      parseLimit(async () => {
        let content: string;
        try {
          content = await readFile(extFile, "utf-8");
        } catch {
          return;
        }

        // Text pre-filter: skip files that don't mention any candidate basename
        let mightImport = false;
        for (const base of candidateBasenames) {
          if (content.includes(base)) {
            mightImport = true;
            break;
          }
        }
        if (!mightImport) return;

        let ast: File;
        try {
          ast = parseFile(content, extFile);
        } catch {
          return;
        }

        for (const node of ast.program.body) {
          if (node.type !== "ImportDeclaration") continue;

          const resolved = resolveLocalImport(
            extFile,
            node.source.value,
            cwd,
            allKnownFiles,
            pathAliases,
          );
          if (!resolved || !candidates.has(resolved)) continue;

          const exportedNames = candidates.get(resolved)!;

          // Namespace import blocks all exports
          if (node.specifiers.some((s: any) => s.type === "ImportNamespaceSpecifier")) {
            if (!blocked.has(resolved)) blocked.set(resolved, new Set());
            for (const name of exportedNames) {
              blocked.get(resolved)!.add(name);
            }
            continue;
          }

          for (const spec of node.specifiers) {
            if (spec.type !== "ImportSpecifier") continue;
            const importedName =
              spec.imported.type === "Identifier"
                ? spec.imported.name
                : spec.imported.value;
            if (exportedNames.has(importedName)) {
              if (!blocked.has(resolved)) blocked.set(resolved, new Set());
              blocked.get(resolved)!.add(importedName);
            }
          }
        }
      }),
    ),
  );

  return blocked;
}

async function buildModuleFactoryPlan(
  entries: ParsedFileEntry[],
  textToKey: Record<string, string>,
  cwd: string,
  pathAliases: PathAliasResolver[],
): Promise<ModuleFactoryPlan> {
  const candidates = collectModuleFactoryCandidates(entries, textToKey);
  const knownFiles = new Set(entries.filter((e) => e.ast).map((e) => e.filePath));

  // Check for external importers (files outside include scope) FIRST.
  // Any external import of a factory const blocks it entirely because
  // we cannot rewrite the external file to call the factory.
  const externallyBlocked = await findExternalImportersOfCandidates(
    candidates,
    entries,
    cwd,
    pathAliases,
  );
  for (const [file, names] of externallyBlocked) {
    const candidateNames = candidates.get(file);
    if (!candidateNames) continue;
    for (const name of names) {
      if (candidateNames.has(name)) {
        candidateNames.delete(name);
        logWarning(
          `Module factory: blocking "${name}" in ${file} — imported by a file outside the include scope`,
        );
      }
    }
    if (candidateNames.size === 0) {
      candidates.delete(file);
    }
  }

  // Safety check: validate bindings
  const safeCandidates = new Map<string, Set<string>>();
  for (const [file, names] of candidates) {
    const entry = entries.find((e) => e.filePath === file);
    if (!entry?.ast) continue;

    const safeNames = new Set<string>();
    for (const name of names) {
      const safety = getBindingSafety(entry.ast, name);
      if (safety.safe) {
        safeNames.add(name);
      } else {
        logWarning(`Module factory: skipping "${name}" in ${file}: ${safety.reason}`);
      }
    }
    if (safeNames.size > 0) {
      safeCandidates.set(file, safeNames);
    }
  }

  // Collect import edges (cross-file references to factory consts)
  const importEdges = collectModuleFactoryImportEdges(
    entries,
    safeCandidates,
    cwd,
    knownFiles,
    pathAliases,
  );

  // Also detect local usages: if the defining file uses the const in a component,
  // add self-references so those usages get rewritten too.
  for (const [file, names] of safeCandidates) {
    const entry = entries.find((e) => e.filePath === file);
    if (!entry?.ast) continue;

    const localRefs = collectLocalFactoryUsages(entry.ast, names);
    if (localRefs.length > 0) {
      const existing = importEdges.get(file) ?? [];
      importEdges.set(file, [...existing, ...localRefs]);
    }
  }

  // Safety check: validate importer bindings.
  // Track which exported names have at least one UNSAFE consumer so we can
  // remove them from the source-side plan too (issue #3: unsafe importers
  // must block source transformation).
  const unsafeExportedNames = new Map<string, Set<string>>(); // sourceFile → names with unsafe consumers

  const safeImports = new Map<string, string[]>();
  for (const [file, localNames] of importEdges) {
    const entry = entries.find((e) => e.filePath === file);
    if (!entry?.ast) continue;

    const safeLocalNames: string[] = [];
    for (const name of localNames) {
      const safety = getBindingSafety(entry.ast, name);
      if (safety.safe) {
        safeLocalNames.push(name);
      } else {
        logWarning(`Module factory: skipping import "${name}" in ${file}: ${safety.reason}`);
        // Track which exported name this corresponds to, so we can block the source
        markUnsafeExport(entry.ast, name, file, safeCandidates, entries, cwd, knownFiles, pathAliases, unsafeExportedNames);
      }
    }
    if (safeLocalNames.length > 0) {
      safeImports.set(file, safeLocalNames);
    }
  }

  // Remove consts that have any unsafe consumer from the source plan
  for (const [sourceFile, unsafeNames] of unsafeExportedNames) {
    const safeNames = safeCandidates.get(sourceFile);
    if (!safeNames) continue;
    for (const name of unsafeNames) {
      safeNames.delete(name);
      logWarning(`Module factory: blocking "${name}" in ${sourceFile} because an importer cannot be safely rewritten`);
    }
    if (safeNames.size === 0) {
      safeCandidates.delete(sourceFile);
    }
    // Also clean up import edges that reference this const
    for (const [importFile, locals] of safeImports) {
      const filtered = locals.filter((l) => {
        // Check if this local name maps back to the blocked const
        const exportedName = resolveLocalToExportedName(
          entries.find((e) => e.filePath === importFile)?.ast,
          l,
          importFile,
          sourceFile,
          cwd,
          knownFiles,
          pathAliases,
        );
        return !exportedName || !unsafeNames.has(exportedName);
      });
      if (filtered.length > 0) {
        safeImports.set(importFile, filtered);
      } else {
        safeImports.delete(importFile);
      }
    }
  }

  // Build final plan
  const factoryConstsByFile = new Map<string, string[]>();
  for (const [file, names] of safeCandidates) {
    factoryConstsByFile.set(file, [...names]);
  }

  return {
    factoryConstsByFile,
    factoryImportsByFile: safeImports,
  };
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
    translatableProps: options.translatableProps,
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

  // Module factory plan (optional)
  let factoryPlan: ModuleFactoryPlan | undefined;
  if (options.moduleFactory) {
    factoryPlan = await buildModuleFactoryPlan(
      parsedEntries,
      options.textToKey,
      cwd,
      pathAliases,
    );
  }

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
          moduleFactoryConstNames: factoryPlan?.factoryConstsByFile.get(entry.filePath),
          moduleFactoryImportedNames: factoryPlan?.factoryImportsByFile.get(entry.filePath),
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
