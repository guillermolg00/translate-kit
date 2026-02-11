const DEFAULT_TRANSLATABLE_PROPS = [
  "placeholder",
  "title",
  "alt",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "label",
];

const NEVER_TRANSLATE_PROPS = [
  "className",
  "class",
  "id",
  "key",
  "ref",
  "href",
  "src",
  "type",
  "name",
  "value",
  "htmlFor",
  "for",
  "role",
  "style",
  "data-testid",
  "data-cy",
  "onClick",
  "onChange",
  "onSubmit",
  "onFocus",
  "onBlur",
];

const IGNORE_TAGS = [
  "script",
  "style",
  "code",
  "pre",
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
];

const IGNORE_PATTERNS = [
  /^\s*$/, // Whitespace only
  /^https?:\/\//, // URLs
  /^[\d.,%$€£¥]+$/, // Numbers, currency
  /^[^\p{L}]*$/u, // No letters at all (Unicode-aware)
];

function isLikelyKebabIdentifier(text: string): boolean {
  // Keep this conservative to avoid skipping real UI copy like "sign-in".
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(text)) return false;
  return text.split("-").length >= 3;
}

function isLikelyConstantIdentifier(text: string): boolean {
  // Ignore env/constant-like tokens, but keep plain ALLCAPS words (API, OK).
  return /^(?=.*[_\d])[A-Z0-9_]+$/.test(text);
}

const CONTENT_PROPERTY_NAMES = [
  "title",
  "description",
  "label",
  "text",
  "content",
  "heading",
  "subtitle",
  "caption",
  "summary",
  "message",
  "placeholder",
  "alt",
];

export function isContentProperty(propName: string): boolean {
  return CONTENT_PROPERTY_NAMES.includes(propName);
}

export function isTranslatableProp(
  propName: string,
  customProps?: string[],
): boolean {
  if (NEVER_TRANSLATE_PROPS.includes(propName)) return false;
  const allowed = customProps ?? DEFAULT_TRANSLATABLE_PROPS;
  return allowed.includes(propName);
}

export function isIgnoredTag(tagName: string): boolean {
  return IGNORE_TAGS.includes(tagName.toLowerCase());
}

export function shouldIgnore(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (isLikelyKebabIdentifier(trimmed)) return true;
  if (isLikelyConstantIdentifier(trimmed)) return true;
  return IGNORE_PATTERNS.some((pattern) => pattern.test(trimmed));
}
