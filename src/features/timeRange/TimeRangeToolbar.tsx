import type { TimeRange } from "../../types/session";

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
];

type TimeRangeToolbarProps = {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
};

export function TimeRangeToolbar({ value, onChange }: TimeRangeToolbarProps) {
  return (
    <div className="time-range-toolbar" aria-label="时间范围">
      {options.map((option) => (
        <button
          key={option.value}
          className={`time-range-button${value === option.value ? " is-selected" : ""}`}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
