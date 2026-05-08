import { useRef, useState } from "react";

import type { CustomDateRange, TimeRange } from "../../types/session";
import { CalendarRangePicker } from "./CalendarRangePicker";

type TimeRangeOption = {
  value: TimeRange;
  label: string;
};

const options: TimeRangeOption[] = [
  { value: "today", label: "今天" },
  { value: "yesterday", label: "昨天" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义" },
];

type TimeRangeToolbarProps = {
  value: TimeRange;
  customRange?: CustomDateRange;
  onChange: (value: TimeRange, customRange?: CustomDateRange) => void;
};

export function TimeRangeToolbar({ value, customRange, onChange }: TimeRangeToolbarProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  function handleClick(optionValue: TimeRange) {
    if (optionValue === "custom") {
      setCalendarOpen((prev) => !prev);
      return;
    }
    setCalendarOpen(false);
    onChange(optionValue);
  }

  function handleConfirm(range: { start: string; end: string }) {
    setCalendarOpen(false);
    onChange("custom", range);
  }

  function handleDismiss() {
    setCalendarOpen(false);
  }

  return (
    <div className="time-range-toolbar" ref={toolbarRef} aria-label="时间范围">
      {options.map((option) => (
        <button
          key={option.value}
          className={`time-range-button${value === option.value ? " is-selected" : ""}`}
          type="button"
          onClick={() => handleClick(option.value)}
        >
          {option.label}
        </button>
      ))}
      {calendarOpen && (
        <CalendarRangePicker
          anchorRef={toolbarRef}
          startDate={value === "custom" && customRange ? customRange.start : null}
          endDate={value === "custom" && customRange ? customRange.end : null}
          onConfirm={handleConfirm}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  );
}
