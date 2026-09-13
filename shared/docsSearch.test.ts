import { describe, expect, it } from "vitest";
import { searchDocs } from "./docsSearch";

const pages = [
  {
    slug: "concepts",
    title: "Concepts",
    markdown: `# Concepts

The **relayer** carries admitted measurements to Sepolia.

## Rewards

Flat, 0.001 CTC per proven measurement; see [rewards](/docs/concepts#rewards).

\`\`\`bash
# the relayer in a code comment must not match
\`\`\`

## Relayer duties

It pays gas. It pays gas again on the second line about the relayer.
`,
  },
  { slug: "faq", title: "Relayer FAQ", markdown: "# Relayer FAQ\n\nNothing here mentions the word.\n" },
];

describe("searchDocs", () => {
  it("returns nothing for a blank or one-character query", () => {
    expect(searchDocs(pages, "")).toEqual([]);
    expect(searchDocs(pages, " r ")).toEqual([]);
  });

  it("finds body text under its nearest heading, one hit per section, skipping code fences", () => {
    const hits = searchDocs(pages, "relayer").filter((h) => h.slug === "concepts");
    // A heading match outranks a body match, so the section comes first even though it is lower on the page.
    expect(hits.map((h) => h.headingId)).toEqual(["relayer-duties", null]);
    expect(hits[0].heading).toBe("Relayer duties");
    expect(hits[1].snippet).toBe("The relayer carries admitted measurements to Sepolia.");
  });

  it("ranks a title match before heading and body matches, case-insensitively", () => {
    const hits = searchDocs(pages, "RELAYER");
    expect(hits[0]).toMatchObject({ slug: "faq", headingId: null, heading: "Relayer FAQ" });
    expect(hits.length).toBe(3);
  });

  it("strips link syntax from snippets and honours the limit", () => {
    const [hit] = searchDocs(pages, "proven measurement");
    expect(hit.snippet).toBe("Flat, 0.001 CTC per proven measurement; see rewards.");
    expect(searchDocs(pages, "relayer", 1)).toHaveLength(1);
  });
});
