import { describe, it, expect } from "vitest";
import {
  CLIENT_TEMPLATE,
  serverTemplate,
  generateI18nHelper,
} from "../../src/templates/t-component.js";

const defaultOpts = {
  sourceLocale: "en",
  targetLocales: ["es", "fr"],
  messagesDir: "./messages",
};

describe("CLIENT_TEMPLATE", () => {
  it("imports useEffect", () => {
    expect(CLIENT_TEMPLATE).toContain("useEffect");
  });

  it("I18nProvider accepts locale prop", () => {
    expect(CLIENT_TEMPLATE).toContain("locale");
    expect(CLIENT_TEMPLATE).toContain("locale?: string");
  });

  it("sets NEXT_LOCALE cookie when locale is provided", () => {
    expect(CLIENT_TEMPLATE).toContain("NEXT_LOCALE");
    expect(CLIENT_TEMPLATE).toContain("document.cookie");
    expect(CLIENT_TEMPLATE).toContain("SameSite=Lax");
  });
});

describe("serverTemplate (with opts)", () => {
  const output = serverTemplate("t", defaultOpts);

  it("exports setLocale", () => {
    expect(output).toContain("export function setLocale(");
  });

  it("declares getLocaleStore before getCachedMessages", () => {
    const localeStoreIdx = output.indexOf("getLocaleStore");
    const cachedMessagesIdx = output.indexOf("getCachedMessages");
    expect(localeStoreIdx).toBeGreaterThan(-1);
    expect(cachedMessagesIdx).toBeGreaterThan(-1);
    expect(localeStoreIdx).toBeLessThan(cachedMessagesIdx);
  });

  it("getCachedMessages checks getLocaleStore before Accept-Language", () => {
    const fnStart = output.indexOf("const getCachedMessages");
    const localeStoreCheck = output.indexOf("getLocaleStore().current", fnStart);
    const headersImport = output.indexOf('import("next/headers")', fnStart);
    expect(localeStoreCheck).toBeGreaterThan(fnStart);
    expect(headersImport).toBeGreaterThan(localeStoreCheck);
  });

  it("only imports headers when locale store is empty", () => {
    expect(output).toContain("if (!locale)");
    expect(output).toContain('await import("next/headers")');
  });

  it("getCachedMessages reads NEXT_LOCALE cookie before Accept-Language", () => {
    const fnStart = output.indexOf("const getCachedMessages");
    const cookieRead = output.indexOf("NEXT_LOCALE", fnStart);
    const acceptLang = output.indexOf("accept-language", fnStart);
    expect(cookieRead).toBeGreaterThan(fnStart);
    expect(acceptLang).toBeGreaterThan(cookieRead);
  });

  it("validates cookie locale against supported list", () => {
    expect(output).toContain("supported.includes(cookieLocale as Locale)");
  });

  it("wraps cookie reading in try-catch", () => {
    const fnStart = output.indexOf("const getCachedMessages");
    const fnEnd = output.indexOf("});", fnStart);
    const body = output.slice(fnStart, fnEnd);
    // Should have try-catch for cookies
    expect(body).toContain("try {");
    expect(body).toContain("} catch {}");
  });
});

describe("serverTemplate (legacy, no opts)", () => {
  const output = serverTemplate("t");

  it("does NOT export setLocale", () => {
    expect(output).not.toContain("setLocale");
  });

  it("does NOT include getLocaleStore", () => {
    expect(output).not.toContain("getLocaleStore");
  });

  it("does NOT include getCachedMessages", () => {
    expect(output).not.toContain("getCachedMessages");
  });

  it("does NOT include NEXT_LOCALE cookie reading", () => {
    expect(output).not.toContain("NEXT_LOCALE");
  });
});

describe("generateI18nHelper", () => {
  const output = generateI18nHelper(defaultOpts);

  it("imports cookies from next/headers", () => {
    expect(output).toContain("cookies");
    expect(output).toContain('from "next/headers"');
  });

  it("getLocale reads NEXT_LOCALE cookie before Accept-Language", () => {
    const fnStart = output.indexOf("async function getLocale");
    const cookieRead = output.indexOf("NEXT_LOCALE", fnStart);
    const acceptLang = output.indexOf("accept-language", fnStart);
    expect(cookieRead).toBeGreaterThan(fnStart);
    expect(acceptLang).toBeGreaterThan(cookieRead);
  });

  it("validates cookie locale against supported list", () => {
    expect(output).toContain("supported.includes(cookieLocale as Locale)");
  });

  it("wraps cookie reading in try-catch in getLocale", () => {
    const fnStart = output.indexOf("async function getLocale");
    const fnEnd = output.indexOf("parseAcceptLanguage(acceptLang)", fnStart);
    const body = output.slice(fnStart, fnEnd);
    expect(body).toContain("try {");
    expect(body).toContain("} catch {}");
  });
});
