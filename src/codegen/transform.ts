import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import type { File } from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { isContentProperty } from "../scanner/filters.js";
import { resolveDefault, isInsideFunction, getComponentName } from "../utils/ast-helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TraverseFn = (ast: File, opts: Record<string, any>) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenerateFn = (ast: File, opts?: Record<string, any>) => { code: string };

const traverse = resolveDefault(_traverse) as unknown as TraverseFn;
const generate = resolveDefault(_generate) as unknown as GenerateFn;

export interface TransformResult {
  code: string;
  stringsWrapped: number;
  modified: boolean;
}

export interface TransformOptions {
  i18nImport?: string;
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
    VariableDeclarator(path) {
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
  const importSource = options.i18nImport ?? "next-intl";
  let stringsWrapped = 0;
  const componentsNeedingT = new Set<string>();

  traverse(ast, {
    JSXText(path) {
      const text = path.node.value.trim();
      if (!text || !(text in textToKey)) return;

      const parent = path.parentPath;
      if (!parent?.isJSXElement()) return;

      const key = textToKey[text];
      const tCall = t.jsxExpressionContainer(
        t.callExpression(t.identifier("t"), [t.stringLiteral(key)]),
      );

      const siblings = parent.node.children.filter((child) => {
        if (child.type === "JSXText") return child.value.trim().length > 0;
        return true;
      });

      if (siblings.length === 1) {
        // Sole child — simple replacement
        path.replaceWith(tCall);
      } else {
        // Mixed content — preserve surrounding whitespace
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

    JSXAttribute(path) {
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

      // Skip already wrapped t() calls
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

    ObjectProperty(path) {
      // Only transform inside functions (components), not module-level objects like metadata
      if (!isInsideFunction(path)) return;

      const keyNode = path.node.key;
      if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral") return;
      const propName = keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
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

    let lastImportIndex = -1;
    for (let i = 0; i < ast.program.body.length; i++) {
      if (ast.program.body[i].type === "ImportDeclaration") {
        lastImportIndex = i;
      }
    }

    if (lastImportIndex >= 0) {
      ast.program.body.splice(lastImportIndex + 1, 0, importDecl);
    } else {
      ast.program.body.unshift(importDecl);
    }
  }

  if (!hasUseTranslationsCall(ast)) {
    traverse(ast, {
      FunctionDeclaration(path) {
        const name = path.node.id?.name;
        if (!name || !componentsNeedingT.has(name)) return;
        injectTDeclaration(path);
      },
      VariableDeclarator(path) {
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

