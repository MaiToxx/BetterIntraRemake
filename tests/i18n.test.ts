/**
 * The i18n core (src/core/i18n/i18n.ts) and the build's per-bundle cut of
 * the French catalog (scripts/i18n-catalog.ts).
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectLang,
  getLang,
  intlLocale,
  msg,
  resolveLang,
  setLang,
  t,
  tp,
} from "../src/core/i18n/i18n.ts";
import { injectCatalog, loadCatalog, stringsIn, subsetFor } from "../scripts/i18n-catalog.ts";

const englishBrowser = (chrome as unknown as { i18n?: unknown }).i18n;

afterEach(() => {
  setLang("en");
  // back to tests/setup.ts's English browser
  (chrome as unknown as { i18n?: unknown }).i18n = englishBrowser;
});

describe("language", () => {
  it("auto follows the browser: French for any fr-*, English otherwise", () => {
    (chrome as unknown as { i18n: unknown }).i18n = { getUILanguage: () => "fr-CA" };
    expect(detectLang()).toBe("fr");
    expect(resolveLang("auto")).toBe("fr");
    (chrome as unknown as { i18n: unknown }).i18n = { getUILanguage: () => "de" };
    expect(resolveLang("auto")).toBe("en");
    expect(resolveLang(undefined)).toBe("en");
  });

  it("a chosen language wins over the browser's", () => {
    (chrome as unknown as { i18n: unknown }).i18n = { getUILanguage: () => "fr-FR" };
    expect(resolveLang("en")).toBe("en");
    expect(resolveLang("fr")).toBe("fr");
  });

  it("the tests run in English", () => {
    expect(getLang()).toBe("en");
  });
});

describe("t / tp / msg", () => {
  it("English is the key; values fill {placeholders}; unknown ones stay", () => {
    expect(t("Missed by {h}", { h: "19h30" })).toBe("Missed by 19h30");
    expect(t("Hello {who}", {})).toBe("Hello {who}");
  });

  it("French comes from the catalog, and falls back to English", () => {
    setLang("fr");
    const catalog = loadCatalog();
    const [english, french] = Object.entries(catalog)[0] ?? ["Language", "Langue"];
    if (english in catalog) expect(t(english)).toBe(french);
    expect(t("A text nobody translated")).toBe("A text nobody translated");
  });

  it("plurals: French counts 0 and 1 as singular, English only 1", () => {
    const one = "{n} untranslated thing";
    const other = "{n} untranslated things";
    expect(tp(0, one, other)).toBe("0 untranslated things");
    expect(tp(1, one, other)).toBe("1 untranslated thing");
    setLang("fr");
    // keys no catalog holds: only the choice of form is checked
    expect(tp(0, one, other)).toBe("0 untranslated thing");
    expect(tp(2, one, other)).toBe("2 untranslated things");
  });

  it("msg() only marks a text", () => {
    expect(msg("Save")).toBe("Save");
  });

  it("Intl locale: French, or the caller's English one", () => {
    expect(intlLocale("en-GB")).toBe("en-GB");
    setLang("fr");
    expect(intlLocale("en-GB")).toBe("fr-FR");
  });
});

describe("the build's catalog cut", () => {
  const catalog = { Save: "Enregistrer", Cancel: "Annuler", "Don't \"quote\" me": "Ne me « citez » pas" };

  it("finds strings whatever the quotes and escapes", () => {
    const code = `var a="Save",b='Don\\'t "quote" me',c=\`x\`;f(\`Cancel\`);`;
    expect(stringsIn(code)).toEqual(new Set(["Save", `Don't "quote" me`, "x", "Cancel"]));
  });

  it("keeps only the entries a bundle uses", () => {
    expect(subsetFor(`t("Save")`, catalog)).toEqual({ Save: "Enregistrer" });
  });

  it("replaces the placeholder in any quotes with a JSON.parse-able literal", () => {
    for (const q of [`"`, `'`, "`"]) {
      const out = injectCatalog(`var c=JSON.parse(${q}__BI_FR_CATALOG__${q});`, { Save: "Enregistrer" });
      const value = new Function(`${out}; return c;`)();
      expect(value).toEqual({ Save: "Enregistrer" });
    }
  });

  it("refuses a text translated two ways", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bi-cat-"));
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ Save: "Enregistrer" }));
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify({ Save: "Sauver" }));
    expect(() => loadCatalog(dir)).toThrow(/translated differently/);
    fs.rmSync(dir, { recursive: true });
  });
});
