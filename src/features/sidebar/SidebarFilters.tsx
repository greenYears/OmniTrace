import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import type { SourceFilter, TimeRange } from "../../types/session";

type SidebarFiltersProps = {
  sources: SourceFilter[];
  projects: ProjectFilterOption[];
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

export type ProjectFilterOption = {
  name: string;
  path?: string;
};

const COPY_FEEDBACK_MS = 1400;

function formatProjectPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

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

function ProjectFilterGroup({
  projects,
  value,
  onSelect,
}: {
  projects: ProjectFilterOption[];
  value: string;
  onSelect: (value: string) => void;
}) {
  const copiedTimerRef = useRef<number | null>(null);
  const [copiedProject, setCopiedProject] = useState<string | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  return (
    <section className="sidebar-filter-group">
      <h2 className="sidebar-filters-title">项目</h2>
      <div className="sidebar-filter-list">
        {projects.map((item) => {
          const isSelected = value === item.name;
          const isCopied = copiedProject === item.name;
          const label = item.name === "all" ? "全部" : item.name;

          return (
            <div
              key={`${item.name}:${item.path ?? ""}`}
              role="button"
              tabIndex={0}
              className={clsx(
                "sidebar-filter-button",
                "sidebar-project-button",
                isSelected && "is-selected",
                isCopied && "is-copied",
              )}
              onClick={() => onSelect(item.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(item.name);
                }
              }}
            >
              <span className="sidebar-project-name">{label}</span>
              {item.path && (
                <button
                  type="button"
                  className="sidebar-project-path"
                  title={item.path}
                  aria-label={isCopied ? `已复制路径 ${item.path}` : `复制路径 ${item.path}`}
                  onClick={async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    await copyText(item.path!);
                    setCopiedProject(item.name);

                    if (copiedTimerRef.current) {
                      window.clearTimeout(copiedTimerRef.current);
                    }

                    copiedTimerRef.current = window.setTimeout(() => {
                      setCopiedProject((current) => (current === item.name ? null : current));
                      copiedTimerRef.current = null;
                    }, COPY_FEEDBACK_MS);
                  }}
                  onKeyDown={async (event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    await copyText(item.path!);
                    setCopiedProject(item.name);
                  }}
                >
                  {formatProjectPath(item.path)}
                </button>
              )}
            </div>
          );
        })}
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
        labels={{ today: "当日", all: "全部", "7d": "最近 7 天", "30d": "最近 30 天" }}
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
      <ProjectFilterGroup
        projects={projects}
        value={project}
        onSelect={(value) => onChange({ projectFilter: value })}
      />
    </aside>
  );
}
