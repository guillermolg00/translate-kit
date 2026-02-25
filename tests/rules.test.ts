import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertMarkdownSection } from "../src/rules.js";
import type { RuleContext } from "../src/templates/rules-templates.js";
import {
	generateClaudeMdRule,
	generateCopilotRule,
	generateCursorRule,
	generateRuleContent,
} from "../src/templates/rules-templates.js";

const baseCtx: RuleContext = {
	messagesDir: "./messages",
	sourceLocale: "en",
	targetLocales: ["es", "fr"],
	mode: "keys",
	scanInclude: ["src/**/*.tsx"],
};

describe("generateRuleContent", () => {
	it("interpolates messagesDir", () => {
		const result = generateRuleContent(baseCtx);
		expect(result).toContain("./messages");
	});

	it("interpolates locales", () => {
		const result = generateRuleContent(baseCtx);
		expect(result).toContain("en, es, fr");
	});

	it("shows keys mode description", () => {
		const result = generateRuleContent(baseCtx);
		expect(result).toContain("keys mode");
		expect(result).toContain("t()");
	});

	it("shows inline mode description", () => {
		const result = generateRuleContent({ ...baseCtx, mode: "inline" });
		expect(result).toContain("inline mode");
		expect(result).toContain("<T>");
	});

	it("includes scan patterns when provided", () => {
		const result = generateRuleContent(baseCtx);
		expect(result).toContain("`src/**/*.tsx`");
	});

	it("omits scan patterns when not provided", () => {
		const result = generateRuleContent({
			...baseCtx,
			scanInclude: undefined,
		});
		expect(result).not.toContain("Scanned files");
	});

	it("lists do-not-edit files", () => {
		const result = generateRuleContent(baseCtx);
		expect(result).toContain(".translate-map.json");
		expect(result).toContain(".translate-lock.json");
		expect(result).toContain(".translate-context.json");
	});

	it("includes useful flags", () => {
		const result = generateRuleContent(baseCtx);
		expect(result).toContain("--dry-run");
		expect(result).toContain("--force");
		expect(result).toContain("--locale");
	});
});

describe("generateCursorRule", () => {
	it("includes frontmatter", () => {
		const result = generateCursorRule(baseCtx);
		expect(result).toMatch(/^---\n/);
		expect(result).toContain("description:");
		expect(result).toContain("globs:");
	});

	it("includes scan patterns in globs", () => {
		const result = generateCursorRule(baseCtx);
		expect(result).toContain("  - src/**/*.tsx");
	});

	it("uses default globs when no scanInclude", () => {
		const result = generateCursorRule({ ...baseCtx, scanInclude: undefined });
		expect(result).toContain("  - **/*.tsx");
		expect(result).toContain("  - **/*.jsx");
	});
});

describe("generateClaudeMdRule", () => {
	it("starts with ## translate-kit heading", () => {
		const result = generateClaudeMdRule(baseCtx);
		expect(result).toMatch(/^## translate-kit\n/);
	});
});

describe("generateCopilotRule", () => {
	it("starts with ## translate-kit heading", () => {
		const result = generateCopilotRule(baseCtx);
		expect(result).toMatch(/^## translate-kit\n/);
	});
});

describe("upsertMarkdownSection", () => {
	it("appends to empty content", () => {
		const result = upsertMarkdownSection("", "## translate-kit", "## translate-kit\n\nNew content.\n");
		expect(result).toBe("## translate-kit\n\nNew content.\n");
	});

	it("appends to existing content without the section", () => {
		const existing = "# My Project\n\nSome description.\n";
		const result = upsertMarkdownSection(
			existing,
			"## translate-kit",
			"## translate-kit\n\nNew content.\n",
		);
		expect(result).toContain("# My Project");
		expect(result).toContain("Some description.");
		expect(result).toContain("## translate-kit");
		expect(result).toContain("New content.");
	});

	it("replaces existing section", () => {
		const existing = "# My Project\n\n## translate-kit\n\nOld content.\n";
		const result = upsertMarkdownSection(
			existing,
			"## translate-kit",
			"## translate-kit\n\nUpdated content.\n",
		);
		expect(result).toContain("Updated content.");
		expect(result).not.toContain("Old content.");
	});

	it("replaces section in the middle of file", () => {
		const existing =
			"# My Project\n\n## translate-kit\n\nOld content.\n\n## Other Section\n\nKeep this.\n";
		const result = upsertMarkdownSection(
			existing,
			"## translate-kit",
			"## translate-kit\n\nUpdated content.\n",
		);
		expect(result).toContain("Updated content.");
		expect(result).not.toContain("Old content.");
		expect(result).toContain("## Other Section");
		expect(result).toContain("Keep this.");
	});

	it("preserves content before and after the section", () => {
		const existing =
			"# Title\n\nIntro paragraph.\n\n## translate-kit\n\nOld stuff here.\n\n## Dependencies\n\nSome deps.\n";
		const result = upsertMarkdownSection(
			existing,
			"## translate-kit",
			"## translate-kit\n\nNew stuff.\n",
		);
		expect(result).toContain("# Title");
		expect(result).toContain("Intro paragraph.");
		expect(result).toContain("## translate-kit\n\nNew stuff.");
		expect(result).toContain("## Dependencies");
		expect(result).toContain("Some deps.");
	});
});
