import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Table.
 *
 * The design's table is a money table, and its geometry says so: one flexible
 * label column and fixed right-aligned numeric columns, so that figures line up
 * on the decimal down the whole page. That is why the columns are described
 * here as data rather than left to each caller's markup — a caller that lays
 * its own cells out will drift out of alignment with the next table on the
 * screen.
 *
 * `notCharged` is a column KIND, not a colour choice. The design paints it
 * teal-600 in every row, including the totals, because it is the counterfactual
 * the whole product exists to show.
 */

export type TableColumnAlign = "start" | "end";

export interface TableColumn<T> {
  /** Stable key, also used as the React key. */
  key: string;
  /** Header label. Taken verbatim from the design where one exists. */
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode;
  /**
   * Fixed column width in px. Omit for the label column, which flexes to fill.
   * The design uses 110 for counts and money, 130 for "Not charged", 90 for
   * rates and latencies.
   */
  width?: number;
  align?: TableColumnAlign;
  /** Renders the value in teal-600 — reserved for the "not charged" figure. */
  notCharged?: boolean;
  /** Monospace figures. True for every numeric column in the design. */
  mono?: boolean;
  /**
   * Let this column's text overflow rather than ellipsise.
   *
   * Every value is `truncate` by default, which is right for a figure. It is
   * wrong for a sentence the design deliberately lets run: the SLA screen's "no
   * provider serves this yet" measures 211px in a 170px cell, and the design
   * lets it bleed. Ellipsising it turned the one row that carries the screen's
   * point into "no provider serves t…".
   */
  noTruncate?: boolean;
}

const alignClass: Record<TableColumnAlign, string> = {
  start: "justify-start text-left",
  end: "justify-end text-right",
};

function cellWidthStyle(width?: number): React.CSSProperties {
  return width == null ? { flex: "1 1 0%", minWidth: 0 } : { width, flexShrink: 0 };
}

interface TableCellProps {
  align: TableColumnAlign;
  width?: number;
  className?: string;
  children: React.ReactNode;
}

function TableCell({ align, width, className, children }: TableCellProps) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-[7px]", alignClass[align], className)}
      style={cellWidthStyle(width)}
    >
      {children}
    </div>
  );
}

export interface TableRowData {
  /** Stable row key. */
  id: string;
  /** Rows nested under this one. The design draws them on bg-02, indented. */
  drill?: TableRowData[];
}

export interface TableProps<T extends TableRowData> extends React.HTMLAttributes<HTMLDivElement> {
  columns: TableColumn<T>[];
  rows: T[];
  /**
   * Totals row. Columns with no total simply render nothing — the design leaves
   * the Fail and p95 totals blank rather than summing quantities that do not
   * add up.
   */
  total?: { label: React.ReactNode; values: Partial<Record<string, React.ReactNode>> };
  /** Which rows are expanded, by row id. Controlled. */
  expanded?: string[];
  onToggleRow?: (id: string) => void;
  caption?: string;
}

function Caret({ open }: { open: boolean }) {
  return (
    <ChevronRight
      width={14}
      height={14}
      strokeWidth={1.5}
      aria-hidden="true"
      className={cn("shrink-0 text-03 transition-transform", open && "rotate-90")}
    />
  );
}

function valueClass(col: TableColumn<never>, muted: boolean, strong: boolean) {
  return cn(
    col.mono ? "font-mono" : "font-sans",
    col.mono ? (strong ? "text-mono-13 font-semibold" : "text-mono-13") : "text-label-sm",
    col.notCharged ? "text-teal-600" : muted ? "text-02" : "text-01",
  );
}

export function Table<T extends TableRowData>({
  columns,
  rows,
  total,
  expanded = [],
  onToggleRow,
  caption,
  className,
  ...props
}: TableProps<T>) {
  const expandable = Boolean(onToggleRow);

  return (
    <div className={cn("w-full", className)} role="table" aria-label={caption} {...props}>
      <div
        role="row"
        className="flex items-center gap-3 border-b border-02 pb-[9px] pl-3 pr-3"
      >
        {columns.map((col) => (
          <TableCell key={col.key} align={col.align ?? (col.width == null ? "start" : "end")} width={col.width}>
            <span role="columnheader" className="font-mono text-mono-2xs tracking-[1.1px] text-03">
              {col.header}
            </span>
          </TableCell>
        ))}
      </div>

      {rows.map((row) => {
        const isOpen = expanded.includes(row.id);
        const hasDrill = Boolean(row.drill?.length);

        return (
          <React.Fragment key={row.id}>
            <div
              role="row"
              aria-expanded={hasDrill ? isOpen : undefined}
              tabIndex={hasDrill && expandable ? 0 : undefined}
              onClick={hasDrill && expandable ? () => onToggleRow?.(row.id) : undefined}
              onKeyDown={
                hasDrill && expandable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggleRow?.(row.id);
                      }
                    }
                  : undefined
              }
              className={cn(
                "flex items-center gap-3 border-b border-01 px-3 py-[11px]",
                isOpen && "bg-02",
                hasDrill && expandable &&
                  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              )}
            >
              {columns.map((col, i) => (
                <TableCell
                  key={col.key}
                  align={col.align ?? (col.width == null ? "start" : "end")}
                  width={col.width}
                >
                  {i === 0 && hasDrill ? <Caret open={isOpen} /> : null}
                  <span className={cn(valueClass(col as TableColumn<never>, false, false), !col.noTruncate && "truncate")}>
                    {col.cell(row)}
                  </span>
                </TableCell>
              ))}
            </div>

            {isOpen &&
              row.drill?.map((sub) => (
                <div
                  key={sub.id}
                  role="row"
                  className="flex items-center gap-3 border-b border-01 bg-02 px-3 py-[11px]"
                >
                  {columns.map((col, i) => (
                    <TableCell
                      key={col.key}
                      align={col.align ?? (col.width == null ? "start" : "end")}
                      width={col.width == null ? undefined : col.width}
                      className={i === 0 ? "pl-6" : undefined}
                    >
                      <span
                        className={cn(
                          !col.noTruncate && "truncate",
                          // Drill rows render the label in mono too — they are
                          // provider ids, not tool names.
                          i === 0
                            ? "font-mono text-mono-13 text-02"
                            : valueClass(col as TableColumn<never>, true, false),
                        )}
                      >
                        {col.cell(sub as unknown as T)}
                      </span>
                    </TableCell>
                  ))}
                </div>
              ))}
          </React.Fragment>
        );
      })}

      {total ? (
        <div role="row" className="flex items-center gap-3 border-b border-01 bg-02 px-3 py-[13px]">
          {columns.map((col, i) => (
            <TableCell
              key={col.key}
              align={col.align ?? (col.width == null ? "start" : "end")}
              width={col.width}
            >
              <span
                className={cn(
                  // The design writes the total's label in the same mono/600 as
                  // every other cell in that row, not in sans — and the row is
                  // filled rather than separated by a top rule, which also
                  // stopped it stacking a second border under the last data row.
                  valueClass(col as TableColumn<never>, false, true),
                )}
              >
                {i === 0 ? total.label : total.values[col.key]}
              </span>
            </TableCell>
          ))}
        </div>
      ) : null}
    </div>
  );
}
