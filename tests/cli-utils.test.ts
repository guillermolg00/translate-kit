import { describe, expect, it } from "vitest";
import { parseTranslateFlags, validateLocale } from "../src/cli-utils.js";

describe("parseTranslateFlags", () => {
	it("returns all false/undefined when no flags given", () => {
		expect(parseTranslateFlags([])).toEqual({
			dryRun: false,
			force: false,
			verbose: false,
			locale: undefined,
		});
	});

	it("parses --dry-run", () => {
		const result = parseTranslateFlags(["--dry-run"]);
		expect(result.dryRun).toBe(true);
		expect(result.force).toBe(false);
		expect(result.verbose).toBe(false);
	});

	it("parses --force", () => {
		const result = parseTranslateFlags(["--force"]);
		expect(result.force).toBe(true);
		expect(result.dryRun).toBe(false);
	});

	it("parses --verbose", () => {
		const result = parseTranslateFlags(["--verbose"]);
		expect(result.verbose).toBe(true);
	});

	it("parses --locale with value", () => {
		const result = parseTranslateFlags(["--locale", "es"]);
		expect(result.locale).toBe("es");
	});

	it("returns undefined when --locale has no value", () => {
		const result = parseTranslateFlags(["--locale"]);
		expect(result.locale).toBeUndefined();
	});

	it("parses --locale=es format", () => {
		const result = parseTranslateFlags(["--locale=es"]);
		expect(result.locale).toBe("es");
	});

	it("returns undefined for --locale= with empty value", () => {
		const result = parseTranslateFlags(["--locale="]);
		expect(result.locale).toBeUndefined();
	});

	it("returns undefined when --locale is followed by another flag", () => {
		const result = parseTranslateFlags(["--locale", "--dry-run"]);
		expect(result.locale).toBeUndefined();
		expect(result.dryRun).toBe(true);
	});

	it("parses multiple flags combined", () => {
		const result = parseTranslateFlags([
			"--dry-run",
			"--force",
			"--verbose",
			"--locale",
			"pt-BR",
		]);
		expect(result).toEqual({
			dryRun: true,
			force: true,
			verbose: true,
			locale: "pt-BR",
		});
	});
});

describe("validateLocale", () => {
	it.each([
		"es",
		"pt-BR",
		"zh_Hans",
		"en123",
	])("accepts valid locale %s", (locale) => {
		expect(validateLocale(locale)).toBe(true);
	});

	it("rejects path traversal", () => {
		expect(validateLocale("../etc/passwd")).toBe(false);
	});

	it("rejects nested path traversal", () => {
		expect(validateLocale("es/../../foo")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(validateLocale("")).toBe(false);
	});

	it("rejects spaces", () => {
		expect(validateLocale("locale with spaces")).toBe(false);
	});

	it("rejects shell injection", () => {
		expect(validateLocale("es;rm -rf")).toBe(false);
	});
});
