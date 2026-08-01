"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  className = "",
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const hasPreviousPage = currentPage > 1;
  const hasNextPage = currentPage < totalPages;

  return (
    <div
      className={`pagination-container ${className}`}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        padding: "0.75rem 0",
        marginTop: "1rem",
        borderTop: "1px solid var(--border, #e5e7eb)",
        fontSize: "0.85rem",
      }}
    >
      {/* Item Range & Total */}
      <div style={{ color: "var(--muted, #6b7280)", fontWeight: 500 }}>
        Showing <strong>{startItem}</strong> - <strong>{endItem}</strong> of <strong>{totalItems}</strong> records
      </div>

      {/* Controls & Page Size Selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {onPageSizeChange && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ color: "var(--muted, #6b7280)" }}>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              style={{
                padding: "0.25rem 0.4rem",
                borderRadius: "6px",
                border: "1px solid var(--border, #e5e7eb)",
                background: "transparent",
                fontSize: "0.8rem",
              }}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Page Nav Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <button
            type="button"
            disabled={!hasPreviousPage}
            onClick={() => onPageChange(currentPage - 1)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.35rem 0.5rem",
              borderRadius: "6px",
              border: "1px solid var(--border, #e5e7eb)",
              background: !hasPreviousPage ? "rgba(0,0,0,0.03)" : "transparent",
              color: !hasPreviousPage ? "var(--muted)" : "inherit",
              cursor: !hasPreviousPage ? "not-allowed" : "pointer",
            }}
            aria-label="Previous Page"
          >
            <ChevronLeft size={16} />
          </button>

          <span style={{ fontWeight: 600, padding: "0 0.35rem" }}>
            Page {currentPage} of {totalPages}
          </span>

          <button
            type="button"
            disabled={!hasNextPage}
            onClick={() => onPageChange(currentPage + 1)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.35rem 0.5rem",
              borderRadius: "6px",
              border: "1px solid var(--border, #e5e7eb)",
              background: !hasNextPage ? "rgba(0,0,0,0.03)" : "transparent",
              color: !hasNextPage ? "var(--muted)" : "inherit",
              cursor: !hasNextPage ? "not-allowed" : "pointer",
            }}
            aria-label="Next Page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
