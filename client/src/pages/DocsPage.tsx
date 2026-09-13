/**
 * Documentation, served from the same shell as the product. The pages are markdown in
 * docs/site/, bundled at build time and rendered here: grouped navigation and search on the
 * left, the article in the middle, the article's own headings on the right. Every heading gets
 * the id the table of contents computed from the same source line, so anchors always agree.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowRight, BookOpen, Check, Copy, ExternalLink, Link2, Search } from "lucide-react";
import PageFrame from "@/components/PageFrame";
import { DOCS, DOC_GROUPS, findDoc, type DocPage } from "@/docs/manifest";
import { docLinkTarget, extractHeadings, slugifyHeading } from "@shared/docsToc";
import { searchDocs } from "@shared/docsSearch";

const REPO = "https://github.com/mdlog/signalproof";

/** react-markdown hands each component its hast node; these are the shapes this page reads. */
type Element = NonNullable<ExtraProps["node"]>;
type Node = Element | Element["children"][number];

/** Text of a hast subtree, for heading ids and the copy button. */
function textOf(node: Node | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if ("children" in node) return node.children.map((c) => textOf(c)).join("");
  return "";
}

/** Arriving on a page: land on the anchor (or the top) at once, not after a smooth-scroll animation. */
function scrollToHash(): void {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) {
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
}

function CodeBlock({ node, children }: { node?: Element; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = textOf(node);
  const code = node?.children[0];
  const language = /language-([\w-]+)/.exec(code?.type === "element" ? String(code.properties?.className ?? "") : "")?.[1];
  // `not-prose`: the typography plugin styles code for running text; a block is styled here, once.
  return (
    <div className="not-prose group relative my-5 rounded-xl bg-[#102A43]">
      {language ? <span className="absolute left-4 top-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">{language}</span> : null}
      <button
        type="button"
        aria-label="Copy code"
        onClick={() => {
          void navigator.clipboard?.writeText(text.replace(/\n$/, "")).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
        className="absolute right-2 top-1.5 inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/70 opacity-0 transition-opacity hover:bg-white/20 hover:text-white focus:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto px-4 pb-4 pt-7 font-mono text-[12.5px] leading-relaxed text-[#E6F0F6] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">{children}</pre>
    </div>
  );
}

export default function DocsPage() {
  const params = useParams<{ slug?: string }>();
  const [location, navigate] = useLocation();
  const doc = findDoc(params.slug ?? "introduction");
  const index = doc ? DOCS.indexOf(doc) : -1;
  const prev = index > 0 ? DOCS[index - 1] : null;
  const next = index >= 0 && index < DOCS.length - 1 ? DOCS[index + 1] : null;

  const headings = useMemo(() => (doc ? extractHeadings(doc.markdown) : []), [doc]);
  const idByLine = useMemo(() => new Map(headings.map((h) => [h.line, h.id])), [headings]);
  // Memoised: the observer effect below keys on it, and a fresh array per render would re-arm the
  // observer after every state change it triggers.
  const onPage = useMemo(() => headings.filter((h) => h.level === 2 || h.level === 3), [headings]);

  // Scroll to the anchor on arrival (wouter keeps the hash on the URL but not in `location`).
  useEffect(() => {
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, [location]);

  // The right-hand list follows the reader: the heading nearest the top of the viewport is current.
  const [activeId, setActiveId] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = articleRef.current;
    // Arriving on an anchor, that heading is current; otherwise the first one is until the reader scrolls.
    const arrival = decodeURIComponent(window.location.hash.slice(1));
    setActiveId(onPage.some((h) => h.id === arrival) ? arrival : (onPage[0]?.id ?? null));
    if (!root || onPage.length === 0) return;
    const targets = onPage.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null);
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        if (visible.size > 0) setActiveId([...visible.entries()].sort((a, b) => a[1] - b[1])[0][0]);
      },
      { rootMargin: "-72px 0px -70% 0px", threshold: 0 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [onPage]);

  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchDocs(DOCS, query), [query]);

  const components = useMemo<Components>(() => {
    const heading = (level: 1 | 2 | 3 | 4) =>
      function Heading({ node, children }: { node?: Element; children?: ReactNode }) {
        const line = node?.position?.start.line;
        const id = (line !== undefined && idByLine.get(line)) || slugifyHeading(textOf(node));
        const Tag = `h${level}` as const;
        if (level === 1) return <Tag id={id}>{children}</Tag>;
        return (
          <Tag id={id} className="group scroll-mt-20">
            {children}
            <a href={`#${id}`} aria-label="Link to this section" className="ml-2 inline-flex align-middle text-[#9FB3C2] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
              <Link2 className="h-3.5 w-3.5" />
            </a>
          </Tag>
        );
      };
    return {
      h1: heading(1),
      h2: heading(2),
      h3: heading(3),
      h4: heading(4),
      a({ href = "", children }) {
        // Pages link to each other as sibling files so the markdown also reads on GitHub.
        const route = docLinkTarget(href);
        if (route) {
          const [path, hash] = route.split("#");
          const samePage = doc !== null && path === `/docs/${doc.slug}`;
          if (samePage && hash) return <a href={`#${hash}`}>{children}</a>;
          return <Link href={route}>{children}</Link>;
        }
        if (href.startsWith("#") || href.startsWith("/")) return <a href={href}>{children}</a>;
        return (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">
            {children}
            <ExternalLink className="ml-0.5 inline h-3 w-3 text-[#9FB3C2]" />
          </a>
        );
      },
      pre: CodeBlock,
      table({ children }) {
        return (
          <div className="my-5 overflow-x-auto rounded-xl border border-[#DCE5EB]">
            <table className="!my-0">{children}</table>
          </div>
        );
      },
    };
  }, [doc, idByLine]);

  if (!doc) {
    return (
      <PageFrame title="Docs" activeId="docs">
        <div className="mx-auto max-w-xl rounded-xl border border-[#DCE5EB] bg-white p-8 text-center">
          <BookOpen className="mx-auto h-6 w-6 text-[#9FB3C2]" />
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">No page called “{params.slug}”</h1>
          <p className="mt-2 text-sm text-[#6C8291]">The docs have {DOCS.length} pages; the introduction lists them.</p>
          <Link href="/docs" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#147A70] px-4 py-2 text-sm font-semibold text-white">Open the introduction</Link>
        </div>
      </PageFrame>
    );
  }

  const groupOf = (g: DocPage["group"]) => DOCS.filter((d) => d.group === g);

  return (
    <PageFrame title="Docs" activeId="docs">
      <div className="grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_210px]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9FB3C2]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the docs"
              aria-label="Search the docs"
              className="w-full rounded-lg border border-[#DCE5EB] bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[#9FB3C2] focus:border-[#147A70] focus:ring-2 focus:ring-[#147A70]/20"
            />
          </label>
          {query.trim().length >= 2 ? (
            <div className="mt-3 rounded-xl border border-[#DCE5EB] bg-white p-2" role="listbox" aria-label="Search results">
              {hits.length === 0 ? (
                <p className="px-2 py-3 text-xs text-[#6C8291]">Nothing matches “{query.trim()}”.</p>
              ) : (
                hits.map((h, i) => (
                  <Link
                    key={`${h.slug}-${h.headingId ?? "top"}-${i}`}
                    href={`/docs/${h.slug}${h.headingId ? `#${h.headingId}` : ""}`}
                    onClick={() => setQuery("")}
                    className="block rounded-lg px-2 py-2 hover:bg-[#F5F8FA]"
                  >
                    <div className="text-[10px] uppercase tracking-[0.13em] text-[#9FB3C2]">{h.title}{h.headingId ? ` › ${h.heading}` : ""}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-[#102A43]">{h.snippet}</div>
                  </Link>
                ))
              )}
            </div>
          ) : (
            <>
              <select
                aria-label="Go to page"
                value={doc.slug}
                onChange={(e) => navigate(`/docs/${e.target.value}`)}
                className="mt-3 w-full rounded-lg border border-[#DCE5EB] bg-white px-3 py-2 text-sm lg:hidden"
              >
                {DOC_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {groupOf(g).map((d) => <option key={d.slug} value={d.slug}>{d.title}</option>)}
                  </optgroup>
                ))}
              </select>
              <nav className="mt-4 hidden space-y-5 lg:block" aria-label="Documentation">
                {DOC_GROUPS.map((g) => (
                  <div key={g}>
                    <div className="px-2 font-mono text-[10px] uppercase tracking-[0.19em] text-[#F06A59]">{g}</div>
                    <ul className="mt-1.5 space-y-0.5">
                      {groupOf(g).map((d) => (
                        <li key={d.slug}>
                          <Link
                            href={`/docs/${d.slug}`}
                            aria-current={d.slug === doc.slug ? "page" : undefined}
                            className={`block rounded-lg px-2 py-1.5 text-sm transition-colors ${d.slug === doc.slug ? "bg-white font-semibold text-[#102A43] shadow-sm" : "text-[#4E6577] hover:bg-white/70 hover:text-[#102A43]"}`}
                          >
                            {d.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
            </>
          )}
        </aside>

        <article ref={articleRef} className="min-w-0">
          <div className="mb-5 flex items-center gap-2 text-xs text-[#6C8291]">
            <Link href="/docs" className="hover:text-[#147A70]">Docs</Link>
            <span>/</span>
            <span>{doc.group}</span>
            <span>/</span>
            <span className="text-[#102A43]">{doc.title}</span>
          </div>
          <div className="prose prose-slate max-w-none rounded-xl border border-[#DCE5EB] bg-white px-6 py-7 lg:px-10 lg:py-9 prose-headings:font-display prose-headings:tracking-tight prose-h1:text-4xl prose-h1:font-bold prose-h1:tracking-[-0.03em] prose-h2:mt-10 prose-h2:border-b prose-h2:border-[#EDF2F5] prose-h2:pb-2 prose-h2:text-2xl prose-h3:text-lg prose-p:text-[15px] prose-p:leading-relaxed prose-li:text-[15px] prose-a:font-medium prose-a:text-[#147A70] prose-a:no-underline hover:prose-a:underline prose-strong:text-[#102A43] prose-code:rounded-md prose-code:bg-[#F0F4F7] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[12.5px] prose-code:font-normal prose-code:text-[#0B4F47] prose-code:before:content-none prose-code:after:content-none prose-th:bg-[#F5F8FA] prose-th:px-3 prose-th:py-2 prose-th:text-xs prose-th:uppercase prose-th:tracking-[0.1em] prose-th:text-[#6C8291] prose-td:px-3 prose-td:py-2 prose-td:text-sm prose-td:align-top prose-blockquote:border-l-[#147A70] prose-blockquote:font-normal prose-blockquote:not-italic prose-blockquote:text-[#4E6577] [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none prose-hr:border-[#EDF2F5] prose-img:rounded-xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{doc.markdown}</ReactMarkdown>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-[#6C8291]">
            <a href={`${REPO}/blob/main/docs/site/${doc.slug}.md`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[#147A70]">Edit this page on GitHub <ExternalLink className="h-3 w-3" /></a>
            <span>Page {index + 1} of {DOCS.length}</span>
          </div>

          <nav className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Previous and next page">
            {prev ? (
              <Link href={`/docs/${prev.slug}`} className="group rounded-xl border border-[#DCE5EB] bg-white p-4 transition-colors hover:border-[#147A70]">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.13em] text-[#9FB3C2]"><ArrowLeft className="h-3 w-3" /> Previous</div>
                <div className="mt-1 font-semibold text-[#102A43] group-hover:text-[#147A70]">{prev.title}</div>
                <div className="mt-0.5 text-xs text-[#6C8291]">{prev.summary}</div>
              </Link>
            ) : <span />}
            {next ? (
              <Link href={`/docs/${next.slug}`} className="group rounded-xl border border-[#DCE5EB] bg-white p-4 text-right transition-colors hover:border-[#147A70]">
                <div className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-[0.13em] text-[#9FB3C2]">Next <ArrowRight className="h-3 w-3" /></div>
                <div className="mt-1 font-semibold text-[#102A43] group-hover:text-[#147A70]">{next.title}</div>
                <div className="mt-0.5 text-xs text-[#6C8291]">{next.summary}</div>
              </Link>
            ) : null}
          </nav>
        </article>

        <aside className="hidden xl:block">
          {onPage.length > 0 ? (
            <nav className="sticky top-6" aria-label="On this page">
              <div className="font-mono text-[10px] uppercase tracking-[0.19em] text-[#9FB3C2]">On this page</div>
              <ul className="mt-2 space-y-0.5 border-l border-[#DCE5EB]">
                {onPage.map((h) => (
                  <li key={h.id}>
                    <a
                      href={`#${h.id}`}
                      className={`-ml-px block border-l-2 py-1 text-xs leading-snug transition-colors ${h.level === 3 ? "pl-6" : "pl-3"} ${activeId === h.id ? "border-[#147A70] font-semibold text-[#147A70]" : "border-transparent text-[#4E6577] hover:text-[#102A43]"}`}
                    >
                      {h.text.replace(/[`]/g, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </aside>
      </div>
    </PageFrame>
  );
}
