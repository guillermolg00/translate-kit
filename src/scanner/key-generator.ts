import { createHash } from "node:crypto";
import type { ExtractedString } from "../types.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
}

export function generateKey(
  extracted: ExtractedString,
  strategy: "hash" | "path",
): string {
  if (strategy === "hash") {
    const hash = createHash("sha256")
      .update(extracted.text)
      .digest("hex")
      .slice(0, 12);
    return hash;
  }

  // "path" strategy
  const parts: string[] = [];

  if (extracted.componentName) {
    parts.push(extracted.componentName);
  }

  if (extracted.parentTag) {
    parts.push(extracted.parentTag);
  }

  const slug = slugify(extracted.text);
  parts.push(slug);

  return parts.join(".");
}
