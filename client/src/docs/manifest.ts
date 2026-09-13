/**
 * The docs site: one markdown file per page under docs/site/, bundled at build time.
 *
 * Order here is reading order — it drives the sidebar and the Previous/Next links. Slugs are the
 * URL (`/docs/<slug>`) and the target of every internal link; a test proves each link resolves.
 */
import introduction from "../../../docs/site/introduction.md?raw";
import quickstart from "../../../docs/site/quickstart.md?raw";
import concepts from "../../../docs/site/concepts.md?raw";
import architecture from "../../../docs/site/architecture.md?raw";
import attestcoin from "../../../docs/site/attestcoin.md?raw";
import api from "../../../docs/site/api.md?raw";
import contracts from "../../../docs/site/contracts.md?raw";
import security from "../../../docs/site/security.md?raw";
import operations from "../../../docs/site/operations.md?raw";
import faq from "../../../docs/site/faq.md?raw";
import changelog from "../../../docs/site/changelog.md?raw";

export type DocPage = {
  slug: string;
  title: string;
  group: "Start" | "Understand" | "Reference" | "Run";
  summary: string;
  markdown: string;
};

export const DOCS: DocPage[] = [
  { slug: "introduction", title: "Introduction", group: "Start", summary: "What SignalProof is, who it is for, what is real.", markdown: introduction },
  { slug: "quickstart", title: "Quickstart", group: "Start", summary: "Run it read-only, with a relayer, or in a container.", markdown: quickstart },
  { slug: "concepts", title: "Concepts", group: "Understand", summary: "Measurements, cells, admission vs payment, status, score, rewards.", markdown: concepts },
  { slug: "architecture", title: "Architecture", group: "Understand", summary: "Components, the flow of one measurement, the read model.", markdown: architecture },
  { slug: "attestcoin", title: "Attestcoin integration", group: "Understand", summary: "Precompiles, ASCBase, the batch route, recorded runs.", markdown: attestcoin },
  { slug: "api", title: "API reference", group: "Reference", summary: "The /v1 buyer API, access keys, the tRPC gateway, error codes.", markdown: api },
  { slug: "contracts", title: "Smart contracts", group: "Reference", summary: "Addresses, interfaces, errors, tests, deploying.", markdown: contracts },
  { slug: "security", title: "Security model", group: "Reference", summary: "Trust boundary, controls by attack, findings, known limitations.", markdown: security },
  { slug: "operations", title: "Operations", group: "Run", summary: "Configuration, worker modes, deployment, the ops panel, runbook.", markdown: operations },
  { slug: "faq", title: "FAQ and glossary", group: "Run", summary: "Short answers and the vocabulary.", markdown: faq },
  { slug: "changelog", title: "Changelog", group: "Run", summary: "What shipped, newest first.", markdown: changelog },
];

export const DOC_GROUPS: DocPage["group"][] = ["Start", "Understand", "Reference", "Run"];

export function findDoc(slug: string | undefined): DocPage | null {
  return DOCS.find((d) => d.slug === slug) ?? null;
}
