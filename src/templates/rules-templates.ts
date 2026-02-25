export interface RuleContext {
	messagesDir: string;
	sourceLocale: string;
	targetLocales: string[];
	mode: "keys" | "inline";
	scanInclude?: string[];
}

export function generateRuleContent(ctx: RuleContext): string {
	const locales = [ctx.sourceLocale, ...ctx.targetLocales].join(", ");
	const modeDesc =
		ctx.mode === "inline"
			? "inline mode — strings wrapped with `<T>` components, source text stays in code"
			: "keys mode — strings replaced with `t()` calls, source text in JSON files";

	return `This project uses **translate-kit** for internationalization (${modeDesc}).

**Locales:** ${locales}
**Messages directory:** \`${ctx.messagesDir}\`
${ctx.scanInclude ? `**Scanned files:** ${ctx.scanInclude.map((p) => `\`${p}\``).join(", ")}` : ""}

### When to run

After adding, modifying, or deleting user-facing strings in JSX/TSX files, run:

\`\`\`bash
npx translate-kit run
\`\`\`

This executes the full pipeline: **scan → codegen → translate**.

### Do NOT manually edit

- \`.translate-map.json\` — generated text-to-key mapping
- \`.translate-lock.json\` — translation cache hashes
- \`.translate-context.json\` — extracted context metadata
- Locale JSON files in \`${ctx.messagesDir}/\` — generated translations

### Useful flags

- \`--dry-run\` — preview changes without writing files
- \`--force\` — ignore cache, re-translate everything
- \`--locale <code>\` — only translate a specific locale`;
}

export function generateClaudeMdRule(ctx: RuleContext): string {
	return `## translate-kit

${generateRuleContent(ctx)}
`;
}

export function generateCursorRule(ctx: RuleContext): string {
	return `---
description: translate-kit i18n pipeline — run after modifying translatable strings
globs:
${(ctx.scanInclude ?? ["**/*.tsx", "**/*.jsx"]).map((p) => `  - ${p}`).join("\n")}
---

# translate-kit

${generateRuleContent(ctx)}
`;
}

export function generateCopilotRule(ctx: RuleContext): string {
	return `## translate-kit

${generateRuleContent(ctx)}
`;
}
