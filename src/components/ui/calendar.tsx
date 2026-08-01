"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CalendarProps {
  selectedDate?: string; // YYYY-MM-DD
  onSelectDate: (dateStr: string) => void;
  maxDate?: string; // YYYY-MM-DD
  minDate?: string; // YYYY-MM-DD
  className?: string;
}

export function Calendar({
  selectedDate,
  onSelectDate,
  maxDate,
  minDate,
  className = "",
}: CalendarProps) {
  const initialDate = selectedDate ? new Date(selectedDate) : new Date();
  const [currentYear, setCurrentYear] = useState<number>(initialDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(initialDate.getMonth()); // 0-indexed

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const daysOfWeek = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay(); // 0 (Sun) to 6 (Sat)
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const todayStr = new Date().toISOString().split("T")[0];

  const pad = (n: number) => String(n).padStart(2, "0");

  const isDateDisabled = (dateStr: string) => {
    if (maxDate && dateStr > maxDate) return true;
    if (minDate && dateStr < minDate) return true;
    return false;
  };

  return (
    <div
      className={`shadcn-calendar-card ${className}`}
      style={{
        background: "var(--card-bg, #ffffff)",
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: "12px",
        padding: "0.85rem",
        width: "100%",
        maxWidth: "320px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
        margin: "0 auto",
      }}
    >
      {/* Month / Year Navigation Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <button
          type="button"
          onClick={handlePrevMonth}
          style={{
            background: "transparent",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "6px",
            padding: "0.3rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--foreground, #111827)",
          }}
          aria-label="Previous Month"
        >
          <ChevronLeft size={18} />
        </button>

        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          {monthNames[currentMonth]} {currentYear}
        </span>

        <button
          type="button"
          onClick={handleNextMonth}
          style={{
            background: "transparent",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "6px",
            padding: "0.3rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--foreground, #111827)",
          }}
          aria-label="Next Month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Weekday Headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          textAlign: "center",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "var(--muted, #6b7280)",
          marginBottom: "0.5rem",
        }}
      >
        {daysOfWeek.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>

      {/* Days Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "0.25rem",
        }}
      >
        {/* Blank cells before first day */}
        {Array.from({ length: firstDayOfMonth }).map((_, idx) => (
          <div key={`blank-${idx}`} />
        ))}

        {/* Month Day Cells */}
        {Array.from({ length: daysInMonth }).map((_, idx) => {
          const dayNum = idx + 1;
          const dateStr = `${currentYear}-${pad(currentMonth + 1)}-${pad(dayNum)}`;
          const isSelected = selectedDate === dateStr;
          const isToday = todayStr === dateStr;
          const disabled = isDateDisabled(dateStr);

          return (
            <button
              key={dateStr}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onSelectDate(dateStr)}
              style={{
                height: "36px",
                width: "36px",
                margin: "0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                fontSize: "0.85rem",
                fontWeight: isSelected || isToday ? 600 : 400,
                border: isToday && !isSelected ? "1.5px solid var(--primary-color, #2563eb)" : "none",
                background: isSelected
                  ? "var(--primary-color, #2563eb)"
                  : "transparent",
                color: isSelected
                  ? "#ffffff"
                  : disabled
                  ? "var(--muted, #9ca3af)"
                  : "inherit",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.4 : 1,
                transition: "all 0.15s ease",
              }}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}
