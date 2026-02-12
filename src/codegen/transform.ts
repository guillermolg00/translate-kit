import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import type { File } from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { isContentProperty, isTranslatableProp } from "../scanner/filters.js";
import {
  resolveDefault,
  isInsideFunction,
  getComponentName,
  getTopLevelConstName,
  isPascalCase,
} from "../utils/ast-helpers.js";
import {
  buildTemplateLiteralText,
  buildValuesObject,
} from "../utils/template-literal.js";
import { logWarning } from "../logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TraverseFn = (ast: File, opts: Record<string, any>) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenerateFn = (ast: File, opts?: Record<string, any>) => { code: string };

const traverse = resolveDefault(_traverse) as unknown as TraverseFn;
const generate = resolveDefault(_generate) as unknown as GenerateFn;

type JSXChild =
  | t.JSXText
  | t.JSXExpressionContainer
  | t.JSXSpreadChild
  | t.JSXElement
  | t.JSXFragment;

function hasSubstantialSiblings(parent: NodePath<t.JSXElement>): boolean {
  const count = parent.node.children.filter((child: JSXChild) => {
    if (child.type === "JSXText") return child.value.trim().length > 0;
    return true;
  }).length;
  return count > 1;
}

function findLastImportIndex(ast: File): number {
  let idx = -1;
  for (let i = 0; i < ast.program.body.length; i++) {
    if (ast.program.body[i].type === "ImportDeclaration") {
      idx = i;
    }
  }
  return idx;
}

export interface TransformResult {
  code: string;
  stringsWrapped: number;
  modified: boolean;
  usedKeys: string[];
}

export interface TransformOptions {
  i18nImport?: string;
  mode?: "keys" | "inline";
  componentPath?: string;
  forceClient?: boolean;
  moduleFactoryConstNames?: string[];
  moduleFactoryImportedNames?: string[];
  translatableProps?: string[];
}

export function detectNamespace(keys: string[]): string | null {
  if (keys.length === 0) return null;

  const prefixes = keys.map((k) => {
    const dot = k.indexOf(".");
    return dot > 0 ? k.slice(0, dot) : null;
  });

  // All keys must have a dot-separated prefix and share the same one
  if (prefixes.some((p) => p === null)) return null;

  const first = prefixes[0];
  if (prefixes.every((p) => p === first)) return first;

  return null;
}

function stripNamespace(key: string, ns: string): string {
  const prefix = ns + ".";
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function ensureBlockBody(
  fn: t.ArrowFunctionExpression | t.FunctionExpression,
): t.BlockStatement {
  if (fn.body.type === "BlockStatement") return fn.body;
  fn.body = t.blockStatement([t.returnStatement(fn.body as t.Expression)]);
  return fn.body;
}

function isInsideClass(path: NodePath<t.Node>): boolean {
  let current = path.parentPath;
  while (current) {
    if (
      current.isClassMethod() ||
      current.isClassPrivateMethod() ||
      current.isClassDeclaration() ||
      current.isClassExpression()
    ) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

function markGeneratedCall(call: t.CallExpression): t.CallExpression {
  (call as t.CallExpression & { __tkGenerated?: true }).__tkGenerated = true;
  return call;
}

function isGeneratedCall(call: t.CallExpression): boolean {
  return (
    (call as t.CallExpression & { __tkGenerated?: true }).__tkGenerated === true
  );
}

function isIdentifierPattern(
  param: t.LVal | t.PatternLike | t.TSParameterProperty,
): param is t.Identifier {
  return param.type === "Identifier";
}

function collectPatternNames(
  pattern: t.LVal | t.PatternLike | t.TSParameterProperty,
  names: Set<string>,
): void {
  if (pattern.type === "TSParameterProperty") {
    collectPatternNames(
      pattern.parameter as t.LVal | t.PatternLike | t.TSParameterProperty,
      names,
    );
    return;
  }

  if (isIdentifierPattern(pattern)) {
    names.add(pattern.name);
    return;
  }

  if (pattern.type === "VoidPattern") return;

  if (pattern.type === "ObjectPattern") {
    for (const prop of pattern.properties) {
      if (prop.type === "ObjectProperty") {
        collectPatternNames(
          prop.value as t.LVal | t.PatternLike | t.TSParameterProperty,
          names,
        );
      } else if (prop.type === "RestElement") {
        collectPatternNames(
          prop.argument as t.LVal | t.PatternLike | t.TSParameterProperty,
          names,
        );
      }
    }
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const el of pattern.elements) {
      if (el) {
        collectPatternNames(
          el as t.LVal | t.PatternLike | t.TSParameterProperty,
          names,
        );
      }
    }
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    collectPatternNames(
      pattern.left as t.LVal | t.PatternLike | t.TSParameterProperty,
      names,
    );
    return;
  }
  if (pattern.type === "RestElement") {
    collectPatternNames(
      pattern.argument as t.LVal | t.PatternLike | t.TSParameterProperty,
      names,
    );
  }
}

function collectBlockNames(block: t.BlockStatement, names: Set<string>): void {
  for (const stmt of block.body) {
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        collectPatternNames(d.id, names);
      }
      continue;
    }
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      names.add(stmt.id.name);
      continue;
    }
    if (stmt.type === "ClassDeclaration" && stmt.id) {
      names.add(stmt.id.name);
    }
  }
}

function pickTranslatorId(
  block: t.BlockStatement,
  ownerFn?: t.Function,
): string {
  const names = new Set<string>();
  if (ownerFn) {
    for (const param of ownerFn.params) {
      collectPatternNames(param, names);
    }
  }
  collectBlockNames(block, names);
  if (!names.has("t")) return "t";
  let i = 0;
  while (true) {
    const candidate = i === 0 ? "__tk_t" : `__tk_t${i + 1}`;
    if (!names.has(candidate)) return candidate;
    i++;
  }
}

function findWrappedFunctionInCall(
  node: t.CallExpression,
): t.FunctionExpression | t.ArrowFunctionExpression | null {
  for (const arg of node.arguments) {
    if (
      arg.type === "FunctionExpression" ||
      arg.type === "ArrowFunctionExpression"
    ) {
      return arg;
    }
    if (arg.type === "CallExpression") {
      const nested = findWrappedFunctionInCall(arg);
      if (nested) return nested;
    }
  }
  if (node.callee.type === "CallExpression") {
    return findWrappedFunctionInCall(node.callee);
  }
  return null;
}

function resolveNamedImportLocal(
  ast: File,
  importSource: string,
  importedName: string,
): string | null {
  for (const node of ast.program.body) {
    if (
      node.type === "ImportDeclaration" &&
      node.source.value === importSource
    ) {
      for (const spec of node.specifiers) {
        if (
          spec.type === "ImportSpecifier" &&
          spec.imported.type === "Identifier" &&
          spec.imported.name === importedName &&
          spec.local.type === "Identifier"
        ) {
          return spec.local.name;
        }
      }
    }
  }
  return null;
}

function ensureNamedImportLocal(
  ast: File,
  importSource: string,
  importedName: string,
): string {
  const existingLocal = resolveNamedImportLocal(
    ast,
    importSource,
    importedName,
  );
  if (existingLocal) return existingLocal;

  for (const node of ast.program.body) {
    if (
      node.type !== "ImportDeclaration" ||
      node.source.value !== importSource
    ) {
      continue;
    }
    node.specifiers.push(
      t.importSpecifier(t.identifier(importedName), t.identifier(importedName)),
    );
    return importedName;
  }

  const importDecl = t.importDeclaration(
    [t.importSpecifier(t.identifier(importedName), t.identifier(importedName))],
    t.stringLiteral(importSource),
  );

  const lastImportIndex = findLastImportIndex(ast);
  if (lastImportIndex >= 0) {
    ast.program.body.splice(lastImportIndex + 1, 0, importDecl);
  } else {
    ast.program.body.unshift(importDecl);
  }

  return importedName;
}

function getNearestFunctionPath(
  path: NodePath<t.Node>,
): NodePath<t.Function> | null {
  let current = path.parentPath;
  while (current) {
    if (
      current.isFunctionDeclaration() ||
      current.isFunctionExpression() ||
      current.isArrowFunctionExpression()
    ) {
      return current as NodePath<t.Function>;
    }
    current = current.parentPath;
  }
  return null;
}

function functionContainsJSX(fn: t.Function): boolean {
  let found = false;

  const visit = (node: t.Node | null | undefined): void => {
    if (!node || found) return;
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      found = true;
      return;
    }

    const keys = t.VISITOR_KEYS[node.type] ?? [];
    for (const key of keys) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in item) {
            visit(item as t.Node);
            if (found) return;
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        visit(value as t.Node);
        if (found) return;
      }
    }
  };

  visit(fn.body as t.Node);
  return found;
}

function isTranslationFactoryCall(
  init: t.Expression | null | undefined,
  localName: string,
): init is t.CallExpression {
  return (
    init?.type === "CallExpression" &&
    init.callee.type === "Identifier" &&
    (init.callee.name === localName ||
      init.callee.name === "useTranslations" ||
      init.callee.name === "getTranslations")
  );
}

function isAwaitedGetTranslationsCall(
  init: t.Expression | null | undefined,
  localName: string,
): init is t.AwaitExpression & {
  argument: t.CallExpression & { callee: t.Identifier };
} {
  return (
    init?.type === "AwaitExpression" &&
    init.argument.type === "CallExpression" &&
    init.argument.callee.type === "Identifier" &&
    (init.argument.callee.name === localName ||
      init.argument.callee.name === "getTranslations")
  );
}

function isGetTranslationsCall(
  init: t.Expression | null | undefined,
  localName: string,
): init is t.CallExpression & { callee: t.Identifier } {
  return (
    init?.type === "CallExpression" &&
    init.callee.type === "Identifier" &&
    (init.callee.name === localName || init.callee.name === "getTranslations")
  );
}

function collectConditionalKeys(
  node: t.Expression,
  textToKey: Record<string, string>,
): string[] {
  const keys: string[] = [];
  if (node.type === "ConditionalExpression") {
    keys.push(
      ...collectConditionalKeys(node.consequent as t.Expression, textToKey),
    );
    keys.push(
      ...collectConditionalKeys(node.alternate as t.Expression, textToKey),
    );
  } else if (node.type === "StringLiteral") {
    const text = node.value.trim();
    if (text && text in textToKey) keys.push(textToKey[text]);
  } else if (node.type === "TemplateLiteral") {
    const info = buildTemplateLiteralText(node.quasis, node.expressions);
    if (info && info.text in textToKey) keys.push(textToKey[info.text]);
  }
  return keys;
}

function transformConditionalBranch(
  node: t.Expression,
  textToKey: Record<string, string>,
): { node: t.Expression; count: number } {
  if (node.type === "ConditionalExpression") {
    const cons = transformConditionalBranch(
      node.consequent as t.Expression,
      textToKey,
    );
    const alt = transformConditionalBranch(
      node.alternate as t.Expression,
      textToKey,
    );
    if (cons.count > 0 || alt.count > 0) {
      return {
        node: t.conditionalExpression(node.test, cons.node, alt.node),
        count: cons.count + alt.count,
      };
    }
    return { node, count: 0 };
  }

  if (node.type === "StringLiteral") {
    const text = node.value.trim();
    if (text && text in textToKey) {
      const key = textToKey[text];
      return {
        node: markGeneratedCall(
          t.callExpression(t.identifier("t"), [t.stringLiteral(key)]),
        ),
        count: 1,
      };
    }
    return { node, count: 0 };
  }

  if (node.type === "TemplateLiteral") {
    const info = buildTemplateLiteralText(node.quasis, node.expressions);
    if (info && info.text in textToKey) {
      const key = textToKey[info.text];
      const args: t.Expression[] = [t.stringLiteral(key)];
      if (info.placeholders.length > 0) {
        args.push(buildValuesObject(node.expressions, info.placeholders));
      }
      return {
        node: markGeneratedCall(t.callExpression(t.identifier("t"), args)),
        count: 1,
      };
    }
    return { node, count: 0 };
  }

  return { node, count: 0 };
}

function transformConditionalBranchInline(
  node: t.Expression,
  textToKey: Record<string, string>,
): { node: t.Expression; count: number } {
  if (node.type === "ConditionalExpression") {
    const cons = transformConditionalBranchInline(
      node.consequent as t.Expression,
      textToKey,
    );
    const alt = transformConditionalBranchInline(
      node.alternate as t.Expression,
      textToKey,
    );
    if (cons.count > 0 || alt.count > 0) {
      return {
        node: t.conditionalExpression(node.test, cons.node, alt.node),
        count: cons.count + alt.count,
      };
    }
    return { node, count: 0 };
  }

  if (node.type === "StringLiteral") {
    const text = node.value.trim();
    if (text && text in textToKey) {
      const key = textToKey[text];
      return {
        node: markGeneratedCall(
          t.callExpression(t.identifier("t"), [
            t.stringLiteral(text),
            t.stringLiteral(key),
          ]),
        ),
        count: 1,
      };
    }
    return { node, count: 0 };
  }

  if (node.type === "TemplateLiteral") {
    const info = buildTemplateLiteralText(node.quasis, node.expressions);
    if (info && info.text in textToKey) {
      const key = textToKey[info.text];
      const args: t.Expression[] = [
        t.stringLiteral(info.text),
        t.stringLiteral(key),
      ];
      if (info.placeholders.length > 0) {
        args.push(buildValuesObject(node.expressions, info.placeholders));
      }
      return {
        node: markGeneratedCall(t.callExpression(t.identifier("t"), args)),
        count: 1,
      };
    }
    return { node, count: 0 };
  }

  return { node, count: 0 };
}

/**
 * Pre-scan AST to find which React components reference any of the given
 * imported factory names.  Returns a set of component names that will need
 * a translator injected.  This runs BEFORE the main injection phase so we
 * can include those components proactively.
 */
function preDiscoverFactoryRefComponents(
  ast: File,
  importedNames: string[],
): Set<string> {
  if (importedNames.length === 0) return new Set();
  const nameSet = new Set(importedNames);
  const comps = new Set<string>();

  traverse(ast, {
    Identifier(path: NodePath<t.Identifier>) {
      if (!nameSet.has(path.node.name)) return;
      const parent = path.parent;
      // Skip import/export specifiers
      if (
        parent.type === "ImportSpecifier" ||
        parent.type === "ImportDefaultSpecifier" ||
        parent.type === "ImportNamespaceSpecifier" ||
        parent.type === "ExportSpecifier"
      ) return;
      // Skip declaration id
      if (parent.type === "VariableDeclarator" && (parent as t.VariableDeclarator).id === path.node) return;
      // Skip already-callee (idempotent)
      if (parent.type === "CallExpression" && (parent as t.CallExpression).callee === path.node) return;
      // Verify binding comes from module-level (import or top-level const)
      const binding = path.scope?.getBinding(path.node.name);
      if (binding) {
        const bPath = binding.path;
        const isImportBinding = bPath.isImportSpecifier() || bPath.isImportDefaultSpecifier();
        const isTopLevelConst =
          bPath.isVariableDeclarator() &&
          bPath.parentPath?.isVariableDeclaration() &&
          (bPath.parentPath.parentPath?.isProgram() ||
            bPath.parentPath.parentPath?.isExportNamedDeclaration());
        if (!isImportBinding && !isTopLevelConst) return;
      }
      // Must be inside a PascalCase function (React component)
      if (!isInsideFunction(path)) return;
      const comp = getComponentName(path);
      if (comp && isPascalCase(comp)) comps.add(comp);
    },
  });

  return comps;
}

function wrapModuleFactoryDeclarations(
  ast: File,
  constNames: string[],
): boolean {
  if (constNames.length === 0) return false;
  const nameSet = new Set(constNames);
  let wrapped = false;

  for (const node of ast.program.body) {
    let decl: t.VariableDeclaration | undefined;
    if (node.type === "VariableDeclaration") {
      decl = node;
    } else if (
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "VariableDeclaration"
    ) {
      decl = node.declaration;
    }
    if (!decl || decl.kind !== "const") continue;

    for (const declarator of decl.declarations) {
      if (declarator.id.type !== "Identifier") continue;
      if (!nameSet.has(declarator.id.name)) continue;
      if (!declarator.init) continue;

      // Move type annotation to arrow function return type (preserves type safety)
      const typeAnnotation = (declarator.id as any).typeAnnotation;
      if (typeAnnotation) {
        (declarator.id as any).typeAnnotation = null;
      }

      // Idempotency: if init is already an arrow with 1 param named `t`, skip
      if (
        declarator.init.type === "ArrowFunctionExpression" &&
        declarator.init.params.length === 1 &&
        declarator.init.params[0].type === "Identifier" &&
        declarator.init.params[0].name === "t"
      ) {
        continue;
      }

      // Wrap: const FOO = expr → const FOO = (t: any) => (expr)
      const originalInit = declarator.init;
      const tParam = t.identifier("t");
      (tParam as any).typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
      const arrowFn = t.arrowFunctionExpression(
        [tParam],
        t.parenthesizedExpression(originalInit),
      );
      if (typeAnnotation) {
        (arrowFn as any).returnType = typeAnnotation;
      }
      declarator.init = arrowFn;
      wrapped = true;
    }
  }
  return wrapped;
}

function isInsideFunctionParam(path: NodePath): boolean {
  let current: NodePath | null = path;
  while (current.parentPath) {
    if (current.parentPath.isFunction()) {
      const fn = current.parentPath.node as t.Function;
      return fn.params.includes(current.node as any);
    }
    current = current.parentPath;
  }
  return false;
}

function rewriteModuleFactoryReferences(
  ast: File,
  importedNames: string[],
  componentTranslatorIds: Map<string, string>,
): { componentsNeedingT: Set<string>; rewrote: boolean } {
  if (importedNames.length === 0) return { componentsNeedingT: new Set(), rewrote: false };
  const nameSet = new Set(importedNames);
  const componentsNeedingT = new Set<string>();
  let rewrote = false;

  // Collect rewrite targets first, then apply — avoids AST mutation issues
  // during traversal (e.g. shorthand ObjectProperty key/value sharing).
  const rewrites: Array<{
    path: NodePath<t.Identifier>;
    translatorId: string;
    compName: string;
    shorthandProp?: t.ObjectProperty;
  }> = [];

  traverse(ast, {
    Identifier(path: NodePath<t.Identifier>) {
      if (!nameSet.has(path.node.name)) return;

      const parent = path.parent;
      // Skip import/export specifiers
      if (
        parent.type === "ImportSpecifier" ||
        parent.type === "ImportDefaultSpecifier" ||
        parent.type === "ImportNamespaceSpecifier" ||
        parent.type === "ExportSpecifier"
      ) {
        return;
      }

      // Skip type contexts (TSTypeReference, TSTypeQuery, TSQualifiedName, etc.)
      if (
        parent.type.startsWith("TS") &&
        parent.type !== "TSNonNullExpression" &&
        parent.type !== "TSAsExpression" &&
        parent.type !== "TSSatisfiesExpression"
      ) {
        return;
      }

      // Idempotency: skip if already callee of CallExpression
      if (
        parent.type === "CallExpression" &&
        (parent as t.CallExpression).callee === path.node
      ) {
        return;
      }

      // For shorthand ObjectProperty, key and value reference the same node.
      // Only handle it once — when visiting as "value" position.
      if (
        parent.type === "ObjectProperty" &&
        (parent as t.ObjectProperty).key === path.node
      ) {
        if ((parent as t.ObjectProperty).shorthand) {
          // Will be handled as a shorthand rewrite — but only from value position.
          // Skip the key position visit to avoid double processing.
          if (path.key === "key") return;
        } else {
          // Non-shorthand key: never rewrite
          return;
        }
      }

      // Verify this Identifier refers to the module-level binding (import or
      // top-level const), not a shadowed local variable or destructuring param.
      const binding = path.scope?.getBinding(path.node.name);
      if (binding) {
        const bPath = binding.path;
        const isImportBinding = bPath.isImportSpecifier() || bPath.isImportDefaultSpecifier();
        const isTopLevelConst =
          bPath.isVariableDeclarator() &&
          bPath.parentPath?.isVariableDeclaration() &&
          (bPath.parentPath.parentPath?.isProgram() ||
            bPath.parentPath.parentPath?.isExportNamedDeclaration());
        if (!isImportBinding && !isTopLevelConst) return;
      }

      // Skip refs inside function parameter defaults (t is not in scope there)
      if (isInsideFunctionParam(path)) return;

      // Must be inside a PascalCase function (React component)
      if (!isInsideFunction(path)) return;
      const compName = getComponentName(path);
      if (!compName || !isPascalCase(compName)) return;

      const translatorId = componentTranslatorIds.get(compName) ?? "t";

      if (
        parent.type === "ObjectProperty" &&
        (parent as t.ObjectProperty).shorthand
      ) {
        rewrites.push({ path, translatorId, compName, shorthandProp: parent as t.ObjectProperty });
      } else {
        rewrites.push({ path, translatorId, compName });
      }
    },
  });

  // Apply collected rewrites
  for (const { path, translatorId, compName, shorthandProp } of rewrites) {
    const callExpr = t.callExpression(
      t.identifier(path.node.name),
      [t.identifier(translatorId)],
    );

    if (shorthandProp) {
      shorthandProp.shorthand = false;
      shorthandProp.value = callExpr;
    } else {
      path.replaceWith(callExpr);
    }

    componentsNeedingT.add(compName);
    rewrote = true;
  }

  return { componentsNeedingT, rewrote };
}

export function transform(
  ast: File,
  textToKey: Record<string, string>,
  options: TransformOptions = {},
): TransformResult {
  if (options.mode === "inline") {
    return transformInline(ast, textToKey, options);
  }

  const importSource = options.i18nImport ?? "next-intl";
  const supportsServerSplit = importSource === "next-intl";
  const isClient =
    !supportsServerSplit || options.forceClient || detectClientFile(ast);
  const needsClientDirective =
    isClient && options.forceClient === true && !detectClientFile(ast);
  let stringsWrapped = 0;
  const componentsNeedingT = new Set<string>();
  const componentKeys = new Map<string, Set<string>>();
  const allUsedKeys: string[] = [];

  function trackKey(path: NodePath, key: string): void {
    allUsedKeys.push(key);
    const compName = getComponentName(path);
    if (compName) {
      componentsNeedingT.add(compName);
      let keys = componentKeys.get(compName);
      if (!keys) {
        keys = new Set();
        componentKeys.set(compName, keys);
      }
      keys.add(key);
    }
  }

  traverse(ast, {
    JSXText(path: NodePath<t.JSXText>) {
      if (isInsideClass(path)) return;
      const text = path.node.value.trim();
      if (!text || !(text in textToKey)) return;

      const compName = getComponentName(path);
      if (!compName || !isPascalCase(compName)) return;

      const parent = path.parentPath;
      if (!parent?.isJSXElement()) return;

      const key = textToKey[text];
      const tCall = t.jsxExpressionContainer(
        markGeneratedCall(
          t.callExpression(t.identifier("t"), [t.stringLiteral(key)]),
        ),
      );

      if (!hasSubstantialSiblings(parent)) {
        path.replaceWith(tCall);
      } else {
        const raw = path.node.value;
        const hasLeading = raw !== raw.trimStart();
        const hasTrailing = raw !== raw.trimEnd();
        const nodes: t.Node[] = [];
        if (hasLeading) {
          nodes.push(t.jsxExpressionContainer(t.stringLiteral(" ")));
        }
        nodes.push(tCall);
        if (hasTrailing) {
          nodes.push(t.jsxExpressionContainer(t.stringLiteral(" ")));
        }
        path.replaceWithMultiple(nodes);
      }

      stringsWrapped++;
      trackKey(path, key);
    },

    JSXExpressionContainer(path: NodePath<t.JSXExpressionContainer>) {
      if (isInsideClass(path)) return;
      const expr = path.node.expression;
      if (path.parent.type === "JSXAttribute") return;

      const compName = getComponentName(path);
      if (!compName || !isPascalCase(compName)) return;

      if (expr.type === "ConditionalExpression") {
        const result = transformConditionalBranch(expr, textToKey);
        if (result.count > 0) {
          path.node.expression = result.node;
          stringsWrapped += result.count;
          // Collect keys from conditional branches
          collectConditionalKeys(expr, textToKey).forEach((k) =>
            trackKey(path, k),
          );
        }
        return;
      }

      if (expr.type !== "TemplateLiteral") return;

      const info = buildTemplateLiteralText(expr.quasis, expr.expressions);
      if (!info) return;

      const { text, placeholders } = info;
      if (!(text in textToKey)) return;

      const key = textToKey[text];
      const args: t.Expression[] = [t.stringLiteral(key)];
      if (placeholders.length > 0) {
        args.push(buildValuesObject(expr.expressions, placeholders));
      }
      path.node.expression = markGeneratedCall(
        t.callExpression(t.identifier("t"), args),
      );
      stringsWrapped++;
      trackKey(path, key);
    },

    JSXAttribute(path: NodePath<t.JSXAttribute>) {
      if (isInsideClass(path)) return;
      const value = path.node.value;
      if (!value) return;

      // Only wrap translatable props (placeholder, title, alt, aria-label, etc.)
      const attrName = path.node.name;
      const propName =
        attrName.type === "JSXIdentifier"
          ? attrName.name
          : attrName.name.name;
      if (!isTranslatableProp(propName, options.translatableProps)) return;

      const compName = getComponentName(path);
      if (!compName || !isPascalCase(compName)) return;

      if (
        value.type === "JSXExpressionContainer" &&
        value.expression.type === "ConditionalExpression"
      ) {
        const result = transformConditionalBranch(value.expression, textToKey);
        if (result.count > 0) {
          path.node.value = t.jsxExpressionContainer(result.node);
          stringsWrapped += result.count;
          collectConditionalKeys(value.expression, textToKey).forEach((k) =>
            trackKey(path, k),
          );
        }
        return;
      }

      let text: string | undefined;
      let templateInfo:
        | {
            placeholders: string[];
            expressions: t.TemplateLiteral["expressions"];
          }
        | undefined;

      if (value.type === "StringLiteral") {
        text = value.value;
      } else if (value.type === "JSXExpressionContainer") {
        if (value.expression.type === "StringLiteral") {
          text = value.expression.value;
        } else if (value.expression.type === "TemplateLiteral") {
          const info = buildTemplateLiteralText(
            value.expression.quasis,
            value.expression.expressions,
          );
          if (info) {
            text = info.text;
            templateInfo = {
              placeholders: info.placeholders,
              expressions: value.expression.expressions,
            };
          }
        }
      }

      if (!text || !(text in textToKey)) return;

      if (
        value.type === "JSXExpressionContainer" &&
        value.expression.type === "CallExpression" &&
        value.expression.callee.type === "Identifier" &&
        value.expression.callee.name === "t"
      ) {
        return;
      }

      const key = textToKey[text];
      const args: t.Expression[] = [t.stringLiteral(key)];
      if (templateInfo && templateInfo.placeholders.length > 0) {
        args.push(
          buildValuesObject(
            templateInfo.expressions,
            templateInfo.placeholders,
          ),
        );
      }
      path.node.value = t.jsxExpressionContainer(
        markGeneratedCall(t.callExpression(t.identifier("t"), args)),
      );
      stringsWrapped++;
      trackKey(path, key);
    },

    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      if (isInsideClass(path)) return;

      const factoryConstNames = options.moduleFactoryConstNames ?? [];
      const inFunction = isInsideFunction(path);

      if (!inFunction) {
        // Module-factory path: only if inside a const from the plan
        const constName = getTopLevelConstName(path as unknown as NodePath<t.Node>);
        if (!constName || !factoryConstNames.includes(constName)) return;

        const keyNode = path.node.key;
        if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
          return;
        const propName =
          keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
        if (!isContentProperty(propName)) return;

        const valueNode = path.node.value;

        if (valueNode.type === "ConditionalExpression") {
          const result = transformConditionalBranch(valueNode, textToKey);
          if (result.count > 0) {
            path.node.value = result.node;
            stringsWrapped += result.count;
            collectConditionalKeys(valueNode, textToKey).forEach((k) =>
              allUsedKeys.push(k),
            );
          }
          return;
        }

        let text: string | undefined;
        let templateInfo:
          | {
              placeholders: string[];
              expressions: t.TemplateLiteral["expressions"];
            }
          | undefined;

        if (valueNode.type === "StringLiteral") {
          text = valueNode.value;
        } else if (valueNode.type === "TemplateLiteral") {
          const info = buildTemplateLiteralText(
            valueNode.quasis,
            valueNode.expressions,
          );
          if (info) {
            text = info.text;
            templateInfo = {
              placeholders: info.placeholders,
              expressions: valueNode.expressions,
            };
          }
        }

        if (!text || !(text in textToKey)) return;

        const key = textToKey[text];
        const args: t.Expression[] = [t.stringLiteral(key)];
        if (templateInfo && templateInfo.placeholders.length > 0) {
          args.push(
            buildValuesObject(
              templateInfo.expressions,
              templateInfo.placeholders,
            ),
          );
        }
        path.node.value = markGeneratedCall(
          t.callExpression(t.identifier("t"), args),
        );
        stringsWrapped++;
        allUsedKeys.push(key);
        return;
      }

      // Existing function-scoped logic
      const ownerFn = getNearestFunctionPath(
        path as unknown as NodePath<t.Node>,
      );
      if (!ownerFn) return;
      if (!functionContainsJSX(ownerFn.node)) return;
      const compName = getComponentName(ownerFn as unknown as NodePath<t.Node>);
      if (!compName) return;

      const keyNode = path.node.key;
      if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
        return;
      const propName =
        keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
      if (!isContentProperty(propName)) return;

      const valueNode = path.node.value;

      if (valueNode.type === "ConditionalExpression") {
        const result = transformConditionalBranch(valueNode, textToKey);
        if (result.count > 0) {
          path.node.value = result.node;
          stringsWrapped += result.count;
          collectConditionalKeys(valueNode, textToKey).forEach((k) =>
            trackKey(path, k),
          );
        }
        return;
      }

      let text: string | undefined;
      let templateInfo:
        | {
            placeholders: string[];
            expressions: t.TemplateLiteral["expressions"];
          }
        | undefined;

      if (valueNode.type === "StringLiteral") {
        text = valueNode.value;
      } else if (valueNode.type === "TemplateLiteral") {
        const info = buildTemplateLiteralText(
          valueNode.quasis,
          valueNode.expressions,
        );
        if (info) {
          text = info.text;
          templateInfo = {
            placeholders: info.placeholders,
            expressions: valueNode.expressions,
          };
        }
      }

      if (!text || !(text in textToKey)) return;

      const key = textToKey[text];
      const args: t.Expression[] = [t.stringLiteral(key)];
      if (templateInfo && templateInfo.placeholders.length > 0) {
        args.push(
          buildValuesObject(
            templateInfo.expressions,
            templateInfo.placeholders,
          ),
        );
      }
      path.node.value = markGeneratedCall(
        t.callExpression(t.identifier("t"), args),
      );
      stringsWrapped++;
      trackKey(path, key);
    },
  });

  const hasModuleFactoryWork =
    (options.moduleFactoryConstNames?.length ?? 0) > 0 ||
    (options.moduleFactoryImportedNames?.length ?? 0) > 0;

  if (stringsWrapped === 0 && !hasModuleFactoryWork) {
    return {
      code: generate(ast).code,
      stringsWrapped: 0,
      modified: false,
      usedKeys: [],
    };
  }

  // Pre-scan: discover which components will need `t` due to factory imports,
  // so the injection phase can handle them proactively.
  const moduleFactoryImportedNames = options.moduleFactoryImportedNames ?? [];
  const factoryRefComponents = preDiscoverFactoryRefComponents(ast, moduleFactoryImportedNames);
  for (const comp of factoryRefComponents) {
    componentsNeedingT.add(comp);
  }

  // Compute namespace per component.
  // Components that reference factory imports must NOT be namespaced, because
  // the factory functions use full keys (e.g. "footer.about") and a namespaced
  // translator would mangle them.
  const componentNamespaces = new Map<string, string | null>();
  for (const [comp, keys] of componentKeys) {
    if (factoryRefComponents.has(comp)) {
      componentNamespaces.set(comp, null);
    } else {
      componentNamespaces.set(comp, detectNamespace([...keys]));
    }
  }
  // Ensure factory-only components (no own keys) still get into the map
  for (const comp of factoryRefComponents) {
    if (!componentNamespaces.has(comp)) {
      componentNamespaces.set(comp, null);
    }
  }

  const namespacedComponents = new Set<string>();
  const componentTranslatorIds = new Map<string, string>();

  if (isClient) {
    const useTranslationsLocal = componentsNeedingT.size > 0
      ? ensureNamedImportLocal(ast, importSource, "useTranslations")
      : "useTranslations";

    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const name = getComponentName(path as unknown as NodePath<t.Node>);
        if (!name || !componentsNeedingT.has(name)) return;
        const ns = componentNamespaces.get(name) ?? undefined;
        const injected = injectTDeclaration(path, ns, useTranslationsLocal);
        if (!injected) return;
        componentTranslatorIds.set(name, injected.translatorId);
        if (injected.namespaced) namespacedComponents.add(name);
      },
      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        if (path.node.id.type !== "Identifier") return;
        const name = path.node.id.name;
        if (!componentsNeedingT.has(name)) return;

        const init = path.node.init;
        if (!init) return;

        if (
          init.type === "ArrowFunctionExpression" ||
          init.type === "FunctionExpression"
        ) {
          const block = ensureBlockBody(init);
          const ns = componentNamespaces.get(name) ?? undefined;
          const injected = injectTIntoBlock(
            block,
            useTranslationsLocal,
            ns,
            name,
            init,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
          return;
        }

        if (init.type === "CallExpression") {
          const wrappedFn = findWrappedFunctionInCall(init);
          if (!wrappedFn) return;
          const block = ensureBlockBody(wrappedFn);
          const ns = componentNamespaces.get(name) ?? undefined;
          const injected = injectTIntoBlock(
            block,
            useTranslationsLocal,
            ns,
            name,
            wrappedFn,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
        }
      },
      ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
        const name = "__default__";
        if (!componentsNeedingT.has(name)) return;
        const decl = path.node.declaration;
        const ns = componentNamespaces.get(name) ?? undefined;

        if (decl.type === "FunctionDeclaration") {
          const injected = injectTIntoBlock(
            decl.body,
            useTranslationsLocal,
            ns,
            name,
            decl,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
          return;
        }

        if (
          decl.type === "FunctionExpression" ||
          decl.type === "ArrowFunctionExpression"
        ) {
          const block = ensureBlockBody(decl);
          const injected = injectTIntoBlock(
            block,
            useTranslationsLocal,
            ns,
            name,
            decl,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
          return;
        }

        if (decl.type === "CallExpression") {
          const wrappedFn = findWrappedFunctionInCall(decl);
          if (!wrappedFn) return;
          const block = ensureBlockBody(wrappedFn);
          const injected = injectTIntoBlock(
            block,
            useTranslationsLocal,
            ns,
            name,
            wrappedFn,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
        }
      },
      noScope: true,
    });
  } else {
    const serverSource = `${importSource}/server`;
    const getTranslationsLocal = componentsNeedingT.size > 0
      ? ensureNamedImportLocal(ast, serverSource, "getTranslations")
      : "getTranslations";

    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const name = getComponentName(path as unknown as NodePath<t.Node>);
        if (!name || !componentsNeedingT.has(name)) return;
        path.node.async = true;
        const ns = componentNamespaces.get(name) ?? undefined;
        const injected = injectAsyncTIntoBlock(
          path.node.body,
          getTranslationsLocal,
          ns,
          name,
          path.node,
        );
        componentTranslatorIds.set(name, injected.translatorId);
        if (injected.namespaced) namespacedComponents.add(name);
      },
      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        if (path.node.id.type !== "Identifier") return;
        const name = path.node.id.name;
        if (!componentsNeedingT.has(name)) return;

        const init = path.node.init;
        if (!init) return;

        if (
          init.type === "ArrowFunctionExpression" ||
          init.type === "FunctionExpression"
        ) {
          const block = ensureBlockBody(init);
          init.async = true;
          const ns = componentNamespaces.get(name) ?? undefined;
          const injected = injectAsyncTIntoBlock(
            block,
            getTranslationsLocal,
            ns,
            name,
            init,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
          return;
        }

        if (init.type === "CallExpression") {
          const wrappedFn = findWrappedFunctionInCall(init);
          if (!wrappedFn) return;
          const block = ensureBlockBody(wrappedFn);
          wrappedFn.async = true;
          const ns = componentNamespaces.get(name) ?? undefined;
          const injected = injectAsyncTIntoBlock(
            block,
            getTranslationsLocal,
            ns,
            name,
            wrappedFn,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
        }
      },
      ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
        const name = "__default__";
        if (!componentsNeedingT.has(name)) return;
        const decl = path.node.declaration;
        const ns = componentNamespaces.get(name) ?? undefined;

        if (decl.type === "FunctionDeclaration") {
          decl.async = true;
          const injected = injectAsyncTIntoBlock(
            decl.body,
            getTranslationsLocal,
            ns,
            name,
            decl,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
          return;
        }

        if (
          decl.type === "FunctionExpression" ||
          decl.type === "ArrowFunctionExpression"
        ) {
          const block = ensureBlockBody(decl);
          decl.async = true;
          const injected = injectAsyncTIntoBlock(
            block,
            getTranslationsLocal,
            ns,
            name,
            decl,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
          return;
        }

        if (decl.type === "CallExpression") {
          const wrappedFn = findWrappedFunctionInCall(decl);
          if (!wrappedFn) return;
          const block = ensureBlockBody(wrappedFn);
          wrappedFn.async = true;
          const injected = injectAsyncTIntoBlock(
            block,
            getTranslationsLocal,
            ns,
            name,
            wrappedFn,
          );
          componentTranslatorIds.set(name, injected.translatorId);
          if (injected.namespaced) namespacedComponents.add(name);
        }
      },
      noScope: true,
    });
  }

  // Module factory: wrap const declarations as arrow factories
  const moduleFactoryConstNames = options.moduleFactoryConstNames ?? [];
  const didWrapFactory = wrapModuleFactoryDeclarations(ast, moduleFactoryConstNames);

  // Rewrite keys to strip namespace prefix only for components where namespace was established
  const effectiveNamespaces = new Map<string, string | null>();
  for (const [comp, ns] of componentNamespaces) {
    effectiveNamespaces.set(comp, namespacedComponents.has(comp) ? ns : null);
  }
  rewriteKeysForNamespaces(ast, effectiveNamespaces);
  rewriteGeneratedCallsForTranslator(ast, componentTranslatorIds);

  // Module factory: rewrite references to imported factory consts AFTER translator IDs are known
  const { componentsNeedingT: factoryComponentsNeedingT, rewrote: didRewriteRefs } = rewriteModuleFactoryReferences(
    ast,
    moduleFactoryImportedNames,
    componentTranslatorIds,
  );
  // Merge factory components into the main set
  for (const comp of factoryComponentsNeedingT) {
    componentsNeedingT.add(comp);
  }

  if (needsClientDirective && componentsNeedingT.size > 0) {
    addUseClientDirective(ast);
  }

  const didModify = stringsWrapped > 0 || didWrapFactory || didRewriteRefs;
  const output = generate(ast, { retainLines: false });
  return {
    code: output.code,
    stringsWrapped,
    modified: didModify,
    usedKeys: allUsedKeys,
  };
}

interface InjectionResult {
  namespaced: boolean;
  translatorId: string;
}

function injectTDeclaration(
  path: NodePath<t.FunctionDeclaration>,
  namespace?: string,
  useTranslationsLocal: string = "useTranslations",
): InjectionResult | null {
  const body = path.node.body;
  if (body.type !== "BlockStatement") return null;
  return injectTIntoBlock(
    body,
    useTranslationsLocal,
    namespace,
    path.node.id?.name,
    path.node,
  );
}

function updateCallNamespace(
  call: t.CallExpression,
  namespace: string | undefined,
): boolean {
  const currentArg = call.arguments[0];
  if (!namespace) {
    // Mixed namespace or unresolved namespace case: clear stale static namespaces
    // from previous runs, but preserve dynamic arguments.
    if (currentArg && currentArg.type === "StringLiteral") {
      call.arguments = [];
    }
    return false;
  }
  if (
    currentArg &&
    currentArg.type === "StringLiteral" &&
    currentArg.value === namespace
  ) {
    return true; // Already correct
  }
  // Only overwrite if argument is missing or is a string literal (safe to update).
  // Non-string arguments (variables, expressions) are left untouched to avoid
  // silently breaking dynamic namespace usage.
  if (!currentArg || currentArg.type === "StringLiteral") {
    call.arguments = [t.stringLiteral(namespace)];
    return true;
  }
  return false; // Dynamic argument — don't strip keys since runtime namespace is unknown
}

function injectTIntoBlock(
  block: t.BlockStatement,
  useTranslationsLocal: string,
  namespace?: string,
  componentName?: string,
  ownerFn?: t.Function,
): InjectionResult {
  let sawConflictingT = false;

  for (const stmt of block.body) {
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of stmt.declarations) {
      if (d.id.type !== "Identifier") continue;

      // const <id> = useTranslations(...) or const <id> = getTranslations(...)
      if (isTranslationFactoryCall(d.init, useTranslationsLocal)) {
        return {
          namespaced: updateCallNamespace(
            d.init as t.CallExpression,
            namespace,
          ),
          translatorId: d.id.name,
        };
      }

      // const <id> = await getTranslations(...)
      if (isAwaitedGetTranslationsCall(d.init, useTranslationsLocal)) {
        return {
          namespaced: updateCallNamespace(d.init.argument, namespace),
          translatorId: d.id.name,
        };
      }

      if (d.id.name === "t") sawConflictingT = true;
    }
  }

  const translatorId = pickTranslatorId(block, ownerFn);
  if (sawConflictingT && translatorId !== "t") {
    logWarning(
      componentName
        ? `Component "${componentName}" has "const t = ..." that is not useTranslations/getTranslations.\n  Injected fallback translator "${translatorId}" to avoid conflicts.`
        : `Detected "const t = ..." conflict. Injected fallback translator "${translatorId}".`,
    );
  }

  const args: t.Expression[] = namespace ? [t.stringLiteral(namespace)] : [];
  const tDecl = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier(translatorId),
      t.callExpression(t.identifier(useTranslationsLocal), args),
    ),
  ]);

  block.body.unshift(tDecl);
  return { namespaced: !!namespace, translatorId };
}

function injectAsyncTIntoBlock(
  block: t.BlockStatement,
  getTranslationsLocal: string,
  namespace?: string,
  componentName?: string,
  ownerFn?: t.Function,
): InjectionResult {
  let sawConflictingT = false;

  for (const stmt of block.body) {
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of stmt.declarations) {
      if (d.id.type !== "Identifier") continue;

      // const <id> = await getTranslations(...)
      if (isAwaitedGetTranslationsCall(d.init, getTranslationsLocal)) {
        return {
          namespaced: updateCallNamespace(d.init.argument, namespace),
          translatorId: d.id.name,
        };
      }

      // const <id> = getTranslations(...)
      if (isGetTranslationsCall(d.init, getTranslationsLocal)) {
        return {
          namespaced: updateCallNamespace(
            d.init as t.CallExpression,
            namespace,
          ),
          translatorId: d.id.name,
        };
      }

      if (d.id.name === "t") sawConflictingT = true;
    }
  }

  const translatorId = pickTranslatorId(block, ownerFn);
  if (sawConflictingT && translatorId !== "t") {
    logWarning(
      componentName
        ? `Component "${componentName}" has "const t = ..." that is not useTranslations/getTranslations.\n  Injected fallback translator "${translatorId}" to avoid conflicts.`
        : `Detected "const t = ..." conflict. Injected fallback translator "${translatorId}".`,
    );
  }

  const args: t.Expression[] = namespace ? [t.stringLiteral(namespace)] : [];
  const tDecl = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier(translatorId),
      t.awaitExpression(
        t.callExpression(t.identifier(getTranslationsLocal), args),
      ),
    ),
  ]);

  block.body.unshift(tDecl);
  return { namespaced: !!namespace, translatorId };
}

function rewriteKeysForNamespaces(
  ast: File,
  componentNamespaces: Map<string, string | null>,
): void {
  // Collect component names that actually have a namespace
  const nsComponents = new Map<string, string>();
  for (const [comp, ns] of componentNamespaces) {
    if (ns) nsComponents.set(comp, ns);
  }
  if (nsComponents.size === 0) return;

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      if (!isGeneratedCall(path.node)) return;
      if (
        path.node.callee.type !== "Identifier" ||
        path.node.callee.name !== "t"
      )
        return;
      if (path.node.arguments.length === 0) return;
      const firstArg = path.node.arguments[0];
      if (firstArg.type !== "StringLiteral") return;

      const compName = getComponentName(path);
      if (!compName) return;
      const ns = nsComponents.get(compName);
      if (!ns) return;

      const stripped = stripNamespace(firstArg.value, ns);
      if (stripped !== firstArg.value) {
        firstArg.value = stripped;
      }
    },
    noScope: true,
  });
}

function rewriteGeneratedCallsForTranslator(
  ast: File,
  translatorByComponent: Map<string, string>,
): void {
  if (translatorByComponent.size === 0) return;

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      if (!isGeneratedCall(path.node)) return;
      if (
        path.node.callee.type !== "Identifier" ||
        path.node.callee.name !== "t"
      ) {
        return;
      }
      const compName = getComponentName(path);
      if (!compName) return;
      const translatorId = translatorByComponent.get(compName);
      if (!translatorId || translatorId === "t") return;
      path.node.callee = t.identifier(translatorId);
    },
    noScope: true,
  });
}

export function detectClientFile(ast: File): boolean {
  if (ast.program.directives) {
    for (const directive of ast.program.directives) {
      if (directive.value?.value === "use client") {
        return true;
      }
    }
  }

  // Detect files that use React hooks (use*() calls) — these are effectively
  // client components even without an explicit "use client" directive, since
  // they must be rendered inside a client component boundary.
  let usesHooks = false;
  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      if (usesHooks) return;
      const callee = path.node.callee;

      // useState(), useQuery(), usePathname(), etc. imported from any module.
      if (callee.type === "Identifier") {
        const binding = path.scope.getBinding(callee.name);
        if (!binding) return;

        if (binding.path.isImportSpecifier()) {
          const imported = binding.path.node.imported;
          if (
            imported.type === "Identifier" &&
            /^use[A-Z]/.test(imported.name) &&
            // Exclude translate-kit's inline mode hook — it is normalised
            // by codegen and should not force client detection.
            imported.name !== "useT"
          ) {
            usesHooks = true;
          }
          return;
        }

        if (
          (binding.path.isImportDefaultSpecifier() ||
            binding.path.isImportNamespaceSpecifier()) &&
          /^use[A-Z]/.test(callee.name) &&
          callee.name !== "useT"
        ) {
          usesHooks = true;
        }

        return;
      }

      // React.useState(), React.useEffect(), etc.
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        callee.property.type === "Identifier" &&
        /^use[A-Z]/.test(callee.property.name)
      ) {
        const binding = path.scope.getBinding(callee.object.name);
        if (
          binding &&
          (binding.path.isImportDefaultSpecifier() ||
            binding.path.isImportNamespaceSpecifier()) &&
          binding.path.parentPath.isImportDeclaration() &&
          binding.path.parentPath.node.source.value === "react"
        ) {
          usesHooks = true;
        }
      }
    },
  });
  return usesHooks;
}

function hasInlineImport(
  ast: File,
  componentPath: string,
): { hasT: boolean; hasHook: boolean } {
  let hasT = false;
  let hasHook = false;
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    const src = node.source.value;
    if (
      src !== componentPath &&
      src !== `${componentPath}-server` &&
      src !== `${componentPath}/t-server`
    )
      continue;
    for (const spec of node.specifiers) {
      if (
        spec.type === "ImportSpecifier" &&
        spec.imported.type === "Identifier"
      ) {
        if (spec.imported.name === "T") hasT = true;
        if (spec.imported.name === "useT" || spec.imported.name === "createT")
          hasHook = true;
      }
    }
  }
  return { hasT, hasHook };
}

function resolveImportedLocalName(
  ast: File,
  sources: Set<string>,
  importedName: string,
): string | null {
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (!sources.has(node.source.value)) continue;
    for (const spec of node.specifiers) {
      if (
        spec.type === "ImportSpecifier" &&
        spec.imported.type === "Identifier" &&
        spec.imported.name === importedName &&
        spec.local.type === "Identifier"
      ) {
        return spec.local.name;
      }
    }
  }
  return null;
}

function normalizeInlineImports(
  ast: File,
  componentPath: string,
  isClient: boolean,
): boolean {
  const validSources = new Set([
    componentPath,
    `${componentPath}-server`,
    `${componentPath}/t-server`,
  ]);
  const desiredSource = isClient ? componentPath : `${componentPath}-server`;
  let changed = false;
  let hookRenamed: { from: string; to: string } | undefined;

  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (!validSources.has(node.source.value)) continue;

    if (node.source.value !== desiredSource) {
      node.source.value = desiredSource;
      changed = true;
    }

    for (const spec of node.specifiers) {
      if (
        spec.type !== "ImportSpecifier" ||
        spec.imported.type !== "Identifier"
      ) {
        continue;
      }

      if (isClient && spec.imported.name === "createT") {
        hookRenamed = { from: "createT", to: "useT" };
        spec.imported = t.identifier("useT");
        if (spec.local.type === "Identifier" && spec.local.name === "createT") {
          spec.local = t.identifier("useT");
        }
        changed = true;
      }

      if (!isClient && spec.imported.name === "useT") {
        hookRenamed = { from: "useT", to: "createT" };
        spec.imported = t.identifier("createT");
        if (spec.local.type === "Identifier" && spec.local.name === "useT") {
          spec.local = t.identifier("createT");
        }
        changed = true;
      }
    }
  }

  // Rename call expressions in function bodies to match the updated import
  if (hookRenamed) {
    const { from, to } = hookRenamed;
    traverse(ast, {
      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        if (
          path.node.id.type === "Identifier" &&
          path.node.id.name === "t" &&
          path.node.init?.type === "CallExpression" &&
          path.node.init.callee.type === "Identifier" &&
          path.node.init.callee.name === from
        ) {
          path.node.init.callee = t.identifier(to);
        }
      },
      noScope: true,
    });
  }

  return changed;
}

function hasUseClientDirective(ast: File): boolean {
  if (ast.program.directives) {
    for (const directive of ast.program.directives) {
      if (directive.value?.value === "use client") return true;
    }
  }
  return false;
}

function addUseClientDirective(ast: File): void {
  // Guard against duplicate directives
  if (hasUseClientDirective(ast)) return;

  if (!ast.program.directives) {
    ast.program.directives = [];
  }
  ast.program.directives.unshift(t.directive(t.directiveLiteral("use client")));
}

function transformInline(
  ast: File,
  textToKey: Record<string, string>,
  options: TransformOptions,
): TransformResult {
  const componentPath = options.componentPath ?? "@/components/t";
  const isClient = options.forceClient || detectClientFile(ast);
  const needsClientDirective =
    options.forceClient === true && !detectClientFile(ast);
  let stringsWrapped = 0;
  const componentsNeedingT = new Set<string>();
  const componentTranslatorIds = new Map<string, string>();
  let needsTComponent = false;
  let repaired = false;
  let boundaryRepaired = false;

  boundaryRepaired = normalizeInlineImports(ast, componentPath, isClient);

  if (!isClient) {
    traverse(ast, {
      CallExpression(path: NodePath<t.CallExpression>) {
        if (
          path.node.callee.type === "Identifier" &&
          path.node.callee.name === "createT" &&
          path.node.arguments.length > 0 &&
          path.node.arguments[0].type === "Identifier"
        ) {
          const argName = (path.node.arguments[0] as t.Identifier).name;
          if (!path.scope.hasBinding(argName)) {
            logWarning(
              `Repaired createT(${argName}) → createT() — "${argName}" was not in scope`,
            );
            path.node.arguments = [];
            repaired = true;
          }
        }
      },
    });
  }

  traverse(ast, {
    JSXText(path: NodePath<t.JSXText>) {
      if (isInsideClass(path)) return;
      const text = path.node.value.trim();
      if (!text || !(text in textToKey)) return;

      const compName = getComponentName(path);
      if (!compName || !isPascalCase(compName)) return;

      const parent = path.parentPath;
      if (!parent?.isJSXElement()) return;

      const parentOpening = parent.node.openingElement;
      if (
        parentOpening.name.type === "JSXIdentifier" &&
        parentOpening.name.name === "T"
      ) {
        return;
      }

      const key = textToKey[text];
      needsTComponent = true;

      const tElement = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier("T"), [
          t.jsxAttribute(t.jsxIdentifier("id"), t.stringLiteral(key)),
        ]),
        t.jsxClosingElement(t.jsxIdentifier("T")),
        [t.jsxText(text)],
        false,
      );

      if (!hasSubstantialSiblings(parent)) {
        path.replaceWith(tElement);
      } else {
        const raw = path.node.value;
        const hasLeading = raw !== raw.trimStart();
        const hasTrailing = raw !== raw.trimEnd();
        const nodes: t.Node[] = [];
        if (hasLeading) {
          nodes.push(t.jsxExpressionContainer(t.stringLiteral(" ")));
        }
        nodes.push(tElement);
        if (hasTrailing) {
          nodes.push(t.jsxExpressionContainer(t.stringLiteral(" ")));
        }
        path.replaceWithMultiple(nodes);
      }

      stringsWrapped++;
    },

    JSXExpressionContainer(path: NodePath<t.JSXExpressionContainer>) {
      if (isInsideClass(path)) return;
      const expr = path.node.expression;
      if (path.parent.type === "JSXAttribute") return;

      const compName = getComponentName(path);
      if (!compName || !isPascalCase(compName)) return;

      if (expr.type === "ConditionalExpression") {
        const result = transformConditionalBranchInline(expr, textToKey);
        if (result.count > 0) {
          path.node.expression = result.node;
          stringsWrapped += result.count;
          componentsNeedingT.add(compName);
        }
        return;
      }

      if (expr.type !== "TemplateLiteral") return;

      const info = buildTemplateLiteralText(expr.quasis, expr.expressions);
      if (!info || !(info.text in textToKey)) return;

      const key = textToKey[info.text];
      const args: t.Expression[] = [
        t.stringLiteral(info.text),
        t.stringLiteral(key),
      ];
      if (info.placeholders.length > 0) {
        args.push(buildValuesObject(expr.expressions, info.placeholders));
      }
      path.node.expression = markGeneratedCall(
        t.callExpression(t.identifier("t"), args),
      );
      stringsWrapped++;
      componentsNeedingT.add(compName);
    },

    JSXAttribute(path: NodePath<t.JSXAttribute>) {
      if (isInsideClass(path)) return;
      const value = path.node.value;
      if (!value) return;

      // Only wrap translatable props (placeholder, title, alt, aria-label, etc.)
      const attrName = path.node.name;
      const propName =
        attrName.type === "JSXIdentifier"
          ? attrName.name
          : attrName.name.name;
      if (!isTranslatableProp(propName, options.translatableProps)) return;

      const compName = getComponentName(path);
      if (!compName || !isPascalCase(compName)) return;

      if (
        value.type === "JSXExpressionContainer" &&
        value.expression.type === "ConditionalExpression"
      ) {
        const result = transformConditionalBranchInline(
          value.expression,
          textToKey,
        );
        if (result.count > 0) {
          path.node.value = t.jsxExpressionContainer(result.node);
          stringsWrapped += result.count;
          componentsNeedingT.add(compName);
        }
        return;
      }

      let text: string | undefined;
      let templateInfo:
        | {
            placeholders: string[];
            expressions: t.TemplateLiteral["expressions"];
          }
        | undefined;

      if (value.type === "StringLiteral") {
        text = value.value;
      } else if (value.type === "JSXExpressionContainer") {
        if (value.expression.type === "StringLiteral") {
          text = value.expression.value;
        } else if (value.expression.type === "TemplateLiteral") {
          const info = buildTemplateLiteralText(
            value.expression.quasis,
            value.expression.expressions,
          );
          if (info) {
            text = info.text;
            templateInfo = {
              placeholders: info.placeholders,
              expressions: value.expression.expressions,
            };
          }
        }
      }

      if (!text || !(text in textToKey)) return;

      if (
        value.type === "JSXExpressionContainer" &&
        value.expression.type === "CallExpression" &&
        value.expression.callee.type === "Identifier" &&
        value.expression.callee.name === "t"
      ) {
        return;
      }

      const key = textToKey[text];
      const args: t.Expression[] = [
        t.stringLiteral(text),
        t.stringLiteral(key),
      ];
      if (templateInfo && templateInfo.placeholders.length > 0) {
        args.push(
          buildValuesObject(
            templateInfo.expressions,
            templateInfo.placeholders,
          ),
        );
      }
      path.node.value = t.jsxExpressionContainer(
        markGeneratedCall(t.callExpression(t.identifier("t"), args)),
      );
      stringsWrapped++;

      componentsNeedingT.add(compName);
    },

    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      if (isInsideClass(path)) return;

      const factoryConstNames = options.moduleFactoryConstNames ?? [];
      const inFunction = isInsideFunction(path);

      if (!inFunction) {
        // Module-factory path for inline mode
        const constName = getTopLevelConstName(path as unknown as NodePath<t.Node>);
        if (!constName || !factoryConstNames.includes(constName)) return;

        const keyNode = path.node.key;
        if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
          return;
        const propName =
          keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
        if (!isContentProperty(propName)) return;

        const valueNode = path.node.value;

        if (valueNode.type === "ConditionalExpression") {
          const result = transformConditionalBranchInline(valueNode, textToKey);
          if (result.count > 0) {
            path.node.value = result.node;
            stringsWrapped += result.count;
          }
          return;
        }

        let text: string | undefined;
        let templateInfo:
          | {
              placeholders: string[];
              expressions: t.TemplateLiteral["expressions"];
            }
          | undefined;

        if (valueNode.type === "StringLiteral") {
          text = valueNode.value;
        } else if (valueNode.type === "TemplateLiteral") {
          const info = buildTemplateLiteralText(
            valueNode.quasis,
            valueNode.expressions,
          );
          if (info) {
            text = info.text;
            templateInfo = {
              placeholders: info.placeholders,
              expressions: valueNode.expressions,
            };
          }
        }

        if (!text || !(text in textToKey)) return;

        const key = textToKey[text];
        const args: t.Expression[] = [
          t.stringLiteral(text),
          t.stringLiteral(key),
        ];
        if (templateInfo && templateInfo.placeholders.length > 0) {
          args.push(
            buildValuesObject(
              templateInfo.expressions,
              templateInfo.placeholders,
            ),
          );
        }
        path.node.value = markGeneratedCall(
          t.callExpression(t.identifier("t"), args),
        );
        stringsWrapped++;
        return;
      }

      // Existing function-scoped logic
      const ownerFn = getNearestFunctionPath(
        path as unknown as NodePath<t.Node>,
      );
      if (!ownerFn) return;
      if (!functionContainsJSX(ownerFn.node)) return;
      const compName = getComponentName(ownerFn as unknown as NodePath<t.Node>);
      if (!compName) return;

      const keyNode = path.node.key;
      if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
        return;
      const propName =
        keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
      if (!isContentProperty(propName)) return;

      const valueNode = path.node.value;

      if (valueNode.type === "ConditionalExpression") {
        const result = transformConditionalBranchInline(valueNode, textToKey);
        if (result.count > 0) {
          path.node.value = result.node;
          stringsWrapped += result.count;
          componentsNeedingT.add(compName);
        }
        return;
      }

      let text: string | undefined;
      let templateInfo:
        | {
            placeholders: string[];
            expressions: t.TemplateLiteral["expressions"];
          }
        | undefined;

      if (valueNode.type === "StringLiteral") {
        text = valueNode.value;
      } else if (valueNode.type === "TemplateLiteral") {
        const info = buildTemplateLiteralText(
          valueNode.quasis,
          valueNode.expressions,
        );
        if (info) {
          text = info.text;
          templateInfo = {
            placeholders: info.placeholders,
            expressions: valueNode.expressions,
          };
        }
      }

      if (!text || !(text in textToKey)) return;

      const key = textToKey[text];
      const args: t.Expression[] = [
        t.stringLiteral(text),
        t.stringLiteral(key),
      ];
      if (templateInfo && templateInfo.placeholders.length > 0) {
        args.push(
          buildValuesObject(
            templateInfo.expressions,
            templateInfo.placeholders,
          ),
        );
      }
      path.node.value = markGeneratedCall(
        t.callExpression(t.identifier("t"), args),
      );
      stringsWrapped++;

      componentsNeedingT.add(compName);
    },
  });

  const hasModuleFactoryWorkInline =
    (options.moduleFactoryConstNames?.length ?? 0) > 0 ||
    (options.moduleFactoryImportedNames?.length ?? 0) > 0;

  if (stringsWrapped === 0 && !repaired && !boundaryRepaired && !hasModuleFactoryWorkInline) {
    return {
      code: generate(ast).code,
      stringsWrapped: 0,
      modified: false,
      usedKeys: [],
    };
  }

  if (stringsWrapped === 0 && !hasModuleFactoryWorkInline && (repaired || boundaryRepaired)) {
    if (needsClientDirective && boundaryRepaired) {
      addUseClientDirective(ast);
    }
    const output = generate(ast, { retainLines: false });
    return {
      code: output.code,
      stringsWrapped: 0,
      modified: true,
      usedKeys: [],
    };
  }

  // Pre-scan: discover which components will need hook due to factory imports
  const moduleFactoryImportedNamesInline = options.moduleFactoryImportedNames ?? [];
  const factoryRefComponentsInline = preDiscoverFactoryRefComponents(ast, moduleFactoryImportedNamesInline);
  for (const comp of factoryRefComponentsInline) {
    componentsNeedingT.add(comp);
  }

  const needsHook = componentsNeedingT.size > 0;
  const hookName = isClient ? "useT" : "createT";
  const importPath = isClient ? componentPath : `${componentPath}-server`;
  const existing = hasInlineImport(ast, componentPath);

  const specifiers: t.ImportSpecifier[] = [];
  if (needsTComponent && !existing.hasT) {
    specifiers.push(t.importSpecifier(t.identifier("T"), t.identifier("T")));
  }
  if (needsHook && !existing.hasHook) {
    specifiers.push(
      t.importSpecifier(t.identifier(hookName), t.identifier(hookName)),
    );
  }

  if (specifiers.length > 0) {
    let appended = false;
    for (const node of ast.program.body) {
      if (
        node.type === "ImportDeclaration" &&
        (node.source.value === importPath ||
          node.source.value === componentPath)
      ) {
        node.specifiers.push(...specifiers);
        node.source.value = importPath;
        appended = true;
        break;
      }
    }

    if (!appended) {
      const importDecl = t.importDeclaration(
        specifiers,
        t.stringLiteral(importPath),
      );
      const lastImportIndex = findLastImportIndex(ast);

      if (lastImportIndex >= 0) {
        ast.program.body.splice(lastImportIndex + 1, 0, importDecl);
      } else {
        let insertIdx = 0;
        if (
          ast.program.body[0]?.type === "ExpressionStatement" &&
          (ast.program.body[0] as t.ExpressionStatement).expression.type ===
            "StringLiteral" &&
          (
            (ast.program.body[0] as t.ExpressionStatement)
              .expression as t.StringLiteral
          ).value === "use client"
        ) {
          insertIdx = 1;
        }
        ast.program.body.splice(insertIdx, 0, importDecl);
      }
    }
  }

  if (needsHook) {
    const hookSources = new Set<string>([
      componentPath,
      `${componentPath}-server`,
      `${componentPath}/t-server`,
    ]);
    const importedHookName = isClient ? "useT" : "createT";
    const hookLocalName =
      resolveImportedLocalName(ast, hookSources, importedHookName) ??
      importedHookName;
    const hookCall = isClient
      ? t.callExpression(t.identifier(hookLocalName), [])
      : t.callExpression(t.identifier(hookLocalName), []);

    const serverAwait = !isClient;
    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const name = getComponentName(path as unknown as NodePath<t.Node>);
        if (!name || !componentsNeedingT.has(name)) return;
        const body = path.node.body;
        if (body.type !== "BlockStatement") return;
        const translatorId = injectInlineHookIntoBlock(
          body,
          hookCall,
          name,
          path.node,
          serverAwait,
        );
        componentTranslatorIds.set(name, translatorId);
      },
      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        if (path.node.id.type !== "Identifier") return;
        const name = path.node.id.name;
        if (!componentsNeedingT.has(name)) return;

        const init = path.node.init;
        if (!init) return;

        if (
          init.type === "ArrowFunctionExpression" ||
          init.type === "FunctionExpression"
        ) {
          const block = ensureBlockBody(init);
          const translatorId = injectInlineHookIntoBlock(
            block,
            hookCall,
            name,
            init,
            serverAwait,
          );
          componentTranslatorIds.set(name, translatorId);
          return;
        }

        if (init.type === "CallExpression") {
          const wrappedFn = findWrappedFunctionInCall(init);
          if (!wrappedFn) return;
          const block = ensureBlockBody(wrappedFn);
          const translatorId = injectInlineHookIntoBlock(
            block,
            hookCall,
            name,
            wrappedFn,
            serverAwait,
          );
          componentTranslatorIds.set(name, translatorId);
        }
      },
      ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
        const name = "__default__";
        if (!componentsNeedingT.has(name)) return;
        const decl = path.node.declaration;

        if (decl.type === "FunctionDeclaration") {
          const translatorId = injectInlineHookIntoBlock(
            decl.body,
            hookCall,
            name,
            decl,
            serverAwait,
          );
          componentTranslatorIds.set(name, translatorId);
          return;
        }

        if (
          decl.type === "FunctionExpression" ||
          decl.type === "ArrowFunctionExpression"
        ) {
          const block = ensureBlockBody(decl);
          const translatorId = injectInlineHookIntoBlock(
            block,
            hookCall,
            name,
            decl,
            serverAwait,
          );
          componentTranslatorIds.set(name, translatorId);
          return;
        }

        if (decl.type === "CallExpression") {
          const wrappedFn = findWrappedFunctionInCall(decl);
          if (!wrappedFn) return;
          const block = ensureBlockBody(wrappedFn);
          const translatorId = injectInlineHookIntoBlock(
            block,
            hookCall,
            name,
            wrappedFn,
            serverAwait,
          );
          componentTranslatorIds.set(name, translatorId);
        }
      },
      noScope: true,
    });
  }

  // Module factory: wrap const declarations as arrow factories
  const moduleFactoryConstNames = options.moduleFactoryConstNames ?? [];
  const didWrapFactoryInline = wrapModuleFactoryDeclarations(ast, moduleFactoryConstNames);

  rewriteGeneratedCallsForTranslator(ast, componentTranslatorIds);

  // Module factory: rewrite references to imported factory consts
  const moduleFactoryImportedNames = options.moduleFactoryImportedNames ?? [];
  const { componentsNeedingT: factoryComponentsNeedingT, rewrote: didRewriteRefsInline } = rewriteModuleFactoryReferences(
    ast,
    moduleFactoryImportedNames,
    componentTranslatorIds,
  );
  for (const comp of factoryComponentsNeedingT) {
    componentsNeedingT.add(comp);
  }

  if (needsClientDirective && (needsHook || boundaryRepaired)) {
    addUseClientDirective(ast);
  }

  const didModifyInline = stringsWrapped > 0 || repaired || boundaryRepaired || didWrapFactoryInline || didRewriteRefsInline;
  const output = generate(ast, { retainLines: false });
  return { code: output.code, stringsWrapped, modified: didModifyInline, usedKeys: [] };
}

function injectInlineHookIntoBlock(
  block: t.BlockStatement,
  hookCall: t.CallExpression,
  componentName?: string,
  ownerFn?: t.Function,
  useAwait?: boolean,
): string {
  const targetName =
    hookCall.callee.type === "Identifier" ? hookCall.callee.name : undefined;
  let sawConflictingT = false;

  for (const stmt of block.body) {
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of stmt.declarations) {
      if (d.id.type !== "Identifier") continue;

      // Detect both `createT()` and `await createT()`
      const callExpr =
        d.init?.type === "AwaitExpression" &&
        d.init.argument.type === "CallExpression"
          ? d.init.argument
          : d.init?.type === "CallExpression"
            ? d.init
            : null;

      if (
        callExpr &&
        callExpr.callee.type === "Identifier" &&
        (callExpr.callee.name === "useT" ||
          callExpr.callee.name === "createT" ||
          (targetName ? callExpr.callee.name === targetName : false))
      ) {
        const translatorId = d.id.name;
        // Fix the hook name if it doesn't match the expected one (boundary repair)
        if (targetName && callExpr.callee.name !== targetName) {
          callExpr.callee = t.identifier(targetName);
        }
        // Upgrade sync createT() to await createT() for server components
        if (useAwait && d.init?.type !== "AwaitExpression") {
          d.init = t.awaitExpression(d.init!);
          if (ownerFn && !ownerFn.async) {
            ownerFn.async = true;
            ownerFn.returnType = null;
          }
        }
        return translatorId;
      }

      if (d.id.name === "t") sawConflictingT = true;
    }
  }

  const translatorId = pickTranslatorId(block, ownerFn);
  if (sawConflictingT && translatorId !== "t") {
    logWarning(
      componentName
        ? `Component "${componentName}" has "const t = ..." that is not useT/createT.\n  Injected fallback translator "${translatorId}" to avoid conflicts.`
        : `Detected "const t = ..." conflict. Injected fallback translator "${translatorId}".`,
    );
  }

  const initExpr = useAwait
    ? t.awaitExpression(t.cloneNode(hookCall, true))
    : t.cloneNode(hookCall, true);

  const tDecl = t.variableDeclaration("const", [
    t.variableDeclarator(t.identifier(translatorId), initExpr),
  ]);

  block.body.unshift(tDecl);
  if (useAwait && ownerFn && !ownerFn.async) {
    ownerFn.async = true;
    ownerFn.returnType = null;
  }
  return translatorId;
}
