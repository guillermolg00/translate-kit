import { describe, expect, it } from "vitest";
import { extractStrings } from "../../src/scanner/extractor.js";
import { parseFile } from "../../src/scanner/parser.js";

function extract(code: string) {
	const ast = parseFile(code, "test.tsx");
	return extractStrings(ast, "test.tsx");
}

describe("composite context", () => {
	it("captures composite context for mixed text+element children", () => {
		const code = `function App() {
  return <p>Assigned to <strong>someone</strong> on a date</p>;
}`;
		const strings = extract(code);
		const texts = strings.filter((s) => s.type === "jsx-text");

		// All JSXText fragments inside <p> should have compositeContext
		const withContext = texts.filter((s) => s.compositeContext);
		expect(withContext.length).toBeGreaterThan(0);
		expect(withContext[0].compositeContext).toContain("<strong>");
	});

	it("captures composite context with expression containers", () => {
		const code = `function App({ name, date }) {
  return <p>Assigned to <strong>{name}</strong> on {date}</p>;
}`;
		const strings = extract(code);
		const assignedTo = strings.find((s) => s.text === "Assigned to");
		expect(assignedTo?.compositeContext).toBeDefined();
		// <strong>{name}</strong> is a JSXElement child → numbered placeholder
		expect(assignedTo!.compositeContext).toContain("<strong>{1}</strong>");
		// {date} is a direct expression container child
		expect(assignedTo!.compositeContext).toContain("{date}");
	});

	it("does not set compositeContext when only text children", () => {
		const code = `function App() { return <p>Hello world</p>; }`;
		const strings = extract(code);
		expect(strings[0].compositeContext).toBeUndefined();
	});

	it("does not set compositeContext when only element children", () => {
		const code = `function App() { return <div><span>A</span><span>B</span></div>; }`;
		const strings = extract(code);
		// Strings inside <span> have a parent that only contains elements
		for (const s of strings) {
			expect(s.compositeContext).toBeUndefined();
		}
	});

	it("handles whitespace-only JSXText siblings correctly", () => {
		const code = `function App() {
  return (
    <div>
      <span>Hello</span>
      <span>World</span>
    </div>
  );
}`;
		const strings = extract(code);
		// The text is inside <span>, not in the whitespace-only <div> children
		for (const s of strings) {
			expect(s.compositeContext).toBeUndefined();
		}
	});

	it("builds template with numbered element placeholders", () => {
		const code = `function App() {
  return <p>Click <a>here</a> or <button>there</button> now</p>;
}`;
		const strings = extract(code);
		const click = strings.find((s) => s.text === "Click");
		expect(click?.compositeContext).toBeDefined();
		// Should contain numbered placeholders for the elements
		expect(click!.compositeContext).toContain("<a>{1}</a>");
		expect(click!.compositeContext).toContain("<button>{2}</button>");
	});

	it("uses variable name for expression containers", () => {
		const code = `function App({ count }) {
  return <p>You have {count} items</p>;
}`;
		const strings = extract(code);
		const youHave = strings.find((s) => s.text === "You have");
		expect(youHave?.compositeContext).toContain("{count}");
	});

	it("uses 'expr' for complex expressions", () => {
		const code = `function App() {
  return <p>Total is {getTotal()} dollars</p>;
}`;
		const strings = extract(code);
		const total = strings.find((s) => s.text === "Total is");
		expect(total?.compositeContext).toContain("{expr}");
	});
});
