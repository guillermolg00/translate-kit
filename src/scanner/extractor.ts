import _traverse from "@babel/traverse";
import type { File } from "@babel/types";
import { isTranslatableProp, isIgnoredTag, isContentProperty, shouldIgnore } from "./filters.js";
import type { ExtractedString } from "../types.js";

// Handle CJS/ESM interop
const traverse =
  typeof _traverse === "function"
    ? _traverse
    : (_traverse as unknown as { default: typeof _traverse }).default;

export function extractStrings(
  ast: File,
  filePath: string,
  translatableProps?: string[],
): ExtractedString[] {
  const results: ExtractedString[] = [];

  traverse(ast, {
    JSXText(path) {
      const text = path.node.value.trim();
      if (shouldIgnore(text)) return;

      const parentTag = getParentTagName(path);
      if (parentTag && isIgnoredTag(parentTag)) return;

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

    JSXAttribute(path) {
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

    JSXExpressionContainer(path) {
      const expr = path.node.expression;
      if (expr.type !== "StringLiteral") return;

      const text = expr.value.trim();
      if (shouldIgnore(text)) return;

      // Skip if this is an attribute value (handled in JSXAttribute)
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

    ObjectProperty(path) {
      // Only extract inside functions (components), not module-level objects like metadata
      if (!isInsideFunction(path)) return;

      // Detect strings in object properties like { title: "Project Management", description: "..." }
      const keyNode = path.node.key;
      if (keyNode.type !== "Identifier" && keyNode.type !== "StringLiteral") return;

      const propName = keyNode.type === "Identifier" ? keyNode.name : keyNode.value;
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

    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== "Identifier" || callee.name !== "t") return;

      const args = path.node.arguments;
      if (args.length === 0) return;

      const firstArg = args[0];
      if (firstArg.type !== "StringLiteral") return;

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
  });

  return results;
}

function isInsideFunction(path: any): boolean {
  let current = path.parentPath;
  while (current) {
    if (
      current.isFunctionDeclaration() ||
      current.isFunctionExpression() ||
      current.isArrowFunctionExpression()
    ) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

function getParentTagName(path: any): string | undefined {
  let current = path.parentPath;
  while (current) {
    if (current.isJSXElement()) {
      const opening = current.node.openingElement;
      if (opening.name.type === "JSXIdentifier") {
        return opening.name.name;
      }
      if (opening.name.type === "JSXMemberExpression") {
        return `${opening.name.object.name}.${opening.name.property.name}`;
      }
    }
    current = current.parentPath;
  }
  return undefined;
}

function getComponentName(path: any): string | undefined {
  let current = path;
  while (current) {
    if (current.isFunctionDeclaration() && current.node.id) {
      return current.node.id.name;
    }
    if (current.isVariableDeclarator() && current.node.id?.type === "Identifier") {
      return current.node.id.name;
    }
    if (current.isExportDefaultDeclaration()) {
      const decl = current.node.declaration;
      if (decl.type === "FunctionDeclaration" && decl.id) {
        return decl.id.name;
      }
    }
    current = current.parentPath;
  }
  return undefined;
}
