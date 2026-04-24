import clsx from "clsx";

import type { SourceFilter, TimeRange } from "../../types/session";

type SidebarFiltersProps = {
  sources: SourceFilter[];
  projects: string[];
  timeRanges: TimeRange[];
  source: SourceFilter;
  project: string;
  timeRange: TimeRange;
  onChange: (next: {
    sourceFilter?: SourceFilter;
    projectFilter?: string;
    timeRange?: TimeRange;
  }) => void;
};

type FilterGroupProps<T extends string> = {
  title: string;
  options: T[];
  labels?: Record<string, string>;
  value: T;
  onSelect: (value: T) => void;
};

function FilterGroup<T extends string>({
  title,
  options,
  labels,
  value,
  onSelect,
}: FilterGroupProps<T>) {
  return (
    <section className="sidebar-filter-group">
      <h2 className="sidebar-filters-title">{title}</h2>
      <div className="sidebar-filter-list">
        {options.map((item) => (
          <button
            key={item}
            type="button"
            className={clsx(
              "sidebar-filter-button",
              value === item && "is-selected",
            )}
            onClick={() => onSelect(item)}
          >
            {labels?.[item] ?? item}
          </button>
        ))}
      </div>
    </section>
  );
}

export function SidebarFilters({
  sources,
  projects,
  timeRanges,
  source,
  project,
  timeRange,
  onChange,
}: SidebarFiltersProps) {
  return (
    <aside className="three-pane three-pane-left sidebar-filters" aria-label="筛选">
      <FilterGroup
        title="时间范围"
        options={timeRanges}
        labels={{ all: "全部", "7d": "最近 7 天", "30d": "最近 30 天" }}
        value={timeRange}
        onSelect={(value) => onChange({ timeRange: value })}
      />
      <FilterGroup
        title="来源"
        options={sources}
        labels={{ all: "全部", claude_code: "Claude Code", codex: "Codex" }}
        value={source}
        onSelect={(value) => onChange({ sourceFilter: value })}
      />
      <FilterGroup
        title="项目"
        options={projects}
        labels={{ all: "全部" }}
        value={project}
        onSelect={(value) => onChange({ projectFilter: value })}
      />
    </aside>
  );
}
