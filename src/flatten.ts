export function flatten(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      result[fullKey] = value;
    } else if (
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      Object.assign(result, flatten(value as Record<string, unknown>, fullKey));
    }
    // Skip arrays and non-string primitives (preserve them separately)
  }

  return result;
}

export function unflatten(
  obj: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const parts = key.split(".");
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part in current && typeof current[part] !== "object") {
        console.warn(
          `[translate-kit] Key conflict: "${parts.slice(0, i + 1).join(".")}" is a value but "${key}" expects it to be an object`,
        );
        current[part] = {};
      } else if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  return result;
}
