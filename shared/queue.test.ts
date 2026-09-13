import { describe, expect, it } from "vitest";
import { QUEUE_PAGE_SIZE, filterQueue, paginate, type QueueFilter } from "./queue";

/**
 * The proof queue used to show the six newest rows and nothing else. With fourteen measurements
 * from five contributors that hid most of the evidence. Filtering and paging are pure so the
 * dashboard's behaviour is pinned here rather than in a screenshot.
 */
type Row = { id: number; status: "SETTLED" | "AWAITING_ATTESTATION" };
const rows: Row[] = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1,
  status: i % 3 === 0 ? "AWAITING_ATTESTATION" : "SETTLED",
}));

describe("filterQueue", () => {
  it("keeps everything for 'all'", () => {
    expect(filterQueue(rows, "all")).toHaveLength(14);
  });
  it("keeps only settled rows for 'settled'", () => {
    const out = filterQueue(rows, "settled");
    expect(out).toHaveLength(9);
    expect(out.every((r) => r.status === "SETTLED")).toBe(true);
  });
  it("keeps only rows still awaiting attestation for 'awaiting'", () => {
    const out = filterQueue(rows, "awaiting");
    expect(out).toHaveLength(5);
    expect(out.every((r) => r.status === "AWAITING_ATTESTATION")).toBe(true);
  });
});

describe("paginate", () => {
  it("cuts the list into pages of the configured size and reports the range shown", () => {
    const page = paginate(rows, 0, QUEUE_PAGE_SIZE);
    expect(page.items.map((r) => r.id)).toEqual(rows.slice(0, QUEUE_PAGE_SIZE).map((r) => r.id));
    expect(page.pageCount).toBe(Math.ceil(14 / QUEUE_PAGE_SIZE));
    expect(page.from).toBe(1);
    expect(page.to).toBe(QUEUE_PAGE_SIZE);
    expect(page.total).toBe(14);
  });

  it("gives a short last page and clamps a page index past the end", () => {
    const last = paginate(rows, 99, 8);
    expect(last.page).toBe(1);
    expect(last.items.map((r) => r.id)).toEqual([9, 10, 11, 12, 13, 14]);
    expect(last.from).toBe(9);
    expect(last.to).toBe(14);
  });

  it("handles an empty list without inventing a page", () => {
    const empty = paginate([], 3, 8);
    expect(empty).toEqual({ items: [], page: 0, pageCount: 0, from: 0, to: 0, total: 0 });
  });

  it("exposes the filter names the UI offers", () => {
    const filters: QueueFilter[] = ["all", "settled", "awaiting"];
    expect(filters).toHaveLength(3);
  });
});
