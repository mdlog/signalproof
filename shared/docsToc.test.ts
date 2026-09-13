import { describe, expect, it } from "vitest";
import { docLinkTarget, extractHeadings, internalDocLinks, slugifyHeading } from "./docsToc";

/**
 * The docs page builds its table of contents and its cross-links from the markdown itself, so
 * the two helpers that read markdown are pinned here; the manifest test then uses them to prove
 * every page has a title and every internal link resolves.
 */
const sample = `# Quickstart

Some intro with a [link to concepts](concepts.md) and an [anchor](api.md#rate-limit).

## Run it locally

\`\`\`bash
# a comment that must not become a heading
pnpm dev
\`\`\`

### Without a database

## Docker & hosts
`;

describe("slugifyHeading", () => {
  it("lowercases, strips punctuation and joins words with hyphens", () => {
    expect(slugifyHeading("Docker & hosts")).toBe("docker-hosts");
    expect(slugifyHeading("What the precompile does not check")).toBe("what-the-precompile-does-not-check");
    expect(slugifyHeading("GET /v1/areas/:area")).toBe("get-v1-areas-area");
  });
});

describe("extractHeadings", () => {
  it("lists ATX headings with their level and id, skipping fenced code", () => {
    expect(extractHeadings(sample)).toEqual([
      { level: 1, text: "Quickstart", id: "quickstart", line: 1 },
      { level: 2, text: "Run it locally", id: "run-it-locally", line: 5 },
      { level: 3, text: "Without a database", id: "without-a-database", line: 12 },
      { level: 2, text: "Docker & hosts", id: "docker-hosts", line: 14 },
    ]);
  });

  it("disambiguates repeated headings", () => {
    expect(extractHeadings("## Errors\n\n## Errors\n").map((h) => h.id)).toEqual(["errors", "errors-1"]);
  });
});

describe("internalDocLinks", () => {
  it("returns every sibling <slug>.md target, without anchors, deduplicated", () => {
    expect(internalDocLinks(sample)).toEqual(["concepts", "api"]);
    expect(internalDocLinks("[a](api.md) [b](api.md#x) [c](./faq.md)")).toEqual(["api", "faq"]);
  });

  it("ignores external links, links into other folders and bare anchors", () => {
    expect(internalDocLinks("[x](https://example.com/docs/y.md) [y](../README.md) [z](#anchor) [w](/docs/api)")).toEqual([]);
  });
});

describe("docLinkTarget", () => {
  it("maps a sibling markdown link to its route, keeping the anchor", () => {
    expect(docLinkTarget("concepts.md")).toBe("/docs/concepts");
    expect(docLinkTarget("./api.md#rate-limit")).toBe("/docs/api#rate-limit");
  });

  it("leaves every other href alone", () => {
    for (const href of ["#anchor", "https://example.com/x.md", "../README.md", "/verify"]) expect(docLinkTarget(href)).toBeNull();
  });
});
