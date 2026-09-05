/** Selects README purpose and outline from parsed Markdown and embedded HTML structure. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";

import type { ReadmeSection } from "../schema.js";
const README_CONTENT_SECTIONS = 2;
const README_NAMES = ["README.md", "readme.md", "README.rst"];
const IRRELEVANT_README_HEADING =
  /^(?:(?:quick\s+)?install(?:ation|ing)?|quick\s*start|getting started|setup|prerequisites?|requirements?|troubleshooting|contribut(?:ing|ion|ions)?|licen[cs](?:e|ing)|development|developing|tests?|testing|changelog|release(?:s| notes?)?|security(?: defaults?)?|support|sponsors?|acknowledg(?:e)?ments?|credits?|authors?|code of conduct|screenshots?|star history|privacy policy|citations?|references?|(?:additional\s+)?resources|community)(?:\s*\([^)]*\))?$/i;

type Block =
  | { kind: "heading"; level: number; title: string }
  | { kind: "content"; lines: string[] };
type HtmlNode = DefaultTreeAdapterTypes.Node;
const SUPPRESSED_HTML = new Set([
  "pre",
  "code",
  "script",
  "style",
  "picture",
  "svg",
  "table",
  "h4",
  "h5",
  "h6",
  "img",
]);
const HTML_BLOCKS = new Set(["p", "div", "section", "article", "ul", "ol", "li", "h1", "h2", "h3"]);

/** Preserves Codemap's section selection while leaving Markdown boundaries and inline syntax to the parser. */
export function readmeSummaryFromText(text: string): ReadmeSection[] {
  const blocks = markdownBlocks(text);
  const sections: ReadmeSection[] = [];
  const introduction: string[] = [];
  let current: ReadmeSection | null = null;
  let ignoredLevel: number | null = null;
  let sawHeading = false;
  for (const block of blocks) {
    if (block.kind === "heading") {
      sawHeading = true;
      if (ignoredLevel !== null && block.level > ignoredLevel) {
        current = null;
        continue;
      }
      ignoredLevel = null;
      if (IRRELEVANT_README_HEADING.test(block.title)) {
        ignoredLevel = block.level;
        current = null;
      } else if (block.level <= 3 && block.title) {
        current = { level: block.level, outline: true, title: block.title, content: [] };
        sections.push(current);
      } else current = null;
    } else if (current !== null) current.content.push(...block.lines, "");
    else if (!sawHeading) introduction.push(...block.lines, "");
  }
  const intro = normalizedContent(introduction);
  if (intro.length)
    sections.unshift({ level: 0, outline: false, title: "Introduction", content: intro });
  let included = 0;
  return sections.map((section) => {
    const content = normalizedContent(section.content);
    if (!content.length || included >= README_CONTENT_SECTIONS) return { ...section, content: [] };
    included += 1;
    return { ...section, content };
  });
}

/** Separates Markdown syntax from HTML fragments while retaining authored block boundaries. */
function markdownBlocks(text: string): Block[] {
  return fromMarkdown(text).children.flatMap((node): Block[] => {
    if (node.type === "heading")
      return [{ kind: "heading", level: node.depth, title: headingTitle(markdownText(node)) }];
    if (node.type === "html")
      return htmlBlocks(parseFragment(node.value, { sourceCodeLocationInfo: true }), node.value);
    const lines = markdownLines(node);
    return lines.length ? [{ kind: "content", lines }] : [];
  });
}

/** Reads the first supported README, retaining the existing plain-text/setext subset for reStructuredText files. */
export function readmeSummary(root: string): ReadmeSection[] {
  for (const name of README_NAMES) {
    const file = path.join(root, name);
    if (existsSync(file)) return readmeSummaryFromText(readFileSync(file, "utf8"));
  }
  return [];
}

/** Projects visible Markdown text while excluding image decoration and preserving soft line breaks. */
function markdownText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "break") return "\n";
  if (node.type === "html") return htmlText(parseFragment(node.value));
  if (node.type === "image" || node.type === "imageReference") return "";
  return "children" in node ? node.children.map(markdownText).join("") : "";
}

function markdownLines(node: Nodes): string[] {
  if (node.type === "paragraph" || node.type === "heading")
    return normalizedContent(markdownText(node).split("\n"));
  if (node.type === "blockquote")
    return node.children.flatMap(markdownLines).map((line) => `> ${line}`);
  if (node.type === "list")
    return node.children.flatMap((item, index) => {
      const lines = item.children.flatMap(markdownLines);
      const marker = node.ordered ? `${(node.start ?? 1) + index}. ` : "- ";
      return lines.map((line, lineIndex) => (lineIndex === 0 ? marker : "  ") + line);
    });
  if (node.type === "html")
    return htmlBlocks(parseFragment(node.value)).flatMap((block) =>
      block.kind === "content" ? block.lines : [block.title],
    );
  return [];
}

/** Retains semantic HTML headings and visible prose while suppressing the same decorative regions as Markdown. */
function htmlBlocks(node: HtmlNode, source = ""): Block[] {
  if (suppressedHtml(node)) return [];
  const tag = "tagName" in node ? node.tagName : "";
  if (["h1", "h2", "h3"].includes(tag))
    return [{ kind: "heading", level: Number(tag[1]), title: headingTitle(htmlText(node)) }];
  if (tag === "p" || tag === "li" || !("childNodes" in node)) {
    const lines = normalizedContent(htmlText(node).split("\n"));
    if (tag === "li" && lines[0]) lines[0] = `- ${lines[0]}`;
    return lines.length ? [{ kind: "content", lines }] : [];
  }
  const blocks: Block[] = [];
  let text = "";
  const flush = () => {
    const lines = normalizedContent(text.split("\n"));
    if (lines.length) blocks.push({ kind: "content", lines });
    text = "";
  };
  for (const child of node.childNodes) {
    if (
      node.nodeName === "#document-fragment" &&
      child.nodeName === "#text" &&
      child.sourceCodeLocation &&
      source
    ) {
      flush();
      // CommonMark can include Markdown after a closed HTML element in the same raw block.
      blocks.push(
        ...markdownBlocks(
          source.slice(child.sourceCodeLocation.startOffset, child.sourceCodeLocation.endOffset),
        ),
      );
    } else if ("tagName" in child && HTML_BLOCKS.has(child.tagName)) {
      flush();
      blocks.push(...htmlBlocks(child, source));
    } else text += htmlText(child);
  }
  flush();
  return blocks;
}

function htmlText(node: HtmlNode): string {
  if (suppressedHtml(node)) return "";
  if (node.nodeName === "#text" && "value" in node) return node.value;
  if ("tagName" in node && node.tagName === "br") return "\n";
  return "childNodes" in node ? node.childNodes.map(htmlText).join("") : "";
}

function suppressedHtml(node: HtmlNode): boolean {
  return (
    "tagName" in node &&
    (SUPPRESSED_HTML.has(node.tagName) ||
      (node.tagName === "p" &&
        node.attrs.some(
          (attribute) => attribute.name === "align" && attribute.value.toLowerCase() === "center",
        )))
  );
}

function headingTitle(value: string): string {
  return value
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim();
}

function normalizedContent(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const value = line.trim();
    if (value || (result.length > 0 && result.at(-1) !== "")) result.push(value);
  }
  while (result.at(-1) === "") result.pop();
  return result;
}
