/** Extracts a compact project introduction and outline from repository README files. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ReadmeSection } from "../schema.js";

const README_CONTENT_SECTIONS = 2;
const README_NAMES = ["README.md", "readme.md", "README.rst"];
const IRRELEVANT_README_HEADING =
  /^(?:(?:quick\s+)?install(?:ation|ing)?|quick\s*start|getting started|setup|prerequisites?|requirements?|troubleshooting|contribut(?:ing|ion|ions)?|licen[cs](?:e|ing)|development|developing|tests?|testing|changelog|release(?:s| notes?)?|security(?: defaults?)?|support|sponsors?|acknowledg(?:e)?ments?|credits?|authors?|code of conduct|screenshots?|star history|privacy policy|citations?|references?|(?:additional\s+)?resources|community)(?:\s*\([^)]*\))?$/i;

/** Extracts useful README headings and introductory section content from raw text. */
export function readmeSummaryFromText(text: string): ReadmeSection[] {
  const lines = visibleReadmeLines(text);
  const sections: ReadmeSection[] = [];
  const introduction: string[] = [];
  let currentSection: ReadmeSection | null = null;
  let ignoredParentLevel: number | null = null;
  let sawHeading = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const next = lines[index + 1] ?? "";
    const heading = readmeHeading(line, next);
    if (heading !== null) {
      sawHeading = true;
      if (heading.consumesNext) {
        index += 1;
      }
      if (ignoredParentLevel !== null && heading.level > ignoredParentLevel) {
        currentSection = null;
        continue;
      }
      ignoredParentLevel = null;
      if (IRRELEVANT_README_HEADING.test(heading.title)) {
        ignoredParentLevel = heading.level;
        currentSection = null;
      } else if (heading.level <= 3) {
        currentSection = {
          level: heading.level,
          outline: true,
          title: heading.title,
          content: [],
        };
        sections.push(currentSection);
      } else {
        currentSection = null;
      }
      continue;
    }
    if (currentSection !== null) {
      currentSection.content.push(line);
    } else if (!sawHeading) {
      introduction.push(line);
    }
  }

  const introductionContent = normalizedReadmeContent(introduction);
  if (introductionContent.length > 0) {
    sections.unshift({
      level: 0,
      outline: false,
      title: "Introduction",
      content: introductionContent,
    });
  }

  let includedContentSections = 0;
  return sections.map((section) => {
    const content = normalizedReadmeContent(section.content);
    if (content.length === 0 || includedContentSections >= README_CONTENT_SECTIONS) {
      return { ...section, content: [] };
    }
    includedContentSections += 1;
    return { ...section, content };
  });
}

/** Reads and parses the first supported README. */
export function readmeSummary(root: string): ReadmeSection[] {
  for (const name of README_NAMES) {
    const filePath = path.join(root, name);
    if (existsSync(filePath)) {
      return readmeSummaryFromText(readFileSync(filePath, "utf8"));
    }
  }
  return [];
}

/** Removes code, comments, image-only markup, and raw HTML decoration from README lines. */
function visibleReadmeLines(text: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  let htmlComment = false;
  let suppressedHtmlTag: string | null = null;
  for (const rawLine of normalizeSemanticHtmlHeadings(text).split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const fenceMatch = /^(?:`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch !== null) {
      const marker = fenceMatch[0]?.[0] ?? "`";
      fence = fence === null ? marker : fence === marker ? null : fence;
      continue;
    }
    if (fence !== null) {
      continue;
    }
    if (htmlComment) {
      if (rawLine.includes("-->")) {
        htmlComment = false;
      }
      continue;
    }
    if (rawLine.includes("<!--")) {
      htmlComment = !rawLine.includes("-->");
      continue;
    }
    if (suppressedHtmlTag !== null) {
      if (new RegExp(`</${suppressedHtmlTag}>`, "i").test(rawLine)) {
        suppressedHtmlTag = null;
      }
      continue;
    }
    const centeredParagraph = /<p\b[^>]*\balign=["']?center/i.test(rawLine) ? "p" : null;
    const suppressed =
      centeredParagraph ??
      /<(pre|code|script|style|picture|svg|table|h[4-6])\b/i.exec(rawLine)?.[1] ??
      null;
    if (suppressed !== null) {
      if (!new RegExp(`</${suppressed}>`, "i").test(rawLine)) {
        suppressedHtmlTag = suppressed;
      }
      continue;
    }
    lines.push(cleanReadmeLine(rawLine));
  }
  return lines;
}

/** Converts semantic multiline HTML headings into Markdown before line-oriented parsing. */
function normalizeSemanticHtmlHeadings(text: string): string {
  return text.replace(
    /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_match, level: string, content: string) => {
      const title = content
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return title ? `${"#".repeat(Number(level))} ${title}` : "";
    },
  );
}

/** Cleans one visible README line while retaining useful prose, lists, and links. */
function cleanReadmeLine(line: string): string {
  const withMarkdownHeading = line.replace(
    /^\s*<h([1-6])(?:\s[^>]*)?>(.*?)<\/h\1>\s*$/i,
    (_match, level: string, title: string) => `${"#".repeat(Number(level))} ${title}`,
  );
  return withMarkdownHeading
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .trimEnd();
}

/** Parses ATX and setext headings, including deeper headings that stop section content. */
function readmeHeading(
  line: string,
  next: string,
): { level: number; title: string; consumesNext: boolean } | null {
  const atx = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
  if (atx !== null) {
    return {
      level: atx[1]?.length ?? 1,
      title: cleanHeadingTitle(atx[2] ?? ""),
      consumesNext: false,
    };
  }
  if (line.trim() && /^={3,}\s*$/.test(next)) {
    return { level: 1, title: cleanHeadingTitle(line), consumesNext: true };
  }
  if (line.trim() && /^-{3,}\s*$/.test(next)) {
    return { level: 2, title: cleanHeadingTitle(line), consumesNext: true };
  }
  return null;
}

/** Removes inline Markdown decoration from heading titles before filtering and display. */
function cleanHeadingTitle(value: string): string {
  return value
    .replace(/[`*_~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim();
}

/** Trims section content and collapses repeated blank lines. */
function normalizedReadmeContent(lines: string[]): string[] {
  const normalized: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^[-*_]{3,}$/.test(trimmed.trim())) {
      continue;
    }
    if (!trimmed.trim()) {
      if (normalized.length > 0 && normalized.at(-1) !== "") {
        normalized.push("");
      }
      continue;
    }
    normalized.push(trimmed);
  }
  while (normalized.at(-1) === "") {
    normalized.pop();
  }
  return normalized;
}
