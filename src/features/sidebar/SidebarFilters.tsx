import clsx from "clsx";

type SidebarFiltersProps = {
  sources: string[];
  source: string;
  onSourceChange: (source: string) => void;
};

export function SidebarFilters({
  sources,
  source,
  onSourceChange,
}: SidebarFiltersProps) {
  return (
    <aside className="three-pane three-pane-left sidebar-filters" aria-label="Filters">
      <h2 className="sidebar-filters-title">Sources</h2>
      <div className="sidebar-filter-list">
        {sources.map((item) => (
          <button
            key={item}
            type="button"
            className={clsx(
              "sidebar-filter-button",
              source === item && "is-selected",
            )}
            onClick={() => onSourceChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </aside>
  );
}
