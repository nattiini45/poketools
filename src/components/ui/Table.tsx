"use client";

import Link from "next/link";
import { useMemo, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { motion, type Variants } from "@/components/shared/motion";
import { cn } from "@/lib/utils/cn";
import {
  cycleColumnSort,
  type ColumnSortState,
  type SortDirection,
  TABLE_PAGE_SIZES,
  type TablePageSize,
} from "@/lib/ui/table-params";
import { useClientTable } from "@/lib/ui/use-client-table";
import { useMessages } from "@/i18n/client";
import { uiMessages } from "@/i18n/messages/ui";
import Select from "./Select";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T, index: number) => ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
  sortable?: boolean;
  sortValue?: (row: T) => number | string | null | undefined;
}

export interface TableRowExtraProps {
  className?: string;
  onMouseEnter?: HTMLAttributes<HTMLTableRowElement>["onMouseEnter"];
  onMouseLeave?: HTMLAttributes<HTMLTableRowElement>["onMouseLeave"];
  onClick?: HTMLAttributes<HTMLTableRowElement>["onClick"];
  onKeyDown?: HTMLAttributes<HTMLTableRowElement>["onKeyDown"];
  tabIndex?: number;
  role?: HTMLAttributes<HTMLTableRowElement>["role"];
  "aria-label"?: string;
  "aria-pressed"?: boolean;
}

/**
 * The pagination chrome's words. Plain strings, so a server page can hand
 * them to this client component; the counts go in through placeholders.
 * Optional override: without it the chrome speaks the viewer's language
 * (`ui.table` in `src/i18n/messages/ui`).
 */
export interface TablePaginationLabels {
  /** The range line; `{start}`, `{end}` and `{total}` are filled in. */
  showing: string;
  /** The page-size picker's visible label. */
  rows: string;
  /** The page-size select's accessible name. */
  rowsPerPage: string;
  /** The page navigation's accessible name. */
  pagination: string;
  previousPage: string;
  nextPage: string;
  /** A page button's accessible name; `{page}` is filled in. */
  page: string;
}

/** The English chrome (`ui.table` in English); kept for callers that need the literal defaults. */
export const DEFAULT_TABLE_PAGINATION_LABELS: TablePaginationLabels = uiMessages.en.table;

function fillLabel(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  animated?: boolean;
  /** Initial sort when using the built-in client engine. */
  defaultSort?: ColumnSortState | null;
  onSortChange?: (state: ColumnSortState | null) => void;
  /**
   * When false, `data` is rendered as-is and sort/pagination are controlled
   * externally (e.g. WikiIndexTable URL shell).
   */
  clientEngine?: boolean;
  sort?: ColumnSortState | null;
  onSort?: (column: string) => void;
  page?: number;
  perPage?: TablePageSize;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onPerPageChange?: (perPage: TablePageSize) => void;
  /** Hide pagination bar (e.g. when shell renders its own pager above). */
  hidePagination?: boolean;
  /** Optional per-row attributes (class, hover/click/key handlers, ARIA) layered over the row defaults. */
  getRowProps?: (row: T, index: number) => TableRowExtraProps;
  /** The pagination chrome's words; the viewer's language by default. */
  labels?: TablePaginationLabels;
}

const alignClass = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const tbodyVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

export interface SortableTableHeaderProps {
  label: string;
  column: string;
  align?: "left" | "center" | "right";
  width?: string;
  sortState?: ColumnSortState | null;
  /** Client mode: called when header is clicked */
  onSort?: (column: string) => void;
  /** Server mode: href for the next sort state */
  href?: string;
  className?: string;
}

export function SortableTableHeader({
  label,
  column,
  align = "left",
  width,
  sortState,
  onSort,
  href,
  className,
}: SortableTableHeaderProps) {
  const isActive = sortState?.key === column;
  const direction = isActive ? sortState?.direction : undefined;

  const content = (
    <>
      <span>{label}</span>
      <SortIcon active={isActive} direction={direction} />
    </>
  );

  const buttonClass = cn(
    "inline-flex items-center gap-1 font-heading font-semibold transition-colors hover:text-poke-text-primary",
    align === "center" && "justify-center w-full",
    align === "right" && "justify-end w-full flex-row-reverse",
    isActive && "text-poke-text-primary"
  );

  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-3 font-heading text-xs font-semibold uppercase tracking-wide text-poke-text-secondary",
        alignClass[align],
        className
      )}
      style={width ? { width } : undefined}
      aria-sort={
        isActive
          ? direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      {href ? (
        <Link href={href} className={buttonClass}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={() => onSort?.(column)} className={buttonClass}>
          {content}
        </button>
      )}
    </th>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction?: SortDirection;
}) {
  const className = cn(
    "h-3.5 w-3.5 shrink-0",
    active ? "text-poke-text-primary" : "text-poke-text-muted opacity-60"
  );
  if (!active || !direction) {
    return <ArrowUpDown className={className} aria-hidden="true" />;
  }
  if (direction === "asc") {
    return <ArrowUp className={className} aria-hidden="true" />;
  }
  return <ArrowDown className={className} aria-hidden="true" />;
}

export interface TablePaginationProps {
  page: number;
  totalPages: number;
  perPage: TablePageSize;
  totalItems: number;
  /** Client mode */
  onPageChange?: (page: number) => void;
  onPerPageChange?: (perPage: TablePageSize) => void;
  /**
   * Server mode: pre-computed hrefs (serializable) keyed by page number.
   * Use this instead of `pageHref`/`perPageHref` functions, which cannot be
   * passed from a Server Component to this Client Component.
   */
  pageHrefs?: Record<number, string>;
  perPageHrefs?: Record<number, string>;
  className?: string;
  /** The chrome's words; the viewer's language by default. */
  labels?: TablePaginationLabels;
}

export function TablePagination({
  page,
  totalPages,
  perPage,
  totalItems,
  onPageChange,
  onPerPageChange,
  pageHrefs,
  perPageHrefs,
  className,
  labels: labelsOverride,
}: TablePaginationProps) {
  const localized = useMessages(uiMessages).table;
  const labels: TablePaginationLabels = labelsOverride ?? localized;
  const start = totalItems === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, totalItems);

  const pageNumbers = buildPageNumbers(page, totalPages);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-poke-text-muted",
        className
      )}
    >
      <span>{fillLabel(labels.showing, { start, end, total: totalItems })}</span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <span>{labels.rows}</span>
          {perPageHrefs ? (
            <span className="inline-flex gap-1">
              {TABLE_PAGE_SIZES.map((size) => (
                <Link
                  key={size}
                  href={perPageHrefs[size] ?? '#'}
                  className={cn(
                    "rounded-poke-md border px-2 py-1 text-xs transition-colors",
                    size === perPage
                      ? "border-poke-accent bg-poke-accent-light text-poke-accent"
                      : "border-poke-border bg-poke-surface hover:bg-poke-elevated"
                  )}
                >
                  {size}
                </Link>
              ))}
            </span>
          ) : (
            <Select
              value={String(perPage)}
              onChange={(e) =>
                onPerPageChange?.(Number(e.target.value) as TablePageSize)
              }
              className="h-8 w-[72px] py-1 text-xs"
              aria-label={labels.rowsPerPage}
            >
              {TABLE_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          )}
        </label>
        <nav aria-label={labels.pagination} className="flex items-center gap-1">
          <PaginationButton
            disabled={page <= 1}
            href={pageHrefs?.[page - 1]}
            onClick={() => onPageChange?.(page - 1)}
            aria-label={labels.previousPage}
          >
            <ChevronLeft className="h-4 w-4" />
          </PaginationButton>
          {pageNumbers.map((num, i) =>
            num === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className="px-1">
                …
              </span>
            ) : (
              <PaginationButton
                key={num}
                active={num === page}
                href={pageHrefs?.[num]}
                onClick={() => onPageChange?.(num)}
                aria-label={fillLabel(labels.page, { page: num })}
                aria-current={num === page ? "page" : undefined}
              >
                {num}
              </PaginationButton>
            )
          )}
          <PaginationButton
            disabled={page >= totalPages}
            href={pageHrefs?.[page + 1]}
            onClick={() => onPageChange?.(page + 1)}
            aria-label={labels.nextPage}
          >
            <ChevronRight className="h-4 w-4" />
          </PaginationButton>
        </nav>
      </div>
    </div>
  );
}

function PaginationButton({
  children,
  disabled,
  active,
  href,
  onClick,
  ...props
}: {
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  href?: string;
  onClick?: () => void;
} & React.AriaAttributes) {
  const className = cn(
    "inline-flex h-8 min-w-8 items-center justify-center rounded-poke-md border text-xs font-medium transition-colors",
    active
      ? "border-poke-accent bg-poke-accent-light text-poke-accent"
      : "border-poke-border bg-poke-surface text-poke-text-secondary hover:bg-poke-elevated",
    disabled && "pointer-events-none opacity-40"
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={className} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" className={className} disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  );
}

function buildPageNumbers(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: Array<number | "ellipsis"> = [1];
  if (current > 3) pages.push("ellipsis");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

function defaultSortAccessor<T>(row: T, key: string): number | string | null | undefined {
  const value = (row as Record<string, unknown>)[key];
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  return null;
}

export default function Table<T extends object>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = "No data",
  animated = false,
  defaultSort = null,
  onSortChange,
  clientEngine = true,
  sort: controlledSort,
  onSort: controlledOnSort,
  page: controlledPage,
  perPage: controlledPerPage,
  totalItems: controlledTotalItems,
  onPageChange: controlledOnPageChange,
  onPerPageChange: controlledOnPerPageChange,
  hidePagination = false,
  getRowProps,
  labels,
}: TableProps<T>) {
  const sortConfigs = useMemo(
    () =>
      columns
        .filter((col) => col.sortable)
        .map((col) => ({
          key: col.key,
          accessor: (row: T) =>
            col.sortValue?.(row) ?? defaultSortAccessor(row, col.key),
        })),
    [columns],
  );

  const engine = useClientTable(data, sortConfigs, defaultSort);

  const sort = clientEngine ? engine.sort : (controlledSort ?? null);
  const pageRows = clientEngine ? engine.pageRows : data;
  const page = clientEngine ? engine.page : (controlledPage ?? 1);
  const perPage = clientEngine ? engine.perPage : (controlledPerPage ?? 20);
  const totalPages = clientEngine
    ? engine.totalPages
    : Math.max(1, Math.ceil((controlledTotalItems ?? data.length) / perPage));
  const totalItems = clientEngine ? engine.totalItems : (controlledTotalItems ?? data.length);
  const rowOffset = clientEngine ? (engine.page - 1) * engine.perPage : 0;

  function handleHeaderClick(columnKey: string) {
    if (clientEngine) {
      const next = cycleColumnSort(sort, columnKey);
      engine.handleSort(columnKey);
      onSortChange?.(next);
    } else {
      controlledOnSort?.(columnKey);
    }
  }

  const Tbody = animated ? motion.tbody : "tbody";
  const Tr = animated ? motion.tr : "tr";

  const tbodyProps = animated
    ? { variants: tbodyVariants, initial: "hidden" as const, animate: "visible" as const }
    : {};

  return (
    <div className="space-y-3">
      {clientEngine && !hidePagination && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          perPage={perPage}
          totalItems={totalItems}
          onPageChange={engine.setPage}
          onPerPageChange={engine.handlePerPageChange}
          labels={labels}
        />
      )}
      <div className="overflow-x-auto rounded-poke-lg border border-poke-border bg-poke-surface shadow-poke-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-poke-elevated border-b border-poke-border">
              {columns.map((col) => {
                if (col.sortable) {
                  return (
                    <SortableTableHeader
                      key={col.key}
                      label={col.header}
                      column={col.key}
                      align={col.align}
                      width={col.width}
                      sortState={sort}
                      onSort={handleHeaderClick}
                    />
                  );
                }

                const align = col.align || "left";
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-4 py-3 font-heading text-xs font-semibold uppercase tracking-wide text-poke-text-secondary",
                      alignClass[align]
                    )}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <Tbody {...tbodyProps}>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-poke-text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row, i) => {
                const globalIndex = rowOffset + i;
                const extraRowProps = getRowProps?.(row, globalIndex);
                const hasRowClick = Boolean(onRowClick || extraRowProps?.onClick);

                function handleRowClick(event: MouseEvent<HTMLTableRowElement>) {
                  extraRowProps?.onClick?.(event);
                  if (!event.defaultPrevented && onRowClick) {
                    onRowClick(row);
                  }
                }

                return (
                <Tr
                  key={keyExtractor(row, globalIndex)}
                  {...(animated ? { variants: rowVariants } : {})}
                  className={cn(
                    "border-b border-poke-border last:border-0 transition-colors duration-150",
                    hasRowClick
                      ? "hover:bg-poke-elevated cursor-pointer"
                      : "hover:bg-poke-elevated/50",
                    extraRowProps?.className
                  )}
                  onMouseEnter={extraRowProps?.onMouseEnter}
                  onMouseLeave={extraRowProps?.onMouseLeave}
                  onClick={hasRowClick ? handleRowClick : undefined}
                  onKeyDown={extraRowProps?.onKeyDown}
                  tabIndex={extraRowProps?.tabIndex}
                  role={extraRowProps?.role}
                  aria-label={extraRowProps?.["aria-label"]}
                  aria-pressed={extraRowProps?.["aria-pressed"]}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn("px-4 py-3", alignClass[col.align || "left"])}
                    >
                      {col.render
                        ? col.render(row, globalIndex)
                        : ((row as Record<string, unknown>)[col.key] as ReactNode)}
                    </td>
                  ))}
                </Tr>
                );
              })
            )}
          </Tbody>
        </table>
      </div>
      {clientEngine && !hidePagination && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          perPage={perPage}
          totalItems={totalItems}
          onPageChange={engine.setPage}
          onPerPageChange={engine.handlePerPageChange}
          className="justify-end"
          labels={labels}
        />
      )}
      {!clientEngine && controlledOnPageChange && controlledOnPerPageChange && !hidePagination && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          perPage={perPage}
          totalItems={totalItems}
          onPageChange={controlledOnPageChange}
          onPerPageChange={controlledOnPerPageChange}
          className="justify-end"
          labels={labels}
        />
      )}
    </div>
  );
}
