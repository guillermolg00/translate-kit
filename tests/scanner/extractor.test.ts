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
});
