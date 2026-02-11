import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "../../src/scanner/parser.js";
import { extractStrings } from "../../src/scanner/extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

function extractFromFixture(filename: string, translatableProps?: string[]) {
  const filePath = join(fixturesDir, filename);
  const code = readFileSync(filePath, "utf-8");
  const ast = parseFile(code, filename);
  return extractStrings(ast, filePath, translatableProps);
}

describe("extractor", () => {
  describe("simple-component.tsx", () => {
    it("extracts JSX text content", () => {
      const strings = extractFromFixture("simple-component.tsx");

      const texts = strings.map((s) => s.text);
      expect(texts).toContain("Welcome to our platform");
      expect(texts).toContain("Get started with your journey today");
      expect(texts).toContain("Sign up now");
    });

    it("identifies the component name", () => {
      const strings = extractFromFixture("simple-component.tsx");
      for (const s of strings) {
        expect(s.componentName).toBe("Hero");
      }
    });

    it("identifies parent tags", () => {
      const strings = extractFromFixture("simple-component.tsx");

      const h1String = strings.find((s) => s.text === "Welcome to our platform");
      expect(h1String?.parentTag).toBe("h1");

      const buttonString = strings.find((s) => s.text === "Sign up now");
      expect(buttonString?.parentTag).toBe("button");
    });

    it("sets correct type for JSX text", () => {
      const strings = extractFromFixture("simple-component.tsx");
      for (const s of strings) {
        expect(s.type).toBe("jsx-text");
      }
    });
  });

  describe("component-with-props.tsx", () => {
    it("extracts translatable attributes", () => {
      const strings = extractFromFixture("component-with-props.tsx");

      const texts = strings.map((s) => s.text);
      expect(texts).toContain("Search for anything...");
      expect(texts).toContain("Search input");
      expect(texts).toContain("Company logo");
      expect(texts).toContain("Our company");
    });

    it("does NOT extract non-translatable attributes", () => {
      const strings = extractFromFixture("component-with-props.tsx");
      const texts = strings.map((s) => s.text);

      expect(texts).not.toContain("text");         // type
      expect(texts).not.toContain("search-input");  // className
      expect(texts).not.toContain("query");          // name
      expect(texts).not.toContain("/logo.png");      // src
    });

    it("identifies prop names for attributes", () => {
      const strings = extractFromFixture("component-with-props.tsx");

      const placeholder = strings.find(
        (s) => s.text === "Search for anything...",
      );
      expect(placeholder?.propName).toBe("placeholder");
      expect(placeholder?.type).toBe("jsx-attribute");

      const alt = strings.find((s) => s.text === "Company logo");
      expect(alt?.propName).toBe("alt");
    });

    it("also extracts JSX text (link text)", () => {
      const strings = extractFromFixture("component-with-props.tsx");
      const link = strings.find((s) => s.text === "Visit our website");
      expect(link).toBeDefined();
      expect(link?.type).toBe("jsx-text");
    });
  });

  describe("filters", () => {
    it("ignores whitespace-only text", () => {
      const code = `function App() { return <div>   </div>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");
      expect(strings).toHaveLength(0);
    });

    it("extracts non-Latin text (Japanese, Chinese, Korean, Arabic)", () => {
      const code = `function App() { return <><h1>こんにちは</h1><p>مرحبا</p><p>안녕하세요</p><p>你好世界</p></>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");
      const texts = strings.map((s) => s.text);
      expect(texts).toContain("こんにちは");
      expect(texts).toContain("مرحبا");
      expect(texts).toContain("안녕하세요");
      expect(texts).toContain("你好世界");
    });

    it("still ignores strings with no letters (symbols, numbers)", () => {
      const code = `function App() { return <><p>123.45</p><p>---</p><p>$€£</p></>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");
      expect(strings).toHaveLength(0);
    });

    it("ignores script and style tags", () => {
      const code = `function App() { return <><script>code here</script><style>css here</style><p>Real text</p></>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");
      expect(strings).toHaveLength(1);
      expect(strings[0].text).toBe("Real text");
    });
  });

  describe("inline-component.tsx", () => {
    it("extracts T-component with id", () => {
      const strings = extractFromFixture("inline-component.tsx");

      const tComponents = strings.filter((s) => s.type === "T-component");
      expect(tComponents).toHaveLength(3);
      expect(tComponents[0].text).toBe("Welcome to our platform");
      expect(tComponents[0].id).toBe("hero.welcome");
      expect(tComponents[1].text).toBe("Get started with your journey today");
      expect(tComponents[1].id).toBe("hero.getStarted");
      expect(tComponents[2].text).toBe("Sign up now");
      expect(tComponents[2].id).toBe("common.signUp");
    });

    it("extracts inline t(text, id) calls", () => {
      const strings = extractFromFixture("inline-component.tsx");

      const tCalls = strings.filter((s) => s.type === "t-call" && s.id);
      expect(tCalls).toHaveLength(1);
      expect(tCalls[0].text).toBe("Search...");
      expect(tCalls[0].id).toBe("common.searchPlaceholder");
    });

    it("extracts bare strings not yet wrapped", () => {
      const strings = extractFromFixture("inline-component.tsx");

      const jsxText = strings.filter((s) => s.type === "jsx-text");
      expect(jsxText).toHaveLength(1);
      expect(jsxText[0].text).toBe("This is a new string");
    });
  });

  describe("T-component extraction", () => {
    it("extracts T-component without id", () => {
      const code = `function App() { return <T>Hello World</T>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const tComp = strings.find((s) => s.type === "T-component");
      expect(tComp).toBeDefined();
      expect(tComp?.text).toBe("Hello World");
      expect(tComp?.id).toBeUndefined();
    });

    it("does not extract T-component with empty text", () => {
      const code = `function App() { return <T id="k">{variable}</T>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const tComp = strings.filter((s) => s.type === "T-component");
      expect(tComp).toHaveLength(0);
    });
  });

  describe("object properties", () => {
    it("extracts strings from content properties in objects", () => {
      const code = `function Features() {
        const items = [
          { icon: Star, title: "Project Management", description: "Manage your projects." },
        ];
        return <div />;
      }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const titles = strings.filter((s) => s.type === "object-property");
      expect(titles).toHaveLength(2);
      expect(titles.map((s) => s.text)).toContain("Project Management");
      expect(titles.map((s) => s.text)).toContain("Manage your projects.");
    });

    it("does not extract non-content properties", () => {
      const code = `function App() {
        const config = { icon: "star", className: "red", href: "/about" };
        return <div />;
      }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const objProps = strings.filter((s) => s.type === "object-property");
      expect(objProps).toHaveLength(0);
    });

    it("does not extract object properties inside non-component callbacks", () => {
      const code = `const MyMark = SomeLib.create(() => {
        return { title: "Project Management" };
      });
      function App() { return <div />; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const objProps = strings.filter((s) => s.type === "object-property");
      expect(objProps).toHaveLength(0);
    });

    it("records propName for object properties", () => {
      const code = `function App() {
        const item = { title: "Hello World" };
        return <div />;
      }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const prop = strings.find((s) => s.type === "object-property");
      expect(prop?.propName).toBe("title");
    });

    it("does not set moduleLevel for function-level properties", () => {
      const code = `function App() {
        const item = { title: "Hello World" };
        return <div />;
      }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const prop = strings.find((s) => s.type === "object-property");
      expect(prop?.moduleLevel).toBeUndefined();
    });
  });

  describe("template literals", () => {
    it("extracts template literal in JSX expression", () => {
      const code = "function App({ name }) { return <p>{`Hello ${name}`}</p>; }";
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const expr = strings.find((s) => s.type === "jsx-expression");
      expect(expr).toBeDefined();
      expect(expr?.text).toBe("Hello {name}");
    });

    it("extracts template literal in JSX attribute", () => {
      const code = "function App({ type }) { return <input placeholder={`Search ${type}`} />; }";
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const attr = strings.find((s) => s.type === "jsx-attribute");
      expect(attr).toBeDefined();
      expect(attr?.text).toBe("Search {type}");
      expect(attr?.propName).toBe("placeholder");
    });

    it("extracts template literal in object property", () => {
      const code = "function App({ id }) { const item = { title: `Task ${id}` }; return <div />; }";
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const prop = strings.find((s) => s.type === "object-property");
      expect(prop).toBeDefined();
      expect(prop?.text).toBe("Task {id}");
    });

    it("extracts plain template literal (no expressions)", () => {
      const code = "function App() { return <p>{`Hello world`}</p>; }";
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const expr = strings.find((s) => s.type === "jsx-expression");
      expect(expr).toBeDefined();
      expect(expr?.text).toBe("Hello world");
    });

    it("extracts template literal with MemberExpression", () => {
      const code = "function App({ user }) { return <p>{`Welcome ${user.name}`}</p>; }";
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const expr = strings.find((s) => s.type === "jsx-expression");
      expect(expr).toBeDefined();
      expect(expr?.text).toBe("Welcome {userName}");
    });

    it("ignores template literal with unsupported expression", () => {
      const code = "function App() { return <p>{`Hello ${getName()}`}</p>; }";
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const expr = strings.find((s) => s.type === "jsx-expression");
      expect(expr).toBeUndefined();
    });
  });

  describe("conditional expressions", () => {
    it("extracts both branches of ternary in JSX expression", () => {
      const code = `function App({ isAdmin }) { return <p>{isAdmin ? "Admin Panel" : "Dashboard"}</p>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const exprs = strings.filter((s) => s.type === "jsx-expression");
      expect(exprs).toHaveLength(2);
      expect(exprs.map((s) => s.text)).toContain("Admin Panel");
      expect(exprs.map((s) => s.text)).toContain("Dashboard");
    });

    it("extracts ternary in JSX attribute", () => {
      const code = `function App({ isAdmin }) { return <input placeholder={isAdmin ? "Search users" : "Search items"} />; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const attrs = strings.filter((s) => s.type === "jsx-attribute");
      expect(attrs).toHaveLength(2);
      expect(attrs.map((s) => s.text)).toContain("Search users");
      expect(attrs.map((s) => s.text)).toContain("Search items");
      expect(attrs[0].propName).toBe("placeholder");
    });

    it("extracts ternary in object property", () => {
      const code = `function App({ isAdmin }) {
        const item = { title: isAdmin ? "Admin" : "User" };
        return <div />;
      }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const props = strings.filter((s) => s.type === "object-property");
      expect(props).toHaveLength(2);
      expect(props.map((s) => s.text)).toContain("Admin");
      expect(props.map((s) => s.text)).toContain("User");
    });

    it("extracts only string branch when other is variable (mixed)", () => {
      const code = `function App({ isAdmin, role }) { return <p>{isAdmin ? "Admin" : role}</p>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const exprs = strings.filter((s) => s.type === "jsx-expression");
      expect(exprs).toHaveLength(1);
      expect(exprs[0].text).toBe("Admin");
    });

    it("extracts nested ternaries", () => {
      const code = `function App({ a, b }) { return <p>{a ? "Admin" : b ? "Editor" : "Viewer"}</p>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const exprs = strings.filter((s) => s.type === "jsx-expression");
      expect(exprs).toHaveLength(3);
      const texts = exprs.map((s) => s.text);
      expect(texts).toContain("Admin");
      expect(texts).toContain("Editor");
      expect(texts).toContain("Viewer");
    });

    it("extracts ternary with TemplateLiteral branch", () => {
      const code = "function App({ isAdmin, name }) { return <p>{isAdmin ? `Hello ${name}` : \"Guest\"}</p>; }";
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const exprs = strings.filter((s) => s.type === "jsx-expression");
      expect(exprs).toHaveLength(2);
      expect(exprs.map((s) => s.text)).toContain("Hello {name}");
      expect(exprs.map((s) => s.text)).toContain("Guest");
    });

    it("extracts nothing when both branches are non-string", () => {
      const code = `function App({ isAdmin, count, total }) { return <p>{isAdmin ? count : total}</p>; }`;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const exprs = strings.filter((s) => s.type === "jsx-expression");
      expect(exprs).toHaveLength(0);
    });
  });

  describe("module-level object properties", () => {
    it("does not extract module-level object properties", () => {
      const code = `
        const DEFAULT_VIEWS = [
          { title: "My Tasks", description: "View your tasks" },
        ];
        function App() { return <div />; }
      `;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const objProps = strings.filter((s) => s.type === "object-property");
      expect(objProps).toHaveLength(0);
    });

    it("does not extract non-content properties at module level", () => {
      const code = `
        const ITEMS = [{ name: "Dashboard", icon: "star" }];
        function App() { return <div />; }
      `;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const objProps = strings.filter((s) => s.type === "object-property");
      expect(objProps).toHaveLength(0);
    });

    it("handles mixed module and function level properties", () => {
      const code = `
        const DEFAULTS = [{ title: "Module Title" }];
        function App() {
          const items = [{ title: "Function Title" }];
          return <div />;
        }
      `;
      const ast = parseFile(code, "test.tsx");
      const strings = extractStrings(ast, "test.tsx");

      const objProps = strings.filter((s) => s.type === "object-property");
      expect(objProps).toHaveLength(1);
      expect(objProps[0].text).toBe("Function Title");
    });
  });
});
