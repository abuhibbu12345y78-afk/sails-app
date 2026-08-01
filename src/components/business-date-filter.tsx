import { ml } from "../lib/ui-text-ml";
import React, { useState } from "react";
import { Calendar as CalendarIcon, Filter, X, Check, ChevronDown } from "lucide-react";
import { Calendar } from "./ui/calendar";

export type DateFilterPreset =
  | "today"
  | "yesterday"
  | "last7"
  | "specificDate"
  | "specificMonth"
  | "previousMonth"
  | "customRange"
  | "all";

export interface DateFilterValue {
  preset: DateFilterPreset;
  singleDate?: string;
  month?: string;
  fromDate?: string;
  toDate?: string;
  status?: "ALL" | "EARNED" | "RECEIVED";
  productId?: string;
}

interface ProductOption {
  id: string;
  name: string;
}

interface BusinessDateFilterProps {
  value: DateFilterValue;
  onChange: (newValue: DateFilterValue) => void;
  products?: ProductOption[];
  showStatusFilter?: boolean;
  showProductFilter?: boolean;
  className?: string;
}

export function computeEffectiveDateRange(
  filter: DateFilterValue,
  todayStr: string
): { startDate?: string; endDate?: string; label: string } {
  const today = new Date(todayStr || new Date().toISOString().split("T")[0]);

  switch (filter.preset) {
    case "today": {
      const dateStr = today.toISOString().split("T")[0];
      return { startDate: dateStr, endDate: dateStr, label: `${ml.labels.today} (${dateStr})` };
    }
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split("T")[0];
      return { startDate: yStr, endDate: yStr, label: `${ml.labels.yesterday} (${yStr})` };
    }
    case "last7": {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      const startStr = start.toISOString().split("T")[0];
      const endStr = today.toISOString().split("T")[0];
      return { startDate: startStr, endDate: endStr, label: `${ml.labels.last7} (${startStr} - ${endStr})` };
    }
    case "specificDate": {
      const dateStr = filter.singleDate || today.toISOString().split("T")[0];
      return { startDate: dateStr, endDate: dateStr, label: `${ml.labels.specificDate}: ${dateStr}` };
    }
    case "specificMonth": {
      const mStr = filter.month || today.toISOString().slice(0, 7);
      const [year, month] = mStr.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        startDate: `${mStr}-01`,
        endDate: `${mStr}-${pad(lastDay)}`,
        label: `${ml.labels.specificMonth}: ${mStr}`,
      };
    }
    case "previousMonth": {
      const y = today.getFullYear();
      const m = today.getMonth(); // 0-indexed
      const prevDate = new Date(y, m - 1, 1);
      const prevMStr = prevDate.toISOString().slice(0, 7);
      const [year, month] = prevMStr.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        startDate: `${prevMStr}-01`,
        endDate: `${prevMStr}-${pad(lastDay)}`,
        label: `${ml.labels.previousMonth} (${prevMStr})`,
      };
    }
    case "customRange": {
      const from = filter.fromDate || today.toISOString().split("T")[0];
      const to = filter.toDate || today.toISOString().split("T")[0];
      return { startDate: from, endDate: to, label: `${ml.labels.customRange}: ${from} to ${to}` };
    }
    case "all":
    default:
      return { label: ml.labels.allTime };
  }
}

export function BusinessDateFilter({
  value,
  onChange,
  products = [],
  showStatusFilter = false,
  showProductFilter = false,
  className = "",
}: BusinessDateFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DateFilterValue>(value);
  const [prevValue, setPrevValue] = useState<DateFilterValue>(value);

  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value);
  }

  const activeRange = computeEffectiveDateRange(value, new Date().toISOString().split("T")[0]);

  const handleApply = () => {
    onChange(draft);
    setIsOpen(false);

    // Sync to URL Query Params
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("preset", draft.preset);
      if (draft.singleDate) url.searchParams.set("date", draft.singleDate);
      else url.searchParams.delete("date");
      if (draft.month) url.searchParams.set("month", draft.month);
      else url.searchParams.delete("month");
      if (draft.fromDate) url.searchParams.set("from", draft.fromDate);
      else url.searchParams.delete("from");
      if (draft.toDate) url.searchParams.set("to", draft.toDate);
      else url.searchParams.delete("to");
      if (draft.status && draft.status !== "ALL") url.searchParams.set("status", draft.status);
      else url.searchParams.delete("status");
      if (draft.productId) url.searchParams.set("product", draft.productId);
      else url.searchParams.delete("product");

      window.history.replaceState({}, "", url.toString());
    } catch {
      // Ignore URL sync in SSR
    }
  };

  const handleReset = () => {
    const defaultVal: DateFilterValue = { preset: "all" };
    setDraft(defaultVal);
    onChange(defaultVal);
    setIsOpen(false);

    try {
      const url = new URL(window.location.href);
      ["preset", "date", "month", "from", "to", "status", "product"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, "", url.toString());
    } catch {
      // Ignore
    }
  };

  const presets: { id: DateFilterPreset; label: string }[] = [
    { id: "today", label: ml.labels.today },
    { id: "yesterday", label: ml.labels.yesterday },
    { id: "last7", label: ml.labels.last7 },
    { id: "specificDate", label: ml.labels.specificDate },
    { id: "specificMonth", label: ml.labels.specificMonth },
    { id: "previousMonth", label: ml.labels.previousMonth },
    { id: "customRange", label: ml.labels.customRange },
    { id: "all", label: ml.labels.allTime },
  ];

  return (
    <div className={`business-date-filter-wrapper ${className}`} style={{ position: "relative", marginBottom: "1rem" }}>
      {/* Filter Trigger Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "var(--card-bg, #ffffff)",
          border: "1px solid var(--border, #e5e7eb)",
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", overflow: "hidden" }}>
          <CalendarIcon size={18} style={{ color: "var(--primary-color, #2563eb)", flexShrink: 0 }} />
          <div style={{ fontSize: "0.85rem", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: "var(--muted, #6b7280)", marginRight: "0.35rem" }}>Filter:</span>
            <strong>{activeRange.label}</strong>
            {value.status && value.status !== "ALL" && (
              <span className="badge" style={{ marginLeft: "0.5rem", fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}>
                {value.status}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          {value.preset !== "all" && (
            <button
              type="button"
              style={{
                background: "transparent",
                border: "none",
                padding: "0.2rem",
                cursor: "pointer",
                color: "var(--muted, #6b7280)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              title="Clear Filter"
            >
              <X size={16} />
            </button>
          )}
          <ChevronDown size={18} style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
        </div>
      </div>

      {/* Filter Modal / Popover Dropdown */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1rem",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", paddingBottom: "0.5rem", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
            <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Filter size={16} /> Filter Business Data
            </h4>
            <button
              type="button"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0.2rem" }}
              onClick={() => setIsOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          {/* Preset Buttons Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.4rem", marginBottom: "0.75rem" }}>
            {presets.map((p) => {
              const selected = draft.preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  style={{
                    padding: "0.45rem 0.6rem",
                    fontSize: "0.8rem",
                    fontWeight: selected ? 600 : 400,
                    borderRadius: "6px",
                    border: selected ? "1.5px solid var(--primary-color, #2563eb)" : "1px solid var(--border, #e5e7eb)",
                    background: selected ? "rgba(37, 99, 235, 0.08)" : "transparent",
                    color: selected ? "var(--primary-color, #2563eb)" : "inherit",
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                  onClick={() => setDraft({ ...draft, preset: p.id })}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Preset Specific Controls with Shadcn UI Calendar */}
          {draft.preset === "specificDate" && (
            <div style={{ margin: "0.75rem 0", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem", width: "100%", textAlign: "left" }}>
                Select Specific Business Date
              </label>
              <Calendar
                selectedDate={draft.singleDate || new Date().toISOString().split("T")[0]}
                onSelectDate={(dateStr) => setDraft({ ...draft, singleDate: dateStr })}
                maxDate={new Date().toISOString().split("T")[0]}
              />
            </div>
          )}

          {draft.preset === "specificMonth" && (
            <div style={{ margin: "0.75rem 0" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem", display: "block" }}>
                Select Month
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.4rem" }}>
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, idx) => {
                  const mNum = String(idx + 1).padStart(2, "0");
                  const currentYr = draft.month ? draft.month.split("-")[0] : new Date().getFullYear().toString();
                  const targetMonth = `${currentYr}-${mNum}`;
                  const selected = draft.month === targetMonth;

                  return (
                    <button
                      key={m}
                      type="button"
                      style={{
                        padding: "0.5rem",
                        fontSize: "0.8rem",
                        fontWeight: selected ? 600 : 400,
                        borderRadius: "6px",
                        border: selected ? "1.5px solid var(--primary-color, #2563eb)" : "1px solid var(--border, #e5e7eb)",
                        background: selected ? "rgba(37, 99, 235, 0.08)" : "transparent",
                        color: selected ? "var(--primary-color, #2563eb)" : "inherit",
                        cursor: "pointer",
                      }}
                      onClick={() => setDraft({ ...draft, month: targetMonth })}
                    >
                      {m} {currentYr}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {draft.preset === "customRange" && (
            <div style={{ margin: "0.75rem 0" }}>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: "0.4rem",
                    fontSize: "0.8rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: draft.fromDate ? "rgba(37, 99, 235, 0.08)" : "transparent",
                    color: draft.fromDate ? "var(--primary-color)" : "inherit",
                  }}
                >
                  From: <strong>{draft.fromDate || "Select"}</strong>
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: "0.4rem",
                    fontSize: "0.8rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: draft.toDate ? "rgba(37, 99, 235, 0.08)" : "transparent",
                    color: draft.toDate ? "var(--primary-color)" : "inherit",
                  }}
                >
                  To: <strong>{draft.toDate || "Select"}</strong>
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <Calendar
                  selectedDate={draft.fromDate || new Date().toISOString().split("T")[0]}
                  onSelectDate={(dateStr) => {
                    if (!draft.fromDate || (draft.fromDate && draft.toDate)) {
                      setDraft({ ...draft, fromDate: dateStr, toDate: undefined });
                    } else if (dateStr < draft.fromDate) {
                      setDraft({ ...draft, fromDate: dateStr, toDate: undefined });
                    } else {
                      setDraft({ ...draft, toDate: dateStr });
                    }
                  }}
                  maxDate={new Date().toISOString().split("T")[0]}
                />
              </div>
            </div>
          )}

          {/* Optional Status Filter */}
          {showStatusFilter && (
            <div className="field" style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem", display: "block" }}>Offer Status</label>
              <select
                value={draft.status || "ALL"}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as "ALL" | "EARNED" | "RECEIVED" })}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent" }}
              >
                <option value="ALL">All Statuses</option>
                <option value="EARNED">EARNED Only</option>
                <option value="RECEIVED">RECEIVED Only</option>
              </select>
            </div>
          )}

          {/* Optional Product Filter */}
          {showProductFilter && products.length > 0 && (
            <div className="field" style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem", display: "block" }}>Product</label>
              <select
                value={draft.productId || ""}
                onChange={(e) => setDraft({ ...draft, productId: e.target.value || undefined })}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent" }}
              >
                <option value="">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
            <button
              type="button"
              className="secondary-button"
              style={{ flex: 1, padding: "0.5rem", fontSize: "0.85rem" }}
              onClick={handleReset}
            >
              Clear
            </button>
            <button
              type="button"
              className="primary-button"
              style={{ flex: 1, padding: "0.5rem", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}
              onClick={handleApply}
            >
              <Check size={16} /> Apply Filter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
