import type { NodePath } from "@babel/traverse";
import type { Node } from "@babel/types";

/**
 * Resolve CJS/ESM interop for babel packages.
 * Some environments return the module as `{ default: fn }` instead of `fn`.
 */
export function resolveDefault<T>(mod: T): T {
  if (typeof mod === "function") return mod;
  return (mod as unknown as { default: T }).default;
}

/**
 * Check if a path is inside a function scope (component body).
 */
export function isInsideFunction(path: NodePath<Node>): boolean {
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

/**
 * Walk up the AST to find the enclosing React component name.
 */
export function getComponentName(path: NodePath<Node>): string | undefined {
  let current: NodePath<Node> | null = path;
  while (current) {
    if (current.isFunctionDeclaration() && current.node.id) {
      return current.node.id.name;
    }
    if (
      current.isVariableDeclarator() &&
      current.node.id?.type === "Identifier"
    ) {
      // Only treat as component name if the init is a function (arrow/expression).
      // Skip plain variables like `const items = [...]`.
      const init = current.node.init;
      if (
        init &&
        (init.type === "ArrowFunctionExpression" ||
          init.type === "FunctionExpression")
      ) {
        return current.node.id.name;
      }
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

/**
 * Walk up the AST to find the nearest parent JSX element tag name.
 */
export function getParentTagName(path: NodePath<Node>): string | undefined {
  let current = path.parentPath;
  while (current) {
    if (current.isJSXElement()) {
      const opening = current.node.openingElement;
      if (opening.name.type === "JSXIdentifier") {
        return opening.name.name;
      }
      if (opening.name.type === "JSXMemberExpression" && opening.name.object.type === "JSXIdentifier") {
        return `${opening.name.object.name}.${opening.name.property.name}`;
      }
    }
    current = current.parentPath;
  }
  return undefined;
}
