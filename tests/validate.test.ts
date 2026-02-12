import { describe, expect, it } from "vitest";
import {
	extractPlaceholders,
	validateBatch,
	validatePlaceholders,
} from "../src/validate.js";

describe("extractPlaceholders", () => {
	it("extracts single brace placeholders", () => {
		expect(extractPlaceholders("Hello {name}!")).toEqual(["{name}"]);
	});

	it("extracts double brace placeholders", () => {
		expect(extractPlaceholders("Count: {{count}}")).toEqual(["{{count}}"]);
	});

	it("extracts numbered placeholders", () => {
		expect(extractPlaceholders("{0} and {1}")).toEqual(["{0}", "{1}"]);
	});

	it("extracts printf-style placeholders", () => {
		expect(extractPlaceholders("Hello %s, you have %d items")).toEqual([
			"%d",
			"%s",
		]);
	});

	it("extracts printf float format", () => {
		expect(extractPlaceholders("Price: %.2f")).toEqual(["%.2f"]);
	});

	it("extracts HTML tags", () => {
		expect(extractPlaceholders("Click <strong>here</strong> or <br/>")).toEqual(
			["</strong>", "<br/>", "<strong>"],
		);
	});

	it("extracts mixed placeholders", () => {
		const result = extractPlaceholders(
			"Hello {name}, you have %d <strong>items</strong>",
		);
		expect(result).toEqual(["%d", "</strong>", "<strong>", "{name}"]);
	});

	it("returns empty array for no placeholders", () => {
		expect(extractPlaceholders("Hello world")).toEqual([]);
	});

	it("handles duplicates", () => {
		expect(extractPlaceholders("{name} greeted {name}")).toEqual([
			"{name}",
			"{name}",
		]);
	});

	it("extracts self-closing HTML tags", () => {
		expect(extractPlaceholders("Line 1<br/>Line 2")).toEqual(["<br/>"]);
	});
});

describe("validatePlaceholders", () => {
	it("passes when placeholders are preserved", () => {
		const result = validatePlaceholders("Hello {name}!", "Hola {name}!");
		expect(result.valid).toBe(true);
		expect(result.missing).toEqual([]);
		expect(result.extra).toEqual([]);
	});

	it("detects missing placeholders", () => {
		const result = validatePlaceholders("Hello {name}!", "Hola!");
		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(["{name}"]);
	});

	it("detects extra placeholders", () => {
		const result = validatePlaceholders("Hello!", "Hola {name}!");
		expect(result.valid).toBe(false);
		expect(result.extra).toEqual(["{name}"]);
	});

	it("passes when placeholders are reordered", () => {
		const result = validatePlaceholders(
			"{first} and {second}",
			"{second} y {first}",
		);
		expect(result.valid).toBe(true);
	});

	it("detects missing duplicate placeholders", () => {
		const result = validatePlaceholders(
			"{name} greeted {name}",
			"{name} saludó",
		);
		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(["{name}"]);
	});

	it("validates HTML tags", () => {
		const result = validatePlaceholders(
			"Click <strong>here</strong>",
			"Haz clic <strong>aquí</strong>",
		);
		expect(result.valid).toBe(true);
	});

	it("detects missing HTML tags", () => {
		const result = validatePlaceholders(
			"Click <strong>here</strong>",
			"Haz clic aquí",
		);
		expect(result.valid).toBe(false);
		expect(result.missing).toContain("<strong>");
		expect(result.missing).toContain("</strong>");
	});
});

describe("validateBatch", () => {
	it("passes when all entries are valid", () => {
		const result = validateBatch(
			{ greeting: "Hello {name}", count: "You have %d items" },
			{ greeting: "Hola {name}", count: "Tienes %d elementos" },
		);
		expect(result.valid).toBe(true);
		expect(result.failures).toEqual([]);
	});

	it("reports failures for invalid entries", () => {
		const result = validateBatch(
			{ greeting: "Hello {name}", simple: "Hello" },
			{ greeting: "Hola", simple: "Hola" },
		);
		expect(result.valid).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].key).toBe("greeting");
		expect(result.failures[0].missing).toEqual(["{name}"]);
	});

	it("handles empty entries", () => {
		const result = validateBatch({}, {});
		expect(result.valid).toBe(true);
		expect(result.failures).toEqual([]);
	});
});
