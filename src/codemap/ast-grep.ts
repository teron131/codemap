/** Parses source through ast-grep's bundled NAPI parsers, so nothing here needs the ast-grep CLI. The Python grammar registers at import. */
import python from "@ast-grep/lang-python";
import { Lang, parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";

const LANGUAGE_ALIASES: Record<string, string> = {
  javascript: "javascript",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  python: "python",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
};

registerDynamicLanguage({ python });

export function normalizeLanguage(lang: string): string {
  return LANGUAGE_ALIASES[lang.toLowerCase()] ?? lang;
}

export function hasBundledParser(language: string): boolean {
  return napiLanguageFor(normalizeLanguage(language)) !== null;
}

/** Null for languages without a bundled parser and when parsing throws. */
export function astGrepRoot(source: string, language: string): SgNode | null {
  const napiLanguage = napiLanguageFor(normalizeLanguage(language));
  if (napiLanguage === null) {
    return null;
  }
  try {
    return parse(napiLanguage, source).root();
  } catch {
    return null;
  }
}

function napiLanguageFor(language: string): Lang | string | null {
  const languages: Record<string, Lang | string> = {
    javascript: Lang.JavaScript,
    jsx: Lang.JavaScript,
    python: "python",
    tsx: Lang.Tsx,
    typescript: Lang.TypeScript,
  };
  return languages[language] ?? null;
}
