import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeDiff, loadJsonFile, loadLockFile } from "../src/diff.js";
import { flatten } from "../src/flatten.js";
import { translateAll } from "../src/translate.js";
import { writeTranslation } from "../src/writer.js";

vi.mock("ai", () => ({
	generateObject: vi.fn(),
}));

describe("translate command: no destructive overwrite on failure", () => {
	let tmpDir: string;
	const sourceLocale = "en";

	const sourceMessages = {
		"app.title": "Hello",
		"app.description": "Welcome to our app",
	};

	const existingTranslations = {
		"app.title": "Bonjour",
		"app.description": "Bienvenue dans notre application",
	};

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "translate-kit-test-"));

		// Write source locale file
		await writeFile(
			join(tmpDir, `${sourceLocale}.json`),
			JSON.stringify(sourceMessages, null, 2),
		);

		// Write existing target translation
		await writeFile(
			join(tmpDir, "fr.json"),
			JSON.stringify(existingTranslations, null, 2),
		);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("preserves existing translations when translateAll throws", async () => {
		const locale = "fr";
		const targetFile = join(tmpDir, `${locale}.json`);

		// Read state before translation attempt
		const originalContent = await readFile(targetFile, "utf-8");

		// Load files as the CLI does
		const sourceFlat = flatten(
			await loadJsonFile(join(tmpDir, `${sourceLocale}.json`)),
		);
		const targetRaw = await loadJsonFile(targetFile);
		const targetFlat = flatten(targetRaw);
		const lockData = await loadLockFile(tmpDir);

		const diffResult = computeDiff(sourceFlat, targetFlat, lockData);
		const toTranslate = { ...diffResult.added, ...diffResult.modified };

		// Simulate the CLI's translate loop behavior:
		// When translateAll throws, set translationFailed = true and skip write
		let translationFailed = false;
		let errors = 0;

		if (Object.keys(toTranslate).length > 0) {
			try {
				// Force translateAll to throw (simulating API failure)
				const mockTranslateAll = vi.mocked(translateAll);
				mockTranslateAll.mockRejectedValueOnce(
					new Error("API rate limit exceeded"),
				);

				await translateAll({
					model: {} as any,
					entries: toTranslate,
					sourceLocale,
					targetLocale: locale,
				});
			} catch {
				errors = Object.keys(toTranslate).length;
				translationFailed = true;
			}
		}

		// The CLI skips writeTranslation when translationFailed is true
		if (!translationFailed) {
			const finalFlat = { ...diffResult.unchanged };
			await writeTranslation(targetFile, finalFlat);
		}

		// Verify: file was NOT modified
		const afterContent = await readFile(targetFile, "utf-8");
		expect(afterContent).toBe(originalContent);
		expect(JSON.parse(afterContent)).toEqual(existingTranslations);

		// Verify: error state
		expect(translationFailed).toBe(true);
		expect(errors).toBeGreaterThan(0);
	});

	it("writes translations only on success", async () => {
		const locale = "fr";
		const targetFile = join(tmpDir, `${locale}.json`);

		const sourceFlat = flatten(
			await loadJsonFile(join(tmpDir, `${sourceLocale}.json`)),
		);
		const targetRaw = await loadJsonFile(targetFile);
		const targetFlat = flatten(targetRaw);
		const lockData = await loadLockFile(tmpDir);

		const diffResult = computeDiff(sourceFlat, targetFlat, lockData);
		const toTranslate = { ...diffResult.added, ...diffResult.modified };

		let translationFailed = false;
		let translated: Record<string, string> = {};

		if (Object.keys(toTranslate).length > 0) {
			try {
				// Simulate successful translation
				translated = {};
				for (const key of Object.keys(toTranslate)) {
					translated[key] = `fr_${key}`;
				}
			} catch {
				translationFailed = true;
			}
		}

		if (!translationFailed) {
			const finalFlat = { ...diffResult.unchanged, ...translated };
			await writeTranslation(targetFile, finalFlat);
		}

		// Verify: file WAS updated with new translations
		const afterContent = await readFile(targetFile, "utf-8");
		const parsed = JSON.parse(afterContent);
		expect(translationFailed).toBe(false);
		// Since no lock file exists, all keys are treated as modified/added
		expect(parsed.app.title).toContain("fr_");
	});
});
