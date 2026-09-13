/**
 * Full-text search over the docs pages, in the browser, with no index to build: the whole site
 * is a few hundred kilobytes of markdown, so a linear scan per keystroke is cheaper than the
 * search library it would replace. Pure, so it is pinned by unit tests.
 */
import { extractHeadings } from "./docsToc";

export type DocSearchPage = { slug: string; title: string; markdown: string };

export type DocSearchHit = {
  slug: string;
  title: string;
  /** Nearest heading above the match; `null` when the match sits under the page title. */
  headingId: string | null;
  heading: string;
  snippet: string;
};

/** Markdown syntax that would only add noise to a one-line snippet. */
function plainText(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(text: string, query: string, width = 160): string {
  if (text.length <= width) return text;
  const at = text.toLowerCase().indexOf(query);
  const start = Math.max(0, Math.min(at - 40, text.length - width));
  const slice = text.slice(start, start + width).trim();
  return (start > 0 ? "…" : "") + slice + (start + width < text.length ? "…" : "");
}

/** Title matches first, then heading matches, then body matches; at most one hit per section. */
export function searchDocs(pages: DocSearchPage[], query: string, limit = 12): DocSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const ranked: { rank: number; hit: DocSearchHit }[] = [];

  for (const page of pages) {
    const headings = extractHeadings(page.markdown).filter((h) => h.level > 1);
    if (page.title.toLowerCase().includes(q)) {
      ranked.push({ rank: 0, hit: { slug: page.slug, title: page.title, headingId: null, heading: page.title, snippet: page.title } });
    }
    const lines = page.markdown.split("\n");
    let inFence = false;
    let section: { id: string | null; text: string } = { id: null, text: page.title };
    let sectionHit = page.title.toLowerCase().includes(q);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const heading = headings.find((h) => h.line === i + 1);
      if (heading) {
        section = { id: heading.id, text: heading.text };
        sectionHit = false;
        if (heading.text.toLowerCase().includes(q)) {
          ranked.push({ rank: 1, hit: { slug: page.slug, title: page.title, headingId: heading.id, heading: heading.text, snippet: heading.text } });
          sectionHit = true;
        }
        continue;
      }
      if (sectionHit || /^\s*(\|?\s*-{3,}\s*\|?\s*)+$/.test(line)) continue;
      const text = plainText(line);
      if (!text.toLowerCase().includes(q)) continue;
      ranked.push({ rank: 2, hit: { slug: page.slug, title: page.title, headingId: section.id, heading: section.text, snippet: excerpt(text, q) } });
      sectionHit = true;
    }
  }

  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => r.hit);
}
