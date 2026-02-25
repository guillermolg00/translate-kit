import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import { logError, logSuccess, logWarning } from "./logger.js";
import type { RuleContext } from "./templates/rules-templates.js";
import {
	generateClaudeMdRule,
	generateCopilotRule,
	generateCursorRule,
} from "./templates/rules-templates.js";

export function upsertMarkdownSection(
	content: string,
	heading: string,
	newSection: string,
): string {
	const headingLevel = heading.match(/^#+/)?.[0] ?? "##";
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(
		`${escapedHeading}\\s*\\n[\\s\\S]*?(?=\\n${headingLevel} |$)`,
	);
	const match = content.match(pattern);

	if (match) {
		return content.replace(pattern, newSection.trimEnd());
	}

	const trimmed = content.trimEnd();
	return trimmed ? `${trimmed}\n\n${newSection.trimEnd()}\n` : `${newSection.trimEnd()}\n`;
}

async function buildRuleContext(): Promise<RuleContext> {
	try {
		const { loadTranslateKitConfig } = await import("./config.js");
		const config = await loadTranslateKitConfig();
		return {
			messagesDir: config.messagesDir,
			sourceLocale: config.sourceLocale,
			targetLocales: config.targetLocales,
			mode: config.mode,
			scanInclude: config.scan?.include,
		};
	} catch {
		logWarning(
			"Could not load translate-kit config. Using defaults — you can edit the generated rules later.",
		);
		return {
			messagesDir: "./messages",
			sourceLocale: "en",
			targetLocales: ["es"],
			mode: "keys",
		};
	}
}

interface RuleFormat {
	value: string;
	label: string;
	hint?: string;
}

function detectAvailableFormats(): RuleFormat[] {
	const formats: RuleFormat[] = [];

	formats.push({
		value: "claude",
		label: "CLAUDE.md",
		hint: existsSync("CLAUDE.md") ? "exists — will update" : "will create",
	});

	formats.push({
		value: "cursor",
		label: ".cursor/rules/translate-kit.mdc",
		hint: existsSync(".cursor/rules/translate-kit.mdc")
			? "exists — will overwrite"
			: "will create",
	});

	formats.push({
		value: "copilot",
		label: ".github/copilot-instructions.md",
		hint: existsSync(".github/copilot-instructions.md")
			? "exists — will update"
			: "will create",
	});

	formats.push({
		value: "skill",
		label: "Claude Code Skill (~/.claude/skills/)",
		hint: existsSync(join(homedir(), ".claude", "skills", "translate-kit", "SKILL.md"))
			? "exists — will overwrite"
			: "will install",
	});

	return formats;
}

async function writeClaudeMd(ctx: RuleContext): Promise<void> {
	const filePath = "CLAUDE.md";
	const section = generateClaudeMdRule(ctx);

	if (existsSync(filePath)) {
		const existing = await readFile(filePath, "utf-8");
		const updated = upsertMarkdownSection(existing, "## translate-kit", section);
		await writeFile(filePath, updated);
	} else {
		await writeFile(filePath, section);
	}

	logSuccess(`Written ${filePath}`);
}

async function writeCursorRule(ctx: RuleContext): Promise<void> {
	const filePath = ".cursor/rules/translate-kit.mdc";
	const content = generateCursorRule(ctx);

	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, content);
	logSuccess(`Written ${filePath}`);
}

async function writeCopilotInstructions(ctx: RuleContext): Promise<void> {
	const filePath = ".github/copilot-instructions.md";
	const section = generateCopilotRule(ctx);

	await mkdir(dirname(filePath), { recursive: true });

	if (existsSync(filePath)) {
		const existing = await readFile(filePath, "utf-8");
		const updated = upsertMarkdownSection(existing, "## translate-kit", section);
		await writeFile(filePath, updated);
	} else {
		await writeFile(filePath, section);
	}

	logSuccess(`Written ${filePath}`);
}

async function installSkill(): Promise<void> {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const skillSource = join(currentDir, "..", "skills", "translate-kit", "SKILL.md");
	const skillDir = join(homedir(), ".claude", "skills", "translate-kit");
	const skillDest = join(skillDir, "SKILL.md");

	let content: string;
	try {
		content = await readFile(skillSource, "utf-8");
	} catch {
		// Fallback: try from package root via import.meta
		const fallback = join(process.cwd(), "node_modules", "translate-kit", "skills", "translate-kit", "SKILL.md");
		try {
			content = await readFile(fallback, "utf-8");
		} catch {
			logError("Could not find SKILL.md to install. Try copying it manually from the translate-kit package.");
			return;
		}
	}

	await mkdir(skillDir, { recursive: true });
	await writeFile(skillDest, content);
	logSuccess(`Installed skill to ${skillDest}`);
}

export async function runRulesCommand(): Promise<void> {
	p.intro("translate-kit rules");

	const ctx = await buildRuleContext();
	const formats = detectAvailableFormats();

	const selected = await p.multiselect({
		message: "Which AI agent rule files do you want to generate?",
		options: formats,
		required: true,
	});

	if (p.isCancel(selected)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	for (const format of selected) {
		switch (format) {
			case "claude":
				await writeClaudeMd(ctx);
				break;
			case "cursor":
				await writeCursorRule(ctx);
				break;
			case "copilot":
				await writeCopilotInstructions(ctx);
				break;
			case "skill":
				await installSkill();
				break;
		}
	}

	p.outro("Done! Your AI agents now know about translate-kit.");
}
