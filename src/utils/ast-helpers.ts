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
 * Check if a name follows PascalCase convention (starts with uppercase letter)
 * or is the special `__default__` sentinel used for anonymous default exports.
 * Used to distinguish React components from helper functions.
 */
export function isPascalCase(name: string): boolean {
  if (name === "__default__") return true;
  return /^[A-Z]/.test(name);
}

/**
 * Walk up the AST to find the enclosing top-level `const` declaration name.
 * Returns `undefined` if a function/arrow/class is encountered first (meaning
 * the path is inside a function body, not at module scope).
 */
export function getTopLevelConstName(
  path: NodePath<Node>,
): string | undefined {
  let current = path.parentPath;
  while (current) {
    // If we hit a function or class boundary before reaching a const declaration,
    // we're not at module level.
    if (
      current.isFunctionDeclaration() ||
      current.isFunctionExpression() ||
      current.isArrowFunctionExpression() ||
      current.isClassDeclaration() ||
      current.isClassExpression() ||
      current.isClassMethod() ||
      current.isClassPrivateMethod()
    ) {
      return undefined;
    }

    if (current.isVariableDeclarator()) {
      // Check that the parent VariableDeclaration is `const`
      const declParent = current.parentPath;
      if (
        declParent?.isVariableDeclaration() &&
        declParent.node.kind === "const"
      ) {
        // Check that the declaration is at program level or exported
        const grandParent = declParent.parentPath;
        if (
          grandParent?.isProgram() ||
          grandParent?.isExportNamedDeclaration()
        ) {
          const id = current.node.id;
          if (id.type === "Identifier") return id.name;
        }
      }
      return undefined;
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
