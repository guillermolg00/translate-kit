import { describe, it, expect } from "vitest";
import { flatten, unflatten } from "../src/flatten.js";

describe("flatten", () => {
  it("flattens a simple nested object", () => {
    const input = { a: { b: "hello" } };
    expect(flatten(input)).toEqual({ "a.b": "hello" });
  });

  it("flattens deeply nested objects", () => {
    const input = { a: { b: { c: { d: "deep" } } } };
    expect(flatten(input)).toEqual({ "a.b.c.d": "deep" });
  });

  it("handles multiple keys at same level", () => {
    const input = {
      common: {
        save: "Save",
        cancel: "Cancel",
      },
    };
    expect(flatten(input)).toEqual({
      "common.save": "Save",
      "common.cancel": "Cancel",
    });
  });

  it("handles top-level strings", () => {
    const input = { title: "Hello", subtitle: "World" };
    expect(flatten(input)).toEqual({ title: "Hello", subtitle: "World" });
  });

  it("skips arrays", () => {
    const input = { items: ["a", "b"], name: "test" };
    expect(flatten(input)).toEqual({ name: "test" });
  });

  it("skips non-string primitives", () => {
    const input = { count: 5, flag: true, name: "test" } as Record<
      string,
      unknown
    >;
    expect(flatten(input)).toEqual({ name: "test" });
  });

  it("returns empty object for empty input", () => {
    expect(flatten({})).toEqual({});
  });

  it("handles mixed nesting", () => {
    const input = {
      app: { title: "My App" },
      footer: "Copyright",
      nav: { home: "Home", about: { title: "About Us" } },
    };
    expect(flatten(input)).toEqual({
      "app.title": "My App",
      footer: "Copyright",
      "nav.home": "Home",
      "nav.about.title": "About Us",
    });
  });
});

describe("unflatten", () => {
  it("unflattens a simple dotted key", () => {
    const input = { "a.b": "hello" };
    expect(unflatten(input)).toEqual({ a: { b: "hello" } });
  });

  it("unflattens deeply nested keys", () => {
    const input = { "a.b.c.d": "deep" };
    expect(unflatten(input)).toEqual({ a: { b: { c: { d: "deep" } } } });
  });

  it("groups keys under same parent", () => {
    const input = {
      "common.save": "Save",
      "common.cancel": "Cancel",
    };
    expect(unflatten(input)).toEqual({
      common: { save: "Save", cancel: "Cancel" },
    });
  });

  it("handles top-level keys", () => {
    const input = { title: "Hello", subtitle: "World" };
    expect(unflatten(input)).toEqual({ title: "Hello", subtitle: "World" });
  });

  it("returns empty object for empty input", () => {
    expect(unflatten({})).toEqual({});
  });

  it("roundtrips with flatten", () => {
    const original = {
      app: { title: "My App" },
      footer: "Copyright",
      nav: { home: "Home", about: { title: "About Us" } },
    };
    expect(unflatten(flatten(original))).toEqual(original);
  });
});
