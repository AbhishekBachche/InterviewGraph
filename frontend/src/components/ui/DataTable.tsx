import { forwardRef, useMemo, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

export type DataTableProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
};

export const DataTable = forwardRef<HTMLDivElement, DataTableProps>(function DataTable(
  { title, subtitle, children, className, ...props },
  ref
) {
  return (
    <div ref={ref} className={cn("he-data-table", "card", className)} data-slot="data-table" {...props}>
      {title ? <h3 className="section-title">{title}</h3> : null}
      {subtitle ? <div className="he-data-table__sub">{subtitle}</div> : null}
      <div className="he-data-table__scroll table-wrap">{children}</div>
    </div>
  );
});

DataTable.displayName = "DataTable";

export type TablePaginationProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  meta?: ReactNode;
  className?: string;
};

export function TablePagination({
  currentPage,
  totalPages,
  onPageChange,
  meta,
  className,
}: TablePaginationProps) {
  const chips = useMemo(() => {
    if (totalPages <= 1) return [] as Array<number | "…">;
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const out: Array<number | "…"> = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    if (start > 2) out.push("…");
    for (let p = start; p <= end; p += 1) out.push(p);
    if (end < totalPages - 1) out.push("…");
    out.push(totalPages);
    return out;
  }, [currentPage, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <nav className={cn("datahub-pagination", "he-table-pagination", className)} aria-label="Table pagination">
      {meta ? <span className="datahub-pagination__meta">{meta}</span> : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
      >
        Prev
      </Button>
      {chips.map((chip, idx) =>
        chip === "…" ? (
          <span key={`ellipsis-${idx}`} className="datahub-page-ellipsis" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={chip}
            type="button"
            className={cn(
              "datahub-page-btn",
              chip === currentPage && "datahub-page-btn--active"
            )}
            aria-current={chip === currentPage ? "page" : undefined}
            onClick={() => onPageChange(chip)}
          >
            {chip}
          </button>
        )
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
      >
        Next
      </Button>
    </nav>
  );
}
