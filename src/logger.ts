import pc from "picocolors";
import type { TranslationResult } from "./types.js";

export function logStart(sourceLocale: string, targetLocales: string[]): void {
  console.log(
    `\n${pc.bold("translate-kit")} ${pc.dim("·")} ${sourceLocale} ${pc.dim("→")} ${targetLocales.join(", ")}\n`,
  );
}

export function logLocaleStart(locale: string): void {
  console.log(`${pc.cyan("●")} ${pc.bold(locale)}`);
}

export function logLocaleResult(result: TranslationResult): void {
  const parts: string[] = [];

  if (result.translated > 0) {
    parts.push(pc.green(`${result.translated} translated`));
  }
  if (result.cached > 0) {
    parts.push(pc.dim(`${result.cached} cached`));
  }
  if (result.removed > 0) {
    parts.push(pc.yellow(`${result.removed} removed`));
  }
  if (result.errors > 0) {
    parts.push(pc.red(`${result.errors} errors`));
  }

  const time = pc.dim(`${(result.duration / 1000).toFixed(1)}s`);
  console.log(`  ${parts.join(pc.dim(" · "))} ${time}`);
}

export function logSummary(results: TranslationResult[]): void {
  const totalTranslated = results.reduce((s, r) => s + r.translated, 0);
  const totalCached = results.reduce((s, r) => s + r.cached, 0);
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  console.log(
    `\n${pc.bold("Done!")} ${totalTranslated} keys translated, ${totalCached} cached ${pc.dim(`(${(totalDuration / 1000).toFixed(1)}s)`)}\n`,
  );
}

export function logDryRun(
  locale: string,
  added: number,
  modified: number,
  removed: number,
  unchanged: number,
): void {
  console.log(`${pc.cyan("●")} ${pc.bold(locale)} ${pc.dim("(dry run)")}`);
  console.log(
    `  ${pc.green(`+${added}`)} added, ${pc.yellow(`~${modified}`)} modified, ${pc.red(`-${removed}`)} removed, ${pc.dim(`${unchanged} unchanged`)}`,
  );
}

export function logScanResult(total: number, files: number): void {
  console.log(
    `\n${pc.bold("Scan complete:")} ${pc.green(`${total} strings`)} from ${files} files\n`,
  );
}

export function logError(message: string): void {
  console.error(`${pc.red("✖")} ${message}`);
}

export function logWarning(message: string): void {
  console.log(`${pc.yellow("⚠")} ${message}`);
}

export function logVerbose(message: string, verbose: boolean): void {
  if (verbose) {
    console.log(pc.dim(`  ${message}`));
  }
}
