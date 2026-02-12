import _traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import type {
  File,
  JSXText,
  JSXAttribute,
  JSXExpressionContainer,
  ObjectProperty,
  CallExpression,
  JSXElement,
} from "@babel/types";
import {
  isTranslatableProp,
  isIgnoredTag,
  isContentProperty,
  shouldIgnore,
} from "./filters.js";
import {
  resolveDefault,
  isInsideFunction,
  getComponentName,
  getParentTagName,
  getTopLevelConstName,
} from "../utils/ast-helpers.js";
import { buildTemplateLiteralText } from "../utils/template-literal.js";
import type { ExtractedString } from "../types.js";
import type { Expression, ConditionalExpression } from "@babel/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TraverseFn = (ast: File, opts: Record<string, any>) => void;
const traverse = resolveDefault(_traverse) as unknown as TraverseFn;

function getNearestFunctionPath(path: NodePath<any>): NodePath<any> | null {
  let current = path.parentPath;
  while (current) {
    if (
      current.isFunctionDeclaration() ||
      current.isFunctionExpression() ||
      current.isArrowFunctionExpression()
    ) {
      return current;
    }
    current = current.parentPath;
  }
  return null;
}

function functionContainsJSX(path: NodePath<any>): boolean {
  let hasJSX = false;
  path.traverse({
    JSXElement(p: NodePath<JSXElement>) {
      hasJSX = true;
      p.stop();
    },
    JSXFragment(p: NodePath<any>) {
      hasJSX = true;
      p.stop();
    },
  });
  return hasJSX;
}

function extractTextFromNode(node: Expression): string | null {
  if (node.type === "StringLiteral") {
    const trimmed = node.value.trim();
    return trimmed || null;
  }
  if (node.type === "TemplateLiteral") {
    const info = buildTemplateLiteralText(node.quasis, node.expressions);
    return info ? info.text : null;
  }
  return null;
}

function collectConditionalTexts(node: ConditionalExpression): string[] {
  const texts: string[] = [];

  for (const branch of [node.consequent, node.alternate]) {
    if (branch.type === "ConditionalExpression") {
      texts.push(...collectConditionalTexts(branch));
    } else {
      const text = extractTextFromNode(branch as Expression);
      if (text && !shouldIgnore(text)) {
        texts.push(text);
      }
    }
  }

  return texts;
}

export function extractStrings(
  ast: File,
  filePath: string,
  translatableProps?: string[],
): ExtractedString[] {
  const results: ExtractedString[] = [];

  traverse(ast, {
    JSXText(path: NodePath<JSXText>) {
      const text = path.node.value.trim();
      if (shouldIgnore(text)) return;

      const parentTag = getParentTagName(path);
      if (parentTag && isIgnoredTag(parentTag)) return;

      if (parentTag === "T") return;

      results.push({
        text,
        type: "jsx-text",
        file: filePath,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
        componentName: getComponentName(path),
        parentTag,
      });
    },

    JSXAttribute(path: NodePath<JSXAttribute>) {
      const name = path.node.name;
      const propName =
        name.type === "JSXIdentifier" ? name.name : name.name.name;

      if (!isTranslatableProp(propName, translatableProps)) return;

      const value = path.node.value;
      if (!value) return;

      let text: string | undefined;

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
          if (info) text = info.text;
        } else if (value.expression.type === "ConditionalExpression") {
          const parentTag = getParentTagName(path);
          if (parentTag && isIgnoredTag(parentTag)) return;

          const texts = collectConditionalTexts(value.expression);
          for (const t of texts) {
            results.push({
              text: t,
              type: "jsx-attribute",
              file: filePath,
              line: path.node.loc?.start.line ?? 0,
              column: path.node.loc?.start.column ?? 0,
              componentName: getComponentName(path),
              propName,
              parentTag,
            });
          }
          return;
        }
      }

      if (!text || shouldIgnore(text)) return;

      const parentTag = getParentTagName(path);
      if (parentTag && isIgnoredTag(parentTag)) return;

      results.push({
        text,
        type: "jsx-attribute",
        file: filePath,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
        componentName: getComponentName(path),
        propName,
        parentTag,
      });
    },

    JSXExpressionContainer(path: NodePath<JSXExpressionContainer>) {
      if (path.parent.type === "JSXAttribute") return;

      const expr = path.node.expression;

      if (expr.type === "ConditionalExpression") {
        const parentTag = getParentTagName(path);
        if (parentTag && isIgnoredTag(parentTag)) return;

        const texts = collectConditionalTexts(expr);
        for (const t of texts) {
          results.push({
            text: t,
            type: "jsx-expression",
            file: filePath,
            line: path.node.loc?.start.line ?? 0,
            column: path.node.loc?.start.column ?? 0,
            componentName: getComponentName(path),
            parentTag,
          });
        }
        return;
      }

      let text: string | undefined;

      if (expr.type === "StringLiteral") {
        text = expr.value.trim();
      } else if (expr.type === "TemplateLiteral") {
        const info = buildTemplateLiteralText(expr.quasis, expr.expressions);
        if (info) text = info.text;
      }

      if (!text || shouldIgnore(text)) return;

      const parentTag = getParentTagName(path);
      if (parentTag && isIgnoredTag(parentTag)) return;

      results.push({
        text,
        type: "jsx-expression",
        file: filePath,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
        componentName: getComponentName(path),
        parentTag,
      });
    },

    ObjectProperty(path: NodePath<ObjectProperty>) {
      const inFunction = isInsideFunction(path);

      if (!inFunction) {
        // Module-level: check if inside a top-level const declaration
        const constName = getTopLevelConstName(path as unknown as NodePath<any>);
        if (!constName) return;

        const keyNode = path.node.key;
        if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
          return;

        const propName =
          keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
        if (!isContentProperty(propName)) return;

        const valueNode = path.node.value;

        if (valueNode.type === "ConditionalExpression") {
          const texts = collectConditionalTexts(valueNode);
          for (const t of texts) {
            results.push({
              text: t,
              type: "module-object-property",
              file: filePath,
              line: valueNode.loc?.start.line ?? 0,
              column: valueNode.loc?.start.column ?? 0,
              propName,
              parentConstName: constName,
            });
          }
          return;
        }

        let text: string | undefined;
        if (valueNode.type === "StringLiteral") {
          text = valueNode.value.trim();
        } else if (valueNode.type === "TemplateLiteral") {
          const info = buildTemplateLiteralText(
            valueNode.quasis,
            valueNode.expressions,
          );
          if (info) text = info.text;
        }

        if (!text || shouldIgnore(text)) return;

        results.push({
          text,
          type: "module-object-property",
          file: filePath,
          line: valueNode.loc?.start.line ?? 0,
          column: valueNode.loc?.start.column ?? 0,
          propName,
          parentConstName: constName,
        });
        return;
      }

      // Function-level: existing logic
      const ownerFn = getNearestFunctionPath(path as unknown as NodePath<any>);
      if (!ownerFn) return;
      if (!functionContainsJSX(ownerFn)) return;
      const componentName = getComponentName(
        ownerFn as unknown as NodePath<any>,
      );
      if (!componentName) return;

      const keyNode = path.node.key;
      if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
        return;

      const propName =
        keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
      if (!isContentProperty(propName)) return;

      const valueNode = path.node.value;

      if (valueNode.type === "ConditionalExpression") {
        const texts = collectConditionalTexts(valueNode);
        for (const t of texts) {
          results.push({
            text: t,
            type: "object-property",
            file: filePath,
            line: valueNode.loc?.start.line ?? 0,
            column: valueNode.loc?.start.column ?? 0,
            componentName,
            propName,
          });
        }
        return;
      }

      let text: string | undefined;
      if (valueNode.type === "StringLiteral") {
        text = valueNode.value.trim();
      } else if (valueNode.type === "TemplateLiteral") {
        const info = buildTemplateLiteralText(
          valueNode.quasis,
          valueNode.expressions,
        );
        if (info) text = info.text;
      }

      if (!text || shouldIgnore(text)) return;

      results.push({
        text,
        type: "object-property",
        file: filePath,
        line: valueNode.loc?.start.line ?? 0,
        column: valueNode.loc?.start.column ?? 0,
        componentName,
        propName,
      });
    },

    CallExpression(path: NodePath<CallExpression>) {
      const callee = path.node.callee;
      if (callee.type !== "Identifier" || callee.name !== "t") return;

      const args = path.node.arguments;
      if (args.length === 0) return;

      const firstArg = args[0];
      if (firstArg.type !== "StringLiteral") return;

      if (args.length >= 2 && args[1].type === "StringLiteral") {
        results.push({
          text: firstArg.value,
          type: "t-call",
          file: filePath,
          line: path.node.loc?.start.line ?? 0,
          column: path.node.loc?.start.column ?? 0,
          componentName: getComponentName(path),
          parentTag: getParentTagName(path),
          id: args[1].value,
        });
        return;
      }

      results.push({
        text: firstArg.value,
        type: "t-call",
        file: filePath,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
        componentName: getComponentName(path),
        parentTag: getParentTagName(path),
      });
    },

    JSXElement(path: NodePath<JSXElement>) {
      const opening = path.node.openingElement;
      if (opening.name.type !== "JSXIdentifier" || opening.name.name !== "T")
        return;

      let id: string | undefined;
      for (const attr of opening.attributes) {
        if (
          attr.type === "JSXAttribute" &&
          attr.name.type === "JSXIdentifier" &&
          attr.name.name === "id" &&
          attr.value?.type === "StringLiteral"
        ) {
          id = attr.value.value;
        }
      }

      let text = "";
      for (const child of path.node.children) {
        if (child.type === "JSXText") {
          text += child.value;
        }
      }
      text = text.trim();
      if (!text) return;

      results.push({
        text,
        type: "T-component",
        file: filePath,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
        componentName: getComponentName(path),
        parentTag: getParentTagName(path),
        id,
      });
    },
  });

  return results;
}
