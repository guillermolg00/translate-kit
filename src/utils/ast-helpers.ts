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
  const isNestedInFunctionOrClass = (nodePath: NodePath<Node>): boolean => {
    let current = nodePath.parentPath;
    while (current) {
      if (
        current.isFunctionDeclaration() ||
        current.isFunctionExpression() ||
        current.isArrowFunctionExpression() ||
        current.isClassMethod() ||
        current.isClassPrivateMethod() ||
        current.isClassDeclaration() ||
        current.isClassExpression()
      ) {
        return true;
      }
      if (current.isProgram()) return false;
      current = current.parentPath;
    }
    return false;
  };

  const getNameFromFunctionLike = (
    fnPath: NodePath<Node>,
  ): string | undefined => {
    if (fnPath.isFunctionDeclaration()) {
      if (fnPath.node.id) return fnPath.node.id.name;
      if (fnPath.parentPath?.isExportDefaultDeclaration()) return "__default__";
      return undefined;
    }

    if (!fnPath.isFunctionExpression() && !fnPath.isArrowFunctionExpression()) {
      return undefined;
    }

    if (isNestedInFunctionOrClass(fnPath)) return undefined;

    const parent = fnPath.parentPath;
    if (!parent) return undefined;

    if (parent.isVariableDeclarator() && parent.node.id.type === "Identifier") {
      return parent.node.id.name;
    }

    if (parent.isExportDefaultDeclaration()) return "__default__";

    if (parent.isCallExpression()) {
      let call: NodePath<Node> = parent;
      while (call.parentPath?.isCallExpression()) {
        call = call.parentPath;
      }
      const carrier = call.parentPath;
      if (!carrier) return undefined;
      if (
        carrier.isVariableDeclarator() &&
        carrier.node.id.type === "Identifier"
      ) {
        return carrier.node.id.name;
      }
      if (carrier.isExportDefaultDeclaration()) return "__default__";
    }

    return undefined;
  };

  const getNameFromClassLike = (
    classPath: NodePath<Node>,
  ): string | undefined => {
    if (classPath.isClassDeclaration()) {
      if (classPath.node.id) return classPath.node.id.name;
      if (classPath.parentPath?.isExportDefaultDeclaration())
        return "__default__";
      return undefined;
    }

    if (!classPath.isClassExpression()) return undefined;
    if (isNestedInFunctionOrClass(classPath)) return undefined;

    const parent = classPath.parentPath;
    if (!parent) return undefined;
    if (parent.isVariableDeclarator() && parent.node.id.type === "Identifier") {
      return parent.node.id.name;
    }
    if (parent.isExportDefaultDeclaration()) return "__default__";

    return undefined;
  };

  let current: NodePath<Node> | null = path;
  while (current) {
    const functionName = getNameFromFunctionLike(current);
    if (functionName) return functionName;

    const className = getNameFromClassLike(current);
    if (className) return className;

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
      if (
        opening.name.type === "JSXMemberExpression" &&
        opening.name.object.type === "JSXIdentifier"
      ) {
        return `${opening.name.object.name}.${opening.name.property.name}`;
      }
    }
    current = current.parentPath;
  }
  return undefined;
}
