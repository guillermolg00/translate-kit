import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateNextIntlTypes } from "../src/typegen.js";

describe("generateNextIntlTypes", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "typegen-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("generates next-intl.d.ts with correct content", async () => {
		await generateNextIntlTypes(tempDir, "en");

		const content = await readFile(join(tempDir, "next-intl.d.ts"), "utf-8");

		expect(content).toContain('import messages from "./en.json"');
		expect(content).toContain('declare module "next-intl"');
		expect(content).toContain("interface AppConfig");
		expect(content).toContain("Messages: typeof messages");
	});

	it("uses the provided source locale in the import path", async () => {
		await generateNextIntlTypes(tempDir, "es");

		const content = await readFile(join(tempDir, "next-intl.d.ts"), "utf-8");

		expect(content).toContain('import messages from "./es.json"');
	});

	it("creates the messages directory if it does not exist", async () => {
		const nestedDir = join(tempDir, "messages", "i18n");

		await generateNextIntlTypes(nestedDir, "en");

		const content = await readFile(join(nestedDir, "next-intl.d.ts"), "utf-8");
		expect(content).toContain('import messages from "./en.json"');
	});

	it("overwrites existing next-intl.d.ts", async () => {
		await writeFile(join(tempDir, "next-intl.d.ts"), "old content", "utf-8");

		await generateNextIntlTypes(tempDir, "en");

		const content = await readFile(join(tempDir, "next-intl.d.ts"), "utf-8");
		expect(content).not.toContain("old content");
		expect(content).toContain("Messages: typeof messages");
	});

	it("generates per-namespace imports in split mode", async () => {
		const sourceDir = join(tempDir, "en");
		await mkdir(sourceDir, { recursive: true });
		await writeFile(
			join(sourceDir, "hero.json"),
			'{"welcome":"Welcome"}',
			"utf-8",
		);
		await writeFile(join(sourceDir, "common.json"), '{"save":"Save"}', "utf-8");

		await generateNextIntlTypes(tempDir, "en", true);

		const content = await readFile(join(tempDir, "next-intl.d.ts"), "utf-8");

		expect(content).toContain('import common from "./en/common.json"');
		expect(content).toContain('import hero from "./en/hero.json"');
		expect(content).toContain("common: typeof common;");
		expect(content).toContain("hero: typeof hero;");
		expect(content).toContain("type Messages");
		expect(content).toContain('declare module "next-intl"');
	});

	it("generates Record<string, never> in split mode with no files", async () => {
		await generateNextIntlTypes(tempDir, "en", true);

		const content = await readFile(join(tempDir, "next-intl.d.ts"), "utf-8");

		expect(content).toContain("Record<string, never>");
		expect(content).toContain('declare module "next-intl"');
		expect(content).not.toContain("import ");
	});
});
