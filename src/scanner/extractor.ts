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
} from "../utils/ast-helpers.js";
import type { ExtractedString } from "../types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TraverseFn = (ast: File, opts: Record<string, any>) => void;
const traverse = resolveDefault(_traverse) as unknown as TraverseFn;

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
      } else if (
        value.type === "JSXExpressionContainer" &&
        value.expression.type === "StringLiteral"
      ) {
        text = value.expression.value;
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
      const expr = path.node.expression;
      if (expr.type !== "StringLiteral") return;

      const text = expr.value.trim();
      if (shouldIgnore(text)) return;

      if (path.parent.type === "JSXAttribute") return;

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
      if (!isInsideFunction(path)) return;

      const keyNode = path.node.key;
      if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral")
        return;

      const propName =
        keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
      if (!isContentProperty(propName)) return;

      const valueNode = path.node.value;
      if (valueNode.type !== "StringLiteral") return;

      const text = valueNode.value.trim();
      if (shouldIgnore(text)) return;

      results.push({
        text,
        type: "object-property",
        file: filePath,
        line: valueNode.loc?.start.line ?? 0,
        column: valueNode.loc?.start.column ?? 0,
        componentName: getComponentName(path),
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
