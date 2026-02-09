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
  });
});
