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
}

export interface TransformOptions {
  i18nImport?: string;
  mode?: "keys" | "inline";
  componentPath?: string;
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

function hasUseTranslationsCall(ast: File): boolean {
  let found = false;
  traverse(ast, {
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      const init = path.node.init;
      if (
        init?.type === "CallExpression" &&
        init.callee.type === "Identifier" &&
        init.callee.name === "useTranslations"
      ) {
        found = true;
        path.stop();
      }
    },
    noScope: true,
  });
  return found;
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
  let stringsWrapped = 0;
  const componentsNeedingT = new Set<string>();

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

      const siblings = parent.node.children.filter((child: JSXChild) => {
        if (child.type === "JSXText") return child.value.trim().length > 0;
        return true;
      });

      if (siblings.length === 1) {
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

      const compName = getComponentName(path);
      if (compName) componentsNeedingT.add(compName);
    },

    JSXAttribute(path: NodePath<t.JSXAttribute>) {
      const value = path.node.value;
      if (!value) return;

      let text: string | undefined;

      if (value.type === "StringLiteral") {
        text = value.value;
      } else if (
        value.type === "JSXExpressionContainer" &&
        value.expression.type === "StringLiteral"
      ) {
        text = value.expression.value;
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
      path.node.value = t.jsxExpressionContainer(
        t.callExpression(t.identifier("t"), [t.stringLiteral(key)]),
      );
      stringsWrapped++;

      const compName = getComponentName(path);
      if (compName) componentsNeedingT.add(compName);
    },

    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      if (!isInsideFunction(path)) return;

      const keyNode = path.node.key;
      if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
        return;
      const propName =
        keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
      if (!isContentProperty(propName)) return;

      const valueNode = path.node.value;
      if (valueNode.type !== "StringLiteral") return;

      const text = valueNode.value;
      if (!text || !(text in textToKey)) return;

      const key = textToKey[text];
      path.node.value = t.callExpression(t.identifier("t"), [
        t.stringLiteral(key),
      ]);
      stringsWrapped++;

      const compName = getComponentName(path);
      if (compName) componentsNeedingT.add(compName);
    },
  });

  if (stringsWrapped === 0) {
    return { code: generate(ast).code, stringsWrapped: 0, modified: false };
  }

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

  if (!hasUseTranslationsCall(ast)) {
    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const name = path.node.id?.name;
        if (!name || !componentsNeedingT.has(name)) return;
        injectTDeclaration(path);
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
            injectTIntoBlock(init.body);
          }
        }
      },
      noScope: true,
    });
  }

  const output = generate(ast, { retainLines: false });
  return { code: output.code, stringsWrapped, modified: true };
}

function injectTDeclaration(path: NodePath<t.FunctionDeclaration>): void {
  const body = path.node.body;
  if (body.type !== "BlockStatement") return;
  injectTIntoBlock(body);
}

function injectTIntoBlock(block: t.BlockStatement): void {
  for (const stmt of block.body) {
    if (
      stmt.type === "VariableDeclaration" &&
      stmt.declarations.some(
        (d) =>
          d.id.type === "Identifier" &&
          d.id.name === "t" &&
          d.init?.type === "CallExpression" &&
          d.init.callee.type === "Identifier" &&
          d.init.callee.name === "useTranslations",
      )
    ) {
      return;
    }
  }

  const tDecl = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier("t"),
      t.callExpression(t.identifier("useTranslations"), []),
    ),
  ]);

  block.body.unshift(tDecl);
}

function isClientFile(ast: File): boolean {
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
  return false;
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

function hasInlineHookCall(ast: File, hookName: string): boolean {
  let found = false;
  traverse(ast, {
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      const init = path.node.init;
      if (
        init?.type === "CallExpression" &&
        init.callee.type === "Identifier" &&
        init.callee.name === hookName
      ) {
        found = true;
        path.stop();
      }
    },
    noScope: true,
  });
  return found;
}

function transformInline(
  ast: File,
  textToKey: Record<string, string>,
  options: TransformOptions,
): TransformResult {
  const componentPath = options.componentPath ?? "@/components/t";
  const isClient = isClientFile(ast);
  let stringsWrapped = 0;
  const componentsNeedingT = new Set<string>();
  let needsTComponent = false;
  let repaired = false;

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

      const siblings = parent.node.children.filter((child: JSXChild) => {
        if (child.type === "JSXText") return child.value.trim().length > 0;
        return true;
      });

      if (siblings.length === 1) {
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

    JSXAttribute(path: NodePath<t.JSXAttribute>) {
      const value = path.node.value;
      if (!value) return;

      let text: string | undefined;

      if (value.type === "StringLiteral") {
        text = value.value;
      } else if (
        value.type === "JSXExpressionContainer" &&
        value.expression.type === "StringLiteral"
      ) {
        text = value.expression.value;
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
      path.node.value = t.jsxExpressionContainer(
        t.callExpression(t.identifier("t"), [
          t.stringLiteral(text),
          t.stringLiteral(key),
        ]),
      );
      stringsWrapped++;

      const compName = getComponentName(path);
      if (compName) componentsNeedingT.add(compName);
    },

    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      if (!isInsideFunction(path)) return;

      const keyNode = path.node.key;
      if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
        return;
      const propName =
        keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
      if (!isContentProperty(propName)) return;

      const valueNode = path.node.value;
      if (valueNode.type !== "StringLiteral") return;

      const text = valueNode.value;
      if (!text || !(text in textToKey)) return;

      const key = textToKey[text];
      path.node.value = t.callExpression(t.identifier("t"), [
        t.stringLiteral(text),
        t.stringLiteral(key),
      ]);
      stringsWrapped++;

      const compName = getComponentName(path);
      if (compName) componentsNeedingT.add(compName);
    },
  });

  if (stringsWrapped === 0 && !repaired) {
    return { code: generate(ast).code, stringsWrapped: 0, modified: false };
  }

  if (stringsWrapped === 0 && repaired) {
    const output = generate(ast, { retainLines: false });
    return { code: output.code, stringsWrapped: 0, modified: true };
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

  if (needsHook && !hasInlineHookCall(ast, hookName)) {
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
  return { code: output.code, stringsWrapped, modified: true };
}

function injectInlineHookIntoBlock(
  block: t.BlockStatement,
  hookCall: t.CallExpression,
): void {
  for (const stmt of block.body) {
    if (
      stmt.type === "VariableDeclaration" &&
      stmt.declarations.some(
        (d) =>
          d.id.type === "Identifier" &&
          d.id.name === "t" &&
          d.init?.type === "CallExpression" &&
          d.init.callee.type === "Identifier" &&
          (d.init.callee.name === "useT" || d.init.callee.name === "createT"),
      )
    ) {
      return;
    }
  }

  const tDecl = t.variableDeclaration("const", [
    t.variableDeclarator(t.identifier("t"), hookCall),
  ]);

  block.body.unshift(tDecl);
}
