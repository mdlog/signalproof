import { describe, expect, it } from "vitest";
import { DOCS, DOC_GROUPS, findDoc } from "./manifest";
import { docLinkTarget, extractHeadings, internalDocLinks } from "../../../shared/docsToc";

/**
 * The docs are content, but their structure is code: a page without an H1 has no title, and a
 * link to a slug that does not exist is a 404 the reader hits instead of us.
 */
describe("docs manifest", () => {
  it("has unique slugs and every page starts with an H1 matching its title", () => {
    const slugs = DOCS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const doc of DOCS) {
      const [first] = extractHeadings(doc.markdown);
      expect(first?.level, `${doc.slug}: first heading must be an H1`).toBe(1);
      expect(first?.text, `${doc.slug}: H1 must match the manifest title`).toBe(doc.title);
    }
  });

  it("only links to pages that exist, with anchors that exist", () => {
    for (const doc of DOCS) {
      for (const m of doc.markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
        const route = docLinkTarget(m[1]);
        if (!route) {
          // A docs link must be written as a sibling file so it also resolves on GitHub.
          expect(m[1], `${doc.slug} links to ${m[1]}; write docs links as <slug>.md`).not.toMatch(/^\/docs\//);
          continue;
        }
        const [path, anchor] = route.split("#");
        const target = findDoc(path.replace("/docs/", ""));
        expect(target, `${doc.slug} links to ${m[1]}, which does not exist`).not.toBeNull();
        if (anchor) {
          const ids = extractHeadings(target!.markdown).map((h) => h.id);
          expect(ids, `${doc.slug} links to ${m[1]}, which has no such heading`).toContain(anchor);
        }
      }
      expect(internalDocLinks(doc.markdown).every((s) => findDoc(s) !== null)).toBe(true);
    }
  });

  it("uses only the declared groups, each with at least one page", () => {
    for (const doc of DOCS) expect(DOC_GROUPS).toContain(doc.group);
    for (const g of DOC_GROUPS) expect(DOCS.some((d) => d.group === g), `group ${g} is empty`).toBe(true);
  });

  it("has no placeholders left in the text", () => {
    for (const doc of DOCS) {
      expect(doc.markdown, `${doc.slug} contains a placeholder`).not.toMatch(/\bTBD\b|\bTODO\b|lorem ipsum/i);
    }
  });
});
