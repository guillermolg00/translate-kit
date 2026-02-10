import type { ExtractedString } from "../types.js";

export function deriveRoutePath(filePath: string): string | undefined {
  // Next.js app router: src/app/<route>/page.tsx
  const appMatch = filePath.match(/src\/app\/(.+?)\/page\.[jt]sx?$/);
  if (appMatch) return appMatch[1].replace(/\//g, ".");

  // Next.js pages router: src/pages/<route>.tsx or pages/<route>.tsx
  const pagesMatch = filePath.match(/(?:src\/)?pages\/(.+?)\.[jt]sx?$/);
  if (pagesMatch) {
    const route = pagesMatch[1].replace(/\/index$/, "").replace(/\//g, ".");
    return route || undefined;
  }

  // Components: src/components/<section>/Component.tsx
  const compMatch = filePath.match(/src\/components\/(.+?)\//);
  if (compMatch) return compMatch[1];

  return undefined;
}

export function enrichStrings(
  strings: ExtractedString[],
  filePath: string,
): ExtractedString[] {
  const routePath = deriveRoutePath(filePath);

  // Group by componentName
  const byComponent = new Map<string, ExtractedString[]>();
  for (const str of strings) {
    const key = str.componentName ?? "__root__";
    if (!byComponent.has(key)) byComponent.set(key, []);
    byComponent.get(key)!.push(str);
  }

  // Find section headings (h1-h3)
  const headings = strings.filter((s) => s.parentTag && /^h[1-3]$/.test(s.parentTag));
  const defaultHeading = headings.length > 0 ? headings[0].text : undefined;

  return strings.map((str) => {
    const enriched = { ...str };

    if (routePath) enriched.routePath = routePath;

    // Assign siblingTexts from same component (max 5, excluding self)
    const siblings = byComponent.get(str.componentName ?? "__root__") ?? [];
    const siblingTexts = siblings
      .filter((s) => s !== str)
      .slice(0, 5)
      .map((s) => s.text);
    if (siblingTexts.length > 0) enriched.siblingTexts = siblingTexts;

    // Assign sectionHeading
    if (defaultHeading && str.text !== defaultHeading) {
      enriched.sectionHeading = defaultHeading;
    }

    return enriched;
  });
}
