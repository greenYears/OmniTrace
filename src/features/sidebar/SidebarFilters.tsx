import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SourceFilter } from "../../types/session";

type SidebarFiltersProps = {
  sources: SourceFilter[];
  projects: ProjectFilterOption[];
  source: SourceFilter;
  project: string;
  onChange: (next: {
    sourceFilter?: SourceFilter;
    projectFilter?: string;
  }) => void;
};

export type ProjectFilterOption = {
  name: string;
  value?: string;
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
          const itemValue = item.value ?? item.name;
          const isSelected = value === itemValue;
          const isCopied = copiedProject === itemValue;
          const label = item.name === "all" ? "全部" : item.name;

          return (
            <div
              key={itemValue}
              role="button"
              tabIndex={0}
              className={clsx(
                "sidebar-filter-button",
                "sidebar-project-button",
                isSelected && "is-selected",
                isCopied && "is-copied",
              )}
              onClick={() => onSelect(itemValue)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(itemValue);
                }
              }}
            >
              <span className="sidebar-project-name">{label}</span>
              {item.path && (
                <span className="sidebar-project-meta">
                  <span className="sidebar-project-path" title={item.path}>
                    {formatProjectPath(item.path)}
                  </span>
                  <button
                    type="button"
                    className="sidebar-project-copy-button"
                    title={isCopied ? "已复制" : "复制路径"}
                    aria-label={isCopied ? `已复制路径 ${item.path}` : `复制路径 ${item.path}`}
                    onClick={async (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      await copyText(item.path!);
                      setCopiedProject(itemValue);

                      if (copiedTimerRef.current) {
                        window.clearTimeout(copiedTimerRef.current);
                      }

                      copiedTimerRef.current = window.setTimeout(() => {
                        setCopiedProject((current) => (current === itemValue ? null : current));
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
                      setCopiedProject(itemValue);
                    }}
                  >
                    {isCopied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  </button>
                </span>
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
  source,
  project,
  onChange,
}: SidebarFiltersProps) {
  return (
    <aside className="three-pane three-pane-left sidebar-filters" aria-label="筛选">
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
        onSelect={(value) => {
          onChange(value === "all" ? { projectFilter: value } : { sourceFilter: "all", projectFilter: value });
        }}
      />
    </aside>
  );
}
