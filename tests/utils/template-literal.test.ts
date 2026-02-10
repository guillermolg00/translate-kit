import { describe, it, expect } from "vitest";
import {
  buildTemplateLiteralText,
  buildValuesObject,
} from "../../src/utils/template-literal.js";
import * as t from "@babel/types";

function makeQuasis(...strings: string[]): t.TemplateElement[] {
  return strings.map((s, i) =>
    t.templateElement({ raw: s, cooked: s }, i === strings.length - 1),
  );
}

describe("buildTemplateLiteralText", () => {
  it("handles simple Identifier: ${name} → {name}", () => {
    const quasis = makeQuasis("Hello ", "!");
    const expressions = [t.identifier("name")];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toEqual({
      text: "Hello {name}!",
      placeholders: ["name"],
    });
  });

  it("handles multiple expressions", () => {
    const quasis = makeQuasis("", " has ", " items");
    const expressions = [t.identifier("user"), t.identifier("count")];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toEqual({
      text: "{user} has {count} items",
      placeholders: ["user", "count"],
    });
  });

  it("handles MemberExpression: ${user.name} → {userName}", () => {
    const quasis = makeQuasis("Hello ", "");
    const expressions = [
      t.memberExpression(t.identifier("user"), t.identifier("name")),
    ];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toEqual({
      text: "Hello {userName}",
      placeholders: ["userName"],
    });
  });

  it("handles deep MemberExpression: ${a.b.c} → {aBC}", () => {
    const quasis = makeQuasis("Value: ", "");
    const expressions = [
      t.memberExpression(
        t.memberExpression(t.identifier("a"), t.identifier("b")),
        t.identifier("c"),
      ),
    ];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toEqual({
      text: "Value: {aBC}",
      placeholders: ["aBC"],
    });
  });

  it("handles no expressions (plain template literal)", () => {
    const quasis = makeQuasis("Hello world");
    const result = buildTemplateLiteralText(quasis, []);

    expect(result).toEqual({
      text: "Hello world",
      placeholders: [],
    });
  });

  it("returns null for unsupported expression (CallExpression)", () => {
    const quasis = makeQuasis("Hello ", "");
    const expressions = [
      t.callExpression(t.identifier("getName"), []),
    ];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toBeNull();
  });

  it("handles name collisions by adding numeric suffix", () => {
    const quasis = makeQuasis("Hello ", " and ", "");
    const expressions = [t.identifier("name"), t.identifier("name")];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toEqual({
      text: "Hello {name} and {name2}",
      placeholders: ["name", "name2"],
    });
  });

  it("returns null for computed MemberExpression", () => {
    const quasis = makeQuasis("Value: ", "");
    const expressions = [
      t.memberExpression(t.identifier("obj"), t.identifier("key"), true),
    ];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toBeNull();
  });

  it("returns null for binary expression", () => {
    const quasis = makeQuasis("Total: ", "");
    const expressions = [
      t.binaryExpression("+", t.identifier("a"), t.identifier("b")),
    ];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toBeNull();
  });

  it("handles mixed supported expressions", () => {
    const quasis = makeQuasis("Hi ", ", you have ", " in ", "");
    const expressions = [
      t.identifier("name"),
      t.identifier("count"),
      t.memberExpression(t.identifier("user"), t.identifier("account")),
    ];
    const result = buildTemplateLiteralText(quasis, expressions);

    expect(result).toEqual({
      text: "Hi {name}, you have {count} in {userAccount}",
      placeholders: ["name", "count", "userAccount"],
    });
  });
});

describe("buildValuesObject", () => {
  it("builds shorthand for matching identifier", () => {
    const expressions = [t.identifier("name")];
    const placeholders = ["name"];
    const obj = buildValuesObject(expressions, placeholders);

    expect(obj.type).toBe("ObjectExpression");
    expect(obj.properties).toHaveLength(1);
    const prop = obj.properties[0] as t.ObjectProperty;
    expect(prop.shorthand).toBe(true);
    expect((prop.key as t.Identifier).name).toBe("name");
  });

  it("builds non-shorthand for MemberExpression", () => {
    const expressions = [
      t.memberExpression(t.identifier("user"), t.identifier("name")),
    ];
    const placeholders = ["userName"];
    const obj = buildValuesObject(expressions, placeholders);

    expect(obj.properties).toHaveLength(1);
    const prop = obj.properties[0] as t.ObjectProperty;
    expect(prop.shorthand).toBe(false);
    expect((prop.key as t.Identifier).name).toBe("userName");
    expect(prop.value.type).toBe("MemberExpression");
  });
});
