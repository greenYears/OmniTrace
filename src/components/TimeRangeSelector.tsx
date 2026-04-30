import { useEffect, useRef, useState } from "react";

import type { CustomDateRange } from "../types/session";

const beijingTimeZone = "Asia/Shanghai";

export function isValidDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isValidCustomDateRange(range: CustomDateRange) {
  return isValidDateValue(range.startDate) && isValidDateValue(range.endDate) && range.startDate <= range.endDate;
}

export function getTodayDateValue() {
  return getBeijingDatePart(new Date());
}

export function getCustomDateParts(value: string) {
  const [year = "", month = "", day = ""] = value.split("-");
  return { year, month, day };
}

function getBeijingDatePart(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: beijingTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const v = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

function getCalendarCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells: Array<{ day: number; date: string; outside: boolean }> = [];
  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    cells.push({ day: d, date: `${py}-${String(pm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, outside: false });
  }
  const remaining = (7 - cells.length % 7) % 7;
  const nm = month === 11 ? 0 : month + 1;
  const ny = month === 11 ? year + 1 : year;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, date: `${ny}-${String(nm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, outside: true });
  }
  return cells;
}

function CalendarRangePicker({
  range,
  onChange,
  onConfirm,
}: {
  range: CustomDateRange;
  onChange: (range: CustomDateRange) => void;
  onConfirm: () => void;
}) {
  const [viewBase, setViewBase] = useState(() => {
    const ref = range.startDate || getTodayDateValue();
    const p = getCustomDateParts(ref);
    return { year: Number.parseInt(p.year, 10), month: Number.parseInt(p.month, 10) - 1 };
  });
  const [selecting, setSelecting] = useState<string | null>(null);

  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
  const monthLabels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  function shiftMonth(delta: number) {
    let { year, month } = viewBase;
    month += delta;
    if (month < 0) { month += 12; year--; }
    if (month > 11) { month -= 12; year++; }
    setViewBase({ year, month });
  }

  function goToday() {
    const p = getCustomDateParts(getTodayDateValue());
    setViewBase({ year: Number.parseInt(p.year, 10), month: Number.parseInt(p.month, 10) - 1 });
  }

  function handleDayClick(dateStr: string) {
    if (selecting) {
      const start = dateStr < selecting ? dateStr : selecting;
      const end = dateStr < selecting ? selecting : dateStr;
      setSelecting(null);
      onChange({ startDate: start, endDate: end });
    } else {
      setSelecting(dateStr);
    }
  }

  const todayStr = getTodayDateValue();

  function renderMonth(year: number, month: number) {
    const cells = getCalendarCells(year, month);
    const ds = selecting || range.startDate;
    const de = selecting ? "" : range.endDate;
    return (
      <div className="cal-month">
        <div className="cal-month-title">{year}年 {monthLabels[month]}</div>
        <div className="cal-weekdays">
          {weekDays.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="cal-grid">
          {cells.map((cell, i) => {
            let cls = "cal-cell";
            if (cell.outside) cls += " is-outside";
            if (cell.date === todayStr) cls += " is-today";
            if (ds && cell.date === ds) cls += " is-start";
            if (de && cell.date === de) cls += " is-end";
            if (ds && de && cell.date > ds && cell.date < de) cls += " is-in-range";
            if (selecting && cell.date === selecting) cls += " is-pending";
            return (
              <button key={i} className={cls} type="button" onClick={() => handleDayClick(cell.date)}>
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const next = viewBase.month === 11
    ? { year: viewBase.year + 1, month: 0 }
    : { year: viewBase.year, month: viewBase.month + 1 };
  const dispStart = selecting || range.startDate;
  const dispEnd = selecting ? "" : range.endDate;

  return (
    <div className="cal-range-picker">
      <div className="cal-range-header">
        <div className="cal-range-display">
          <span className={dispStart ? "is-set" : ""}>{dispStart || "开始日期"}</span>
          <span className="cal-range-sep">→</span>
          <span className={dispEnd ? "is-set" : ""}>{dispEnd || "结束日期"}</span>
        </div>
        <div className="cal-range-nav">
          <button type="button" className="cal-today-btn" onClick={goToday}>今天</button>
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="上一月">‹</button>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="下一月">›</button>
        </div>
      </div>
      <div className="cal-range-body">
        {renderMonth(viewBase.year, viewBase.month)}
        {renderMonth(next.year, next.month)}
      </div>
      <div className="cal-range-footer">
        <button
          type="button"
          className="cal-confirm-btn"
          disabled={!isValidCustomDateRange(range)}
          onClick={onConfirm}
        >
          确定
        </button>
      </div>
    </div>
  );
}

export function ToolbarRangeSelector<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  customRange,
  onCustomRangeChange,
}: {
  ariaLabel: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  customRange?: CustomDateRange;
  onCustomRangeChange?: (range: CustomDateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="app-time-range" aria-label={ariaLabel}>
      <div className="app-time-range-buttons">
        {options.map((option) => (
          <button
            key={option.value}
            className={`app-time-range-button${value === option.value ? " is-selected" : ""}`}
            type="button"
            onClick={() => {
              onChange(option.value);
              if (option.value === "custom") {
                if (customRange && onCustomRangeChange && !isValidCustomDateRange(customRange)) {
                  onCustomRangeChange({ startDate: getTodayDateValue(), endDate: getTodayDateValue() });
                }
                setOpen(true);
              } else {
                setOpen(false);
              }
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {value === "custom" && open && customRange && onCustomRangeChange ? (
        <CalendarRangePicker range={customRange} onChange={onCustomRangeChange} onConfirm={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
