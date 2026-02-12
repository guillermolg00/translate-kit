import { describe, expect, it } from "vitest";
import {
	deriveRoutePath,
	enrichStrings,
} from "../../src/scanner/context-enricher.js";
import type { ExtractedString } from "../../src/types.js";

describe("deriveRoutePath", () => {
	it("extracts route from Next.js app router", () => {
		expect(deriveRoutePath("src/app/dashboard/page.tsx")).toBe("dashboard");
		expect(deriveRoutePath("src/app/settings/profile/page.tsx")).toBe(
			"settings.profile",
		);
	});

	it("extracts route from Next.js pages router", () => {
		expect(deriveRoutePath("src/pages/about.tsx")).toBe("about");
		expect(deriveRoutePath("pages/contact.tsx")).toBe("contact");
		expect(deriveRoutePath("src/pages/blog/index.tsx")).toBe("blog");
	});

	it("extracts section from components path", () => {
		expect(deriveRoutePath("src/components/auth/LoginForm.tsx")).toBe("auth");
		expect(deriveRoutePath("src/components/dashboard/Chart.tsx")).toBe(
			"dashboard",
		);
	});

	it("extracts route from app router without src/ prefix", () => {
		expect(deriveRoutePath("app/about/page.tsx")).toBe("about");
		expect(deriveRoutePath("app/blog/posts/page.tsx")).toBe("blog.posts");
	});

	it("extracts section from components path without src/ prefix", () => {
		expect(deriveRoutePath("components/hero/Hero.tsx")).toBe("hero");
		expect(deriveRoutePath("components/auth/LoginForm.tsx")).toBe("auth");
	});

	it("returns undefined for unrecognized paths", () => {
		expect(deriveRoutePath("src/utils/helpers.ts")).toBeUndefined();
		expect(deriveRoutePath("lib/config.ts")).toBeUndefined();
	});
});

describe("enrichStrings", () => {
	const makeStr = (
		overrides: Partial<ExtractedString> = {},
	): ExtractedString => ({
		text: "Hello",
		type: "jsx-text",
		file: "src/components/auth/Login.tsx",
		line: 1,
		column: 0,
		...overrides,
	});

	it("adds routePath from file path", () => {
		const strings = [makeStr()];
		const result = enrichStrings(strings, "src/app/dashboard/page.tsx");
		expect(result[0].routePath).toBe("dashboard");
	});

	it("adds siblingTexts from same component (capped at 5)", () => {
		const strings = Array.from({ length: 8 }, (_, i) =>
			makeStr({ text: `text${i}`, componentName: "MyComp" }),
		);
		const result = enrichStrings(strings, "src/components/auth/Login.tsx");
		// First string should have max 5 siblings
		expect(result[0].siblingTexts).toHaveLength(5);
		expect(result[0].siblingTexts).not.toContain("text0"); // excludes self
	});

	it("detects sectionHeading from h1-h3 tags", () => {
		const strings = [
			makeStr({ text: "Welcome", parentTag: "h1", componentName: "Hero" }),
			makeStr({
				text: "Click here",
				parentTag: "button",
				componentName: "Hero",
			}),
		];
		const result = enrichStrings(strings, "src/components/hero/Hero.tsx");
		// h1 string itself should not get its own text as sectionHeading
		expect(result[0].sectionHeading).toBeUndefined();
		// Other strings should get the heading
		expect(result[1].sectionHeading).toBe("Welcome");
	});

	it("does not add siblingTexts when alone in component", () => {
		const strings = [makeStr({ componentName: "Solo" })];
		const result = enrichStrings(strings, "src/components/solo/Solo.tsx");
		expect(result[0].siblingTexts).toBeUndefined();
	});

	it("does not add routePath for unrecognized paths", () => {
		const strings = [makeStr()];
		const result = enrichStrings(strings, "lib/utils.ts");
		expect(result[0].routePath).toBeUndefined();
	});
});
