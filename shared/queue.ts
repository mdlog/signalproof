/**
 * Filtering and paging for the proof queue — pure, so the dashboard's list behaviour is testable.
 */

export type QueueFilter = "all" | "settled" | "awaiting";

/** Rows per page. Eight keeps a page under one screen with the proof inspector open on a row. */
export const QUEUE_PAGE_SIZE = 8;

type HasStatus = { status: "SETTLED" | "AWAITING_ATTESTATION" };

export function filterQueue<T extends HasStatus>(rows: T[], filter: QueueFilter): T[] {
  if (filter === "settled") return rows.filter((r) => r.status === "SETTLED");
  if (filter === "awaiting") return rows.filter((r) => r.status === "AWAITING_ATTESTATION");
  return rows;
}

export type Page<T> = {
  items: T[];
  /** Zero-based, clamped to the last page. */
  page: number;
  pageCount: number;
  /** One-based positions of the first and last item shown; 0 when the list is empty. */
  from: number;
  to: number;
  total: number;
};

export function paginate<T>(rows: T[], requestedPage: number, pageSize: number): Page<T> {
  const total = rows.length;
  if (total === 0) return { items: [], page: 0, pageCount: 0, from: 0, to: 0, total: 0 };
  const pageCount = Math.ceil(total / pageSize);
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const start = page * pageSize;
  const items = rows.slice(start, start + pageSize);
  return { items, page, pageCount, from: start + 1, to: start + items.length, total };
}
