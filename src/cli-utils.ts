/**
 * Pure functions extracted from cli.ts for testability.
 */

export interface ParsedTranslateFlags {
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  locale: string | undefined;
}

/**
 * Parse raw CLI args into translate command flags.
 * Mirrors the logic in main.run() for the default translate command.
 */
export function parseTranslateFlags(rawArgs: string[]): ParsedTranslateFlags {
  const dryRun = rawArgs.includes("--dry-run");
  const force = rawArgs.includes("--force");
  const verbose = rawArgs.includes("--verbose");
  let locale: string | undefined;
  const equalsArg = rawArgs.find((a) => a.startsWith("--locale="));
  if (equalsArg) {
    locale = equalsArg.split("=")[1] || undefined;
  } else {
    const idx = rawArgs.indexOf("--locale");
    if (idx !== -1) {
      const next = rawArgs[idx + 1];
      locale = next && !next.startsWith("--") ? next : undefined;
    }
  }

  return { dryRun, force, verbose, locale };
}

/**
 * Validate a locale string to prevent path traversal and injection.
 * Only allows letters, numbers, hyphens, and underscores.
 */
export function validateLocale(locale: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(locale);
}
