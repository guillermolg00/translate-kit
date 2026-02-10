import type { Expression, TemplateLiteral } from "@babel/types";
import * as t from "@babel/types";

export interface TemplateLiteralInfo {
  text: string;
  placeholders: string[];
}

function memberExpressionToName(node: Expression): string | null {
  if (node.type === "Identifier") return node.name;
  if (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier"
  ) {
    const objectName = memberExpressionToName(node.object as Expression);
    if (!objectName) return null;
    const prop = node.property.name;
    return objectName + prop.charAt(0).toUpperCase() + prop.slice(1);
  }
  return null;
}

export function buildTemplateLiteralText(
  quasis: TemplateLiteral["quasis"],
  expressions: TemplateLiteral["expressions"],
): TemplateLiteralInfo | null {
  const placeholders: string[] = [];
  const usedNames = new Set<string>();
  let text = "";

  for (let i = 0; i < quasis.length; i++) {
    text += quasis[i].value.cooked ?? quasis[i].value.raw;

    if (i < expressions.length) {
      const expr = expressions[i];
      let name: string | null = null;

      if (expr.type === "Identifier") {
        name = expr.name;
      } else if (expr.type === "MemberExpression") {
        name = memberExpressionToName(expr);
      }

      if (name === null) return null;

      let finalName = name;
      if (usedNames.has(finalName)) {
        let suffix = 2;
        while (usedNames.has(`${name}${suffix}`)) suffix++;
        finalName = `${name}${suffix}`;
      }

      usedNames.add(finalName);
      placeholders.push(finalName);
      text += `{${finalName}}`;
    }
  }

  return { text, placeholders };
}

export function buildValuesObject(
  expressions: TemplateLiteral["expressions"],
  placeholders: string[],
): t.ObjectExpression {
  const properties = placeholders.map((name, i) => {
    const expr = expressions[i] as Expression;
    const isShorthand =
      expr.type === "Identifier" && expr.name === name;

    return t.objectProperty(
      t.identifier(name),
      t.cloneNode(expr),
      false,
      isShorthand,
    );
  });

  return t.objectExpression(properties);
}
