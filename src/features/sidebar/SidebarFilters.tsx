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
    source?: SourceFilter;
    project?: string;
    timeRange?: TimeRange;
  }) => void;
};

type FilterGroupProps<T extends string> = {
  title: string;
  options: T[];
  value: T;
  onSelect: (value: T) => void;
};

function FilterGroup<T extends string>({
  title,
  options,
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
            {item}
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
    <aside className="three-pane three-pane-left sidebar-filters" aria-label="Filters">
      <FilterGroup
        title="Time"
        options={timeRanges}
        value={timeRange}
        onSelect={(value) => onChange({ timeRange: value })}
      />
      <FilterGroup
        title="Sources"
        options={sources}
        value={source}
        onSelect={(value) => onChange({ source: value })}
      />
      <FilterGroup
        title="Projects"
        options={projects}
        value={project}
        onSelect={(value) => onChange({ project: value })}
      />
    </aside>
  );
}
