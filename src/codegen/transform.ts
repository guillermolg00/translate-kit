import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import type { File } from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { isContentProperty } from "../scanner/filters.js";
import {
  resolveDefault,
  isInsideFunction,
  getComponentName,
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

function hasUseTranslationsImport(ast: File, importSource: string): boolean {
  for (const node of ast.program.body) {
    if (
      node.type === "ImportDeclaration" &&
      node.source.value === importSource
    ) {
      for (const spec of node.specifiers) {
        if (
          spec.type === "ImportSpecifier" &&
          spec.imported.type === "Identifier" &&
          spec.imported.name === "useTranslations"
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function hasGetTranslationsImport(ast: File, importSource: string): boolean {
  for (const node of ast.program.body) {
    if (
      node.type === "ImportDeclaration" &&
      node.source.value === importSource
    ) {
      for (const spec of node.specifiers) {
        if (
          spec.type === "ImportSpecifier" &&
          spec.imported.type === "Identifier" &&
          spec.imported.name === "getTranslations"
        ) {
          return true;
        }
      }
    }
  }
  return false;
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
        node: t.callExpression(t.identifier("t"), [t.stringLiteral(key)]),
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
        node: t.callExpression(t.identifier("t"), args),
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
        node: t.callExpression(t.identifier("t"), [
          t.stringLiteral(text),
          t.stringLiteral(key),
        ]),
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
        node: t.callExpression(t.identifier("t"), args),
        count: 1,
      };
    }
    return { node, count: 0 };
  }

  return { node, count: 0 };
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
      const text = path.node.value.trim();
      if (!text || !(text in textToKey)) return;

      const parent = path.parentPath;
      if (!parent?.isJSXElement()) return;

      const key = textToKey[text];
      const tCall = t.jsxExpressionContainer(
        t.callExpression(t.identifier("t"), [t.stringLiteral(key)]),
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
      const expr = path.node.expression;
      if (path.parent.type === "JSXAttribute") return;

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
      path.node.expression = t.callExpression(t.identifier("t"), args);
      stringsWrapped++;
      trackKey(path, key);
    },

    JSXAttribute(path: NodePath<t.JSXAttribute>) {
      const value = path.node.value;
      if (!value) return;

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
        t.callExpression(t.identifier("t"), args),
      );
      stringsWrapped++;
      trackKey(path, key);
    },

    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      if (!isInsideFunction(path)) return;

      const compName = getComponentName(path);
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
      path.node.value = t.callExpression(t.identifier("t"), args);
      stringsWrapped++;
      trackKey(path, key);
    },
  });

  if (stringsWrapped === 0) {
    return {
      code: generate(ast).code,
      stringsWrapped: 0,
      modified: false,
      usedKeys: [],
    };
  }

  // Compute namespace per component
  const componentNamespaces = new Map<string, string | null>();
  for (const [comp, keys] of componentKeys) {
    componentNamespaces.set(comp, detectNamespace([...keys]));
  }

  const namespacedComponents = new Set<string>();

  if (isClient) {
    if (!hasUseTranslationsImport(ast, importSource)) {
      const importDecl = t.importDeclaration(
        [
          t.importSpecifier(
            t.identifier("useTranslations"),
            t.identifier("useTranslations"),
          ),
        ],
        t.stringLiteral(importSource),
      );

      const lastImportIndex = findLastImportIndex(ast);
      if (lastImportIndex >= 0) {
        ast.program.body.splice(lastImportIndex + 1, 0, importDecl);
      } else {
        ast.program.body.unshift(importDecl);
      }
    }

    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const name = path.node.id?.name;
        if (!name || !componentsNeedingT.has(name)) return;
        const ns = componentNamespaces.get(name) ?? undefined;
        if (injectTDeclaration(path, ns)) namespacedComponents.add(name);
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
          if (init.body.type === "BlockStatement") {
            const ns = componentNamespaces.get(name) ?? undefined;
            if (injectTIntoBlock(init.body, ns)) namespacedComponents.add(name);
          }
        }
      },
      noScope: true,
    });
  } else {
    const serverSource = `${importSource}/server`;
    if (!hasGetTranslationsImport(ast, serverSource)) {
      const importDecl = t.importDeclaration(
        [
          t.importSpecifier(
            t.identifier("getTranslations"),
            t.identifier("getTranslations"),
          ),
        ],
        t.stringLiteral(serverSource),
      );

      const lastImportIndex = findLastImportIndex(ast);
      if (lastImportIndex >= 0) {
        ast.program.body.splice(lastImportIndex + 1, 0, importDecl);
      } else {
        ast.program.body.unshift(importDecl);
      }
    }

    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const name = path.node.id?.name;
        if (!name || !componentsNeedingT.has(name)) return;
        path.node.async = true;
        const ns = componentNamespaces.get(name) ?? undefined;
        if (injectAsyncTIntoBlock(path.node.body, ns))
          namespacedComponents.add(name);
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
          init.async = true;
          if (init.body.type === "BlockStatement") {
            const ns = componentNamespaces.get(name) ?? undefined;
            if (injectAsyncTIntoBlock(init.body, ns))
              namespacedComponents.add(name);
          }
        }
      },
      noScope: true,
    });
  }

  // Rewrite keys to strip namespace prefix only for components where namespace was established
  const effectiveNamespaces = new Map<string, string | null>();
  for (const [comp, ns] of componentNamespaces) {
    effectiveNamespaces.set(comp, namespacedComponents.has(comp) ? ns : null);
  }
  rewriteKeysForNamespaces(ast, effectiveNamespaces);

  const output = generate(ast, { retainLines: false });
  return {
    code: output.code,
    stringsWrapped,
    modified: true,
    usedKeys: allUsedKeys,
  };
}

function injectTDeclaration(
  path: NodePath<t.FunctionDeclaration>,
  namespace?: string,
): boolean {
  const body = path.node.body;
  if (body.type !== "BlockStatement") return false;
  return injectTIntoBlock(body, namespace);
}

function updateCallNamespace(
  call: t.CallExpression,
  namespace: string | undefined,
): boolean {
  if (!namespace) return false;
  const currentArg = call.arguments[0];
  if (
    currentArg &&
    currentArg.type === "StringLiteral" &&
    currentArg.value === namespace
  ) {
    return true; // Already correct
  }
  call.arguments = [t.stringLiteral(namespace)];
  return true;
}

function injectTIntoBlock(
  block: t.BlockStatement,
  namespace?: string,
): boolean {
  for (const stmt of block.body) {
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of stmt.declarations) {
      if (d.id.type !== "Identifier" || d.id.name !== "t") continue;

      // const t = useTranslations(...) or const t = getTranslations(...)
      if (
        d.init?.type === "CallExpression" &&
        d.init.callee.type === "Identifier" &&
        (d.init.callee.name === "useTranslations" ||
          d.init.callee.name === "getTranslations")
      ) {
        return updateCallNamespace(d.init, namespace);
      }

      // const t = await getTranslations(...)
      if (
        d.init?.type === "AwaitExpression" &&
        d.init.argument.type === "CallExpression" &&
        d.init.argument.callee.type === "Identifier" &&
        d.init.argument.callee.name === "getTranslations"
      ) {
        return updateCallNamespace(d.init.argument, namespace);
      }
    }
  }

  const args: t.Expression[] = namespace ? [t.stringLiteral(namespace)] : [];
  const tDecl = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier("t"),
      t.callExpression(t.identifier("useTranslations"), args),
    ),
  ]);

  block.body.unshift(tDecl);
  return !!namespace;
}

function injectAsyncTIntoBlock(
  block: t.BlockStatement,
  namespace?: string,
): boolean {
  for (const stmt of block.body) {
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of stmt.declarations) {
      if (d.id.type !== "Identifier" || d.id.name !== "t") continue;

      // const t = await getTranslations(...)
      if (
        d.init?.type === "AwaitExpression" &&
        d.init.argument.type === "CallExpression" &&
        d.init.argument.callee.type === "Identifier" &&
        d.init.argument.callee.name === "getTranslations"
      ) {
        return updateCallNamespace(d.init.argument, namespace);
      }

      // const t = getTranslations(...)
      if (
        d.init?.type === "CallExpression" &&
        d.init.callee.type === "Identifier" &&
        d.init.callee.name === "getTranslations"
      ) {
        return updateCallNamespace(d.init, namespace);
      }
    }
  }

  const args: t.Expression[] = namespace ? [t.stringLiteral(namespace)] : [];
  const tDecl = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier("t"),
      t.awaitExpression(
        t.callExpression(t.identifier("getTranslations"), args),
      ),
    ),
  ]);

  block.body.unshift(tDecl);
  return !!namespace;
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

export function detectClientFile(ast: File): boolean {
  if (ast.program.directives) {
    for (const directive of ast.program.directives) {
      if (directive.value?.value === "use client") {
        return true;
      }
    }
  }
  for (const node of ast.program.body) {
    if (
      node.type === "ExpressionStatement" &&
      node.expression.type === "StringLiteral" &&
      node.expression.value === "use client"
    ) {
      return true;
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
      if (
        callee.type === "Identifier" &&
        /^use[A-Z]/.test(callee.name) &&
        // Exclude translate-kit's inline mode hook — it is normalised
        // by codegen and should not force client detection.
        callee.name !== "useT"
      ) {
        usesHooks = true;
      }
    },
    noScope: true,
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

function transformInline(
  ast: File,
  textToKey: Record<string, string>,
  options: TransformOptions,
): TransformResult {
  const componentPath = options.componentPath ?? "@/components/t";
  const isClient = options.forceClient || detectClientFile(ast);
  let stringsWrapped = 0;
  const componentsNeedingT = new Set<string>();
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
      const text = path.node.value.trim();
      if (!text || !(text in textToKey)) return;

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
      const expr = path.node.expression;
      if (path.parent.type === "JSXAttribute") return;

      if (expr.type === "ConditionalExpression") {
        const result = transformConditionalBranchInline(expr, textToKey);
        if (result.count > 0) {
          path.node.expression = result.node;
          stringsWrapped += result.count;
          const compName = getComponentName(path);
          if (compName) componentsNeedingT.add(compName);
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
      path.node.expression = t.callExpression(t.identifier("t"), args);
      stringsWrapped++;
      const compName = getComponentName(path);
      if (compName) componentsNeedingT.add(compName);
    },

    JSXAttribute(path: NodePath<t.JSXAttribute>) {
      const value = path.node.value;
      if (!value) return;

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
          const compName = getComponentName(path);
          if (compName) componentsNeedingT.add(compName);
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
        t.callExpression(t.identifier("t"), args),
      );
      stringsWrapped++;

      const compName = getComponentName(path);
      if (compName) componentsNeedingT.add(compName);
    },

    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      if (!isInsideFunction(path)) return;

      const compName = getComponentName(path);
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
      path.node.value = t.callExpression(t.identifier("t"), args);
      stringsWrapped++;

      componentsNeedingT.add(compName);
    },
  });

  if (stringsWrapped === 0 && !repaired && !boundaryRepaired) {
    return {
      code: generate(ast).code,
      stringsWrapped: 0,
      modified: false,
      usedKeys: [],
    };
  }

  if (stringsWrapped === 0 && (repaired || boundaryRepaired)) {
    const output = generate(ast, { retainLines: false });
    return {
      code: output.code,
      stringsWrapped: 0,
      modified: true,
      usedKeys: [],
    };
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
    const hookCall = isClient
      ? t.callExpression(t.identifier("useT"), [])
      : t.callExpression(t.identifier("createT"), []);

    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const name = path.node.id?.name;
        if (!name || !componentsNeedingT.has(name)) return;
        const body = path.node.body;
        if (body.type !== "BlockStatement") return;
        injectInlineHookIntoBlock(body, hookCall);
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
          if (init.body.type === "BlockStatement") {
            injectInlineHookIntoBlock(init.body, hookCall);
          }
        }
      },
      noScope: true,
    });
  }

  const output = generate(ast, { retainLines: false });
  return { code: output.code, stringsWrapped, modified: true, usedKeys: [] };
}

function injectInlineHookIntoBlock(
  block: t.BlockStatement,
  hookCall: t.CallExpression,
): void {
  const targetName =
    hookCall.callee.type === "Identifier" ? hookCall.callee.name : undefined;

  for (const stmt of block.body) {
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of stmt.declarations) {
      if (
        d.id.type === "Identifier" &&
        d.id.name === "t" &&
        d.init?.type === "CallExpression" &&
        d.init.callee.type === "Identifier" &&
        (d.init.callee.name === "useT" || d.init.callee.name === "createT")
      ) {
        // Fix the hook name if it doesn't match the expected one (boundary repair)
        if (targetName && d.init.callee.name !== targetName) {
          d.init.callee = t.identifier(targetName);
        }
        return;
      }
    }
  }

  const tDecl = t.variableDeclaration("const", [
    t.variableDeclarator(t.identifier("t"), hookCall),
  ]);

  block.body.unshift(tDecl);
}
