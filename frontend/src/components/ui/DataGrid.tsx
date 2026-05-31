import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { TableSkeleton } from "./Skeleton";

export type DataGridColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  className?: string;
  headerClassName?: string;
};

export type DataGridProps<T> = {
  columns: DataGridColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  title?: string;
  subtitle?: ReactNode;
  loading?: boolean;
  skeletonRows?: number;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: { label: string; onClick: () => void };
  tableClassName?: string;
  className?: string;
};

export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  title,
  subtitle,
  loading = false,
  skeletonRows = 6,
  emptyTitle = "No data",
  emptyDescription,
  emptyAction,
  tableClassName = "admin-user-table",
  className,
}: DataGridProps<T>) {
  return (
    <DataTable title={title} subtitle={subtitle} className={className}>
      {loading ? (
        <TableSkeleton rows={skeletonRows} columns={Math.min(columns.length, 5)} />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        <table className={cn(tableClassName)}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.headerClassName}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={rowKey(row, idx)}>
                {columns.map((col) => (
                  <td key={col.key} className={col.className}>
                    {col.render(row, idx)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DataTable>
  );
}
