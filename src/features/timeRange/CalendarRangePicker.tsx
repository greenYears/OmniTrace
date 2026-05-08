import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getBeijingDate } from "./timeRange";

type CalendarRangePickerProps = {
  anchorRef: React.RefObject<HTMLElement | null>;
  startDate: string | null;
  endDate: string | null;
  onConfirm: (range: { start: string; end: string }) => void;
  onDismiss: () => void;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getDaysGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const cells: { day: number; dateStr: string; isOutside: boolean }[] = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    cells.push({ day, dateStr: toDateStr(y, m, day), isOutside: true });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, dateStr: toDateStr(year, month, day), isOutside: false });
  }

  const remainder = cells.length % 7;
  if (remainder > 0) {
    const m = month === 11 ? 0 : month + 1;
    const y = month === 11 ? year + 1 : year;
    for (let day = 1; day <= 7 - remainder; day++) {
      cells.push({ day, dateStr: toDateStr(y, m, day), isOutside: true });
    }
  }

  return cells;
}

function formatDisplayDate(dateStr: string | null) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-");
  return `${y}/${m}/${d}`;
}

const MONTH_NAMES = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
];

export function CalendarRangePicker({
  anchorRef,
  startDate,
  endDate,
  onConfirm,
  onDismiss,
}: CalendarRangePickerProps) {
  const nowRef = useRef(new Date());
  const today = getBeijingDate(nowRef.current);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const initialMonth = startDate
    ? Number.parseInt(startDate.slice(5, 7), 10) - 1
    : nowRef.current.getMonth();
  const initialYear = startDate
    ? Number.parseInt(startDate.slice(0, 4), 10)
    : nowRef.current.getFullYear();

  const [viewMonth, setViewMonth] = useState(initialMonth);
  const [viewYear, setViewYear] = useState(initialYear);
  const [pendingStart, setPendingStart] = useState<string | null>(startDate);
  const [pendingEnd, setPendingEnd] = useState<string | null>(endDate);

  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 10,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 520)),
    });
  }, [anchorRef]);

  const navigate = useCallback((delta: number) => {
    setViewMonth((prev) => {
      let m = prev + delta;
      let y = viewYear;
      while (m < 0) { m += 12; y -= 1; }
      while (m > 11) { m -= 12; y += 1; }
      setViewYear(y);
      return m;
    });
  }, [viewYear]);

  const handleCellClick = useCallback((dateStr: string) => {
    if (!pendingStart || (pendingStart && pendingEnd)) {
      setPendingStart(dateStr);
      setPendingEnd(null);
    } else {
      const [s, e] = dateStr < pendingStart
        ? [dateStr, pendingStart]
        : [pendingStart, dateStr];
      setPendingStart(s);
      setPendingEnd(e);
    }
  }, [pendingStart, pendingEnd]);

  const handleConfirm = useCallback(() => {
    if (pendingStart && pendingEnd) {
      onConfirm({ start: pendingStart, end: pendingEnd });
    }
  }, [pendingStart, pendingEnd, onConfirm]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onDismiss]);

  function getCellClass(dateStr: string) {
    const classes = ["cal-cell"];
    const isStart = pendingStart === dateStr;
    const isEnd = pendingEnd === dateStr;
    if (isStart) classes.push("is-start");
    if (isEnd) classes.push("is-end");
    if (pendingStart && pendingEnd && dateStr > pendingStart && dateStr < pendingEnd) {
      classes.push("is-in-range");
    }
    if (!isStart && !isEnd && pendingStart && !pendingEnd && dateStr === pendingStart) {
      classes.push("is-pending");
    }
    if (dateStr === today && !isStart && !isEnd) classes.push("is-today");
    return classes.join(" ");
  }

  function renderMonth(year: number, month: number) {
    const cells = getDaysGrid(year, month);
    return (
      <div className="cal-month" key={`${year}-${month}`}>
        <div className="cal-month-title">{year}年 {MONTH_NAMES[month]}</div>
        <div className="cal-weekdays">
          {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
        </div>
        <div className="cal-grid">
          {cells.map((cell) => (
            <button
              key={cell.dateStr}
              type="button"
              className={`${getCellClass(cell.dateStr)}${cell.isOutside ? " is-outside" : ""}`}
              onClick={() => handleCellClick(cell.dateStr)}
            >
              {cell.day}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;

  return createPortal(
    <div
      className="cal-range-picker"
      ref={rootRef}
      style={position ? { position: "fixed", top: position.top, left: position.left, right: "auto", zIndex: 50 } : undefined}
    >
      <div className="cal-range-header">
        <div className="cal-range-display">
          <span className={pendingStart ? "is-set" : ""}>
            {formatDisplayDate(pendingStart) ?? "开始日期"}
          </span>
          <span className="cal-range-sep">→</span>
          <span className={pendingEnd ? "is-set" : ""}>
            {formatDisplayDate(pendingEnd) ?? "结束日期"}
          </span>
        </div>
        <div className="cal-range-nav">
          <button
            type="button"
            className="cal-today-btn"
            onClick={() => {
              const t = new Date();
              setViewMonth(t.getMonth());
              setViewYear(t.getFullYear());
              handleCellClick(today);
            }}
          >
            今天
          </button>
          <button type="button" onClick={() => navigate(-1)}>◀</button>
          <button type="button" onClick={() => navigate(1)}>▶</button>
        </div>
      </div>
      <div className="cal-range-body">
        {renderMonth(viewYear, viewMonth)}
        {renderMonth(nextYear, nextMonth)}
      </div>
      <div className="cal-range-footer">
        <button
          type="button"
          className="cal-confirm-btn"
          disabled={!pendingStart || !pendingEnd}
          onClick={handleConfirm}
        >
          确定
        </button>
      </div>
    </div>,
    document.body,
  );
}
