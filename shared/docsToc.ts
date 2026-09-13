/**
 * Reading markdown for the docs page: headings for the table of contents, and internal links so a
 * test can prove every cross-reference resolves. Pure, so both are pinned by unit tests.
 */

/** `line` is 1-based in the source, so a renderer can give a heading the same id the TOC uses. */
export type DocHeading = { level: number; text: string; id: string; line: number };

/** GitHub-style: lowercase, drop punctuation, hyphenate whitespace. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/[\s-]+/g, "-");
}

/** ATX headings (`#`..`######`) outside fenced code blocks, ids disambiguated like GitHub. */
export function extractHeadings(markdown: string): DocHeading[] {
  const out: DocHeading[] = [];
  const seen = new Map<string, number>();
  let inFence = false;
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    const base = slugifyHeading(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ level: m[1].length, text, id: n === 0 ? base : `${base}-${n}`, line: i + 1 });
  }
  return out;
}

/**
 * Pages link to each other as sibling files (`concepts.md#rewards`), so the same markdown reads
 * on GitHub; the app maps those to `/docs/<slug>#rewards`. Anything else is not a docs link.
 */
const SIBLING_LINK = /^(?:\.\/)?([a-z0-9-]+)\.md(#[^\s)]*)?$/;

export function docLinkTarget(href: string): string | null {
  const m = SIBLING_LINK.exec(href);
  return m ? `/docs/${m[1]}${m[2] ?? ""}` : null;
}

/** Slugs of every sibling page linked from the markdown, in order of first appearance. */
export function internalDocLinks(markdown: string): string[] {
  const slugs: string[] = [];
  for (const m of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = SIBLING_LINK.exec(m[1]);
    if (target && !slugs.includes(target[1])) slugs.push(target[1]);
  }
  return slugs;
}
