import "./styles.css";
import { startTransition, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { ThreePaneShell } from "./features/layout/ThreePaneShell";
import { deleteSession, getSessionDetail, probeTokenUsageSources, scanSources } from "./lib/tauri";
import { useSessionStore } from "./stores/useSessionStore";
import type {
  SessionScanProgress,
  TimeRange,
  TokenProbeProgress,
  TokenUsageBucket,
  TokenUsageProbeReport,
} from "./types/session";

type AppView = "sessions" | "tokenUsage";
type TokenUsageRange = "today" | "7d" | "30d" | "90d" | "all";
type TokenUsageSourceFilter = "all" | "claude_code" | "codex";

const tokenUsageRanges: Array<{ value: TokenUsageRange; label: string }> = [
  { value: "today", label: "当日" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
  { value: "90d", label: "最近 90 天" },
  { value: "all", label: "全部" },
];
const tokenUsageTimeZone = "Asia/Shanghai";
const sessionScanTimeRanges: Array<{ value: TimeRange; label: string }> = [
  { value: "today", label: "当日" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
  { value: "all", label: "全部" },
];

function formatTokenCount(value: number) {
  return `${formatCompactTokenNumber(value)} tokens`;
}

function formatTokenNumber(value: number) {
  return formatCompactTokenNumber(value);
}

function formatCompactTokenNumber(value: number) {
  const absValue = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "k" },
  ];
  const unit = units.find((item) => absValue >= item.threshold);

  if (!unit) {
    return value.toLocaleString();
  }

  const compactValue = value / unit.threshold;
  const formatted = compactValue >= 10
    ? Math.round(compactValue).toLocaleString()
    : compactValue.toFixed(1).replace(/\.0$/, "");

  return `${formatted}${unit.suffix}`;
}

function filterBucketsByRange(days: TokenUsageBucket[], range: TokenUsageRange) {
  const sortedDays = [...days]
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (range === "today") {
    const latestDay = sortedDays[sortedDays.length - 1]?.date;
    return latestDay ? sortedDays.filter((day) => day.date === latestDay) : [];
  }

  if (range === "all" || sortedDays.length === 0) {
    return sortedDays;
  }

  const latest = new Date(`${sortedDays[sortedDays.length - 1].date}T00:00:00Z`);
  const rangeDays = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  latest.setUTCDate(latest.getUTCDate() - rangeDays + 1);
  const startDate = latest.toISOString().slice(0, 10);

  return sortedDays.filter((day) => day.date >= startDate);
}

function getBeijingDateTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tokenUsageTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`,
    hour: Number.parseInt(valueOf("hour"), 10),
  };
}

function getHourlySeriesEndHour(day: string, now = new Date()) {
  const current = getBeijingDateTimeParts(now);
  return day === current.date && !Number.isNaN(current.hour) ? current.hour : 23;
}

function filterHourlyBucketsByDay(hours: TokenUsageBucket[], day: string, now = new Date()) {
  const endHour = getHourlySeriesEndHour(day, now);

  return [...hours]
    .filter((hour) => {
      if (!hour.date.startsWith(`${day} `)) {
        return false;
      }

      const hourValue = Number.parseInt(hour.date.slice(11, 13), 10);
      return Number.isNaN(hourValue) || hourValue <= endHour;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function createEmptyTokenBucket(date: string): TokenUsageBucket {
  return {
    date,
    sourceId: "",
    modelId: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cacheTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    recordsWithUsage: 0,
  };
}

export function buildHourlySeries(hours: TokenUsageBucket[], day: string, now = new Date()) {
  if (!day) {
    return [];
  }

  const endHour = getHourlySeriesEndHour(day, now);
  const byHour = new Map(filterHourlyBucketsByDay(hours, day, now).map((bucket) => [bucket.date, bucket]));

  return Array.from({ length: endHour + 1 }, (_, hour) => {
    const label = `${day} ${hour.toString().padStart(2, "0")}:00`;
    return byHour.get(label) ?? createEmptyTokenBucket(label);
  });
}

export function filterVisibleTokenDetailBuckets(buckets: TokenUsageBucket[], isHourly: boolean) {
  return isHourly ? buckets.filter((bucket) => bucket.totalTokens > 0) : buckets;
}

function getLatestUsageDay(days: TokenUsageBucket[]) {
  return [...days]
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-1)[0]?.date ?? "";
}

function sumTokenBuckets(buckets: TokenUsageBucket[]) {
  return buckets.reduce(
    (total, bucket) => ({
      inputTokens: total.inputTokens + bucket.inputTokens,
      outputTokens: total.outputTokens + bucket.outputTokens,
      cacheCreationTokens: total.cacheCreationTokens + bucket.cacheCreationTokens,
      cacheReadTokens: total.cacheReadTokens + bucket.cacheReadTokens,
      cacheTokens: total.cacheTokens + bucket.cacheTokens,
      reasoningTokens: total.reasoningTokens + bucket.reasoningTokens,
      totalTokens: total.totalTokens + bucket.totalTokens,
      recordsWithUsage: total.recordsWithUsage + bucket.recordsWithUsage,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      recordsWithUsage: 0,
    },
  );
}

function addBucketStats(target: TokenUsageBucket, bucket: TokenUsageBucket) {
  target.inputTokens += bucket.inputTokens;
  target.outputTokens += bucket.outputTokens;
  target.cacheCreationTokens += bucket.cacheCreationTokens;
  target.cacheReadTokens += bucket.cacheReadTokens;
  target.cacheTokens += bucket.cacheTokens;
  target.reasoningTokens += bucket.reasoningTokens;
  target.totalTokens += bucket.totalTokens;
  target.recordsWithUsage += bucket.recordsWithUsage;
}

function filterTokenBuckets(
  buckets: TokenUsageBucket[],
  sourceFilter: TokenUsageSourceFilter,
  modelFilter: string,
) {
  return buckets.filter((bucket) => {
    if (sourceFilter !== "all" && bucket.sourceId !== sourceFilter) {
      return false;
    }

    if (modelFilter !== "all" && bucket.modelId !== modelFilter) {
      return false;
    }

    return true;
  });
}

function aggregateBucketsByDate(buckets: TokenUsageBucket[]) {
  const grouped = new Map<string, TokenUsageBucket>();

  for (const bucket of buckets) {
    const existing = grouped.get(bucket.date);
    if (existing) {
      addBucketStats(existing, bucket);
      continue;
    }

    grouped.set(bucket.date, { ...createEmptyTokenBucket(bucket.date) });
    addBucketStats(grouped.get(bucket.date)!, bucket);
  }

  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateModelBuckets(buckets: TokenUsageBucket[]) {
  const models = new Map<string, TokenUsageBucket>();

  for (const bucket of buckets) {
    const key = `${bucket.sourceId}:${bucket.modelId}`;
    const existing = models.get(key);
    if (!existing) {
      models.set(key, { ...bucket, date: "" });
      continue;
    }

    addBucketStats(existing, bucket);
  }

  return [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function sourceLabel(sourceId: string) {
  if (sourceId === "claude_code") {
    return "Claude Code";
  }

  if (sourceId === "codex") {
    return "Codex";
  }

  return sourceId;
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function formatTokenTooltip(bucket: TokenUsageBucket) {
  return [
    bucket.date,
    `总量: ${formatTokenCount(bucket.totalTokens)}`,
    `输入: ${formatTokenCount(bucket.inputTokens)}`,
    `输出: ${formatTokenCount(bucket.outputTokens)}`,
    `缓存: ${formatTokenCount(bucket.cacheTokens)}`,
    `思考: ${formatTokenCount(bucket.reasoningTokens)}`,
  ].join("\n");
}

function TokenUsageSummary({
  report,
  range,
}: {
  report: TokenUsageProbeReport;
  range: TokenUsageRange;
}) {
  const [sourceFilter, setSourceFilter] = useState<TokenUsageSourceFilter>("all");
  const [modelFilter, setModelFilter] = useState("all");
  const isHourly = range === "today";
  const latestDay = getLatestUsageDay(report.days);
  const filteredDays = filterBucketsByRange(report.days, range);
  const baseModelBuckets = isHourly
    ? filterHourlyBucketsByDay(report.byModelByHour, latestDay)
    : filterBucketsByRange(report.byModelByDay, range);
  const filteredModelBuckets = filterTokenBuckets(baseModelBuckets, sourceFilter, modelFilter);
  const chartBuckets = sourceFilter === "all" && modelFilter === "all"
    ? (isHourly ? buildHourlySeries(report.hours, latestDay) : filteredDays)
    : (isHourly
      ? buildHourlySeries(aggregateBucketsByDate(filteredModelBuckets), latestDay)
      : aggregateBucketsByDate(filteredModelBuckets));
  const totals = sumTokenBuckets(chartBuckets);
  const topModels = aggregateModelBuckets(filteredModelBuckets.length > 0 ? filteredModelBuckets : [])
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 5);
  const sourceOptions = uniqueValues(baseModelBuckets.map((bucket) => bucket.sourceId))
    .filter((sourceId): sourceId is TokenUsageSourceFilter => sourceId === "claude_code" || sourceId === "codex");
  const modelOptions = uniqueValues(
    baseModelBuckets
      .filter((bucket) => sourceFilter === "all" || bucket.sourceId === sourceFilter)
      .map((bucket) => bucket.modelId),
  );

  useEffect(() => {
    if (sourceFilter !== "all" && !sourceOptions.includes(sourceFilter)) {
      setSourceFilter("all");
      setModelFilter("all");
      return;
    }

    if (modelFilter !== "all" && !modelOptions.includes(modelFilter)) {
      setModelFilter("all");
    }
  }, [modelFilter, modelOptions, sourceFilter, sourceOptions]);
  const maxChartTotal = Math.max(...chartBuckets.map((bucket) => bucket.totalTokens), 1);
  const detailBuckets = filterVisibleTokenDetailBuckets(chartBuckets, isHourly);
  const chartTitle = isHourly ? "按小时消耗" : "按天消耗";
  const chartAriaLabel = isHourly ? "按小时 token 消耗折线图" : "按天 token 消耗柱状图";
  const detailTitle = isHourly ? "按小时明细" : "按天明细";
  const detailFirstColumn = isHourly ? "时间" : "日期";
  const unitLabel = isHourly ? "小时" : "天";
  const summaryCards = [
    { label: "总量", value: totals.totalTokens, accent: "total" },
    { label: "输入", value: totals.inputTokens, accent: "input" },
    { label: "输出", value: totals.outputTokens, accent: "output" },
    { label: "缓存", value: totals.cacheTokens, detail: `创建 ${formatTokenNumber(totals.cacheCreationTokens)} · 读取 ${formatTokenNumber(totals.cacheReadTokens)}`, accent: "cache" },
    { label: "思考", value: totals.reasoningTokens, accent: "reasoning" },
  ];

  return (
    <>
      <div className="token-dimension-panel">
        <div className="token-filter-group" aria-label="Token usage source filter">
          <span>来源</span>
          <button
            className={`token-range-button${sourceFilter === "all" ? " is-selected" : ""}`}
            type="button"
            onClick={() => {
              setSourceFilter("all");
              setModelFilter("all");
            }}
          >
            全部
          </button>
          {sourceOptions.map((sourceId) => (
            <button
              key={sourceId}
              className={`token-range-button${sourceFilter === sourceId ? " is-selected" : ""}`}
              type="button"
              onClick={() => {
                setSourceFilter(sourceId);
                setModelFilter("all");
              }}
            >
              {sourceLabel(sourceId)}
            </button>
          ))}
        </div>

        <div className="token-filter-group" aria-label="Token usage model filter">
          <span>模型</span>
          <button
            className={`token-range-button${modelFilter === "all" ? " is-selected" : ""}`}
            type="button"
            onClick={() => setModelFilter("all")}
          >
            全部
          </button>
          {modelOptions.map((modelId) => (
            <button
              key={modelId}
              className={`token-range-button${modelFilter === modelId ? " is-selected" : ""}`}
              type="button"
              onClick={() => setModelFilter(modelId)}
            >
              {modelId}
            </button>
          ))}
        </div>
      </div>

      <div className="token-probe-summary">
        <p>{report.filesScanned} 个文件 · {report.recordsScanned} 条记录 · {report.recordsWithUsage} 条 usage</p>
      </div>

      <div className="token-total-grid">
        {summaryCards.map((card) => (
          <div key={card.label} className={`token-total-card token-total-card-${card.accent}`}>
            <span>{card.label}</span>
            <strong>{card.label === "总量" ? formatTokenNumber(card.value) : formatTokenCount(card.value)}</strong>
            <small>{card.label === "总量" ? "tokens" : card.detail ?? "精确 usage"}</small>
          </div>
        ))}
      </div>

      <div className="token-chart-card">
        <div className="token-card-heading">
          <h3>{chartTitle}</h3>
          <span>{chartBuckets.length} {unitLabel} · {totals.recordsWithUsage} 条 usage</span>
        </div>
        {chartBuckets.length > 0 ? (
          isHourly ? (
            <div className="token-line-chart" aria-label={chartAriaLabel}>
              <svg className="token-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  className="token-line-path"
                  points={chartBuckets.map((bucket, index) => {
                    const x = chartBuckets.length > 1 ? (index / (chartBuckets.length - 1)) * 100 : 0;
                    const y = 92 - (bucket.totalTokens / maxChartTotal) * 84;
                    return `${x},${y}`;
                  }).join(" ")}
                />
              </svg>
              <div className="token-line-points">
                {chartBuckets.map((bucket, index) => {
                  const tooltip = formatTokenTooltip(bucket);
                  const x = chartBuckets.length > 1 ? (index / (chartBuckets.length - 1)) * 100 : 0;
                  const y = 92 - (bucket.totalTokens / maxChartTotal) * 84;

                  return (
                    <div
                      key={bucket.date}
                      className={`token-line-point${bucket.totalTokens > 0 ? " has-usage" : ""}`}
                      data-tooltip={tooltip}
                      style={{ left: `${x}%`, top: `${y}%` }}
                      title={tooltip}
                      tabIndex={0}
                    />
                  );
                })}
              </div>
              <div className="token-line-axis">
                {chartBuckets.map((bucket) => (
                  <span key={bucket.date}>{bucket.date.slice(11)}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="token-bar-chart" aria-label={chartAriaLabel}>
              {chartBuckets.map((bucket) => {
              const tooltip = formatTokenTooltip(bucket);
              const height = Math.max((bucket.totalTokens / maxChartTotal) * 100, 4);
              const inputWidth = bucket.totalTokens > 0 ? (bucket.inputTokens / bucket.totalTokens) * 100 : 0;
              const outputWidth = bucket.totalTokens > 0 ? (bucket.outputTokens / bucket.totalTokens) * 100 : 0;
              const cacheWidth = bucket.totalTokens > 0 ? (bucket.cacheTokens / bucket.totalTokens) * 100 : 0;
              const reasoningWidth = bucket.totalTokens > 0 ? (bucket.reasoningTokens / bucket.totalTokens) * 100 : 0;

              return (
                <div
                  key={bucket.date}
                  className="token-bar-item"
                  data-tooltip={tooltip}
                  title={tooltip}
                  tabIndex={0}
                >
                  <div className="token-bar-track">
                    <div className="token-bar-stack" style={{ height: `${height}%` }}>
                      <span className="token-bar-segment token-bar-input" style={{ height: `${inputWidth}%` }} />
                      <span className="token-bar-segment token-bar-output" style={{ height: `${outputWidth}%` }} />
                      <span className="token-bar-segment token-bar-cache" style={{ height: `${cacheWidth}%` }} />
                      <span className="token-bar-segment token-bar-reasoning" style={{ height: `${reasoningWidth}%` }} />
                    </div>
                  </div>
                  <span className="token-bar-date">{isHourly ? bucket.date.slice(11) : bucket.date.slice(5)}</span>
                </div>
              );
              })}
            </div>
          )
        ) : (
          <p className="token-probe-empty">当前时间区间没有 usage 数据</p>
        )}
        <div className="token-chart-legend">
          <span className="token-legend-input">输入 token</span>
          <span className="token-legend-output">输出 token</span>
          <span className="token-legend-cache">缓存 token</span>
          <span className="token-legend-reasoning">思考 token</span>
        </div>
      </div>

      <div className="token-probe-grid">
        <div className="token-probe-card">
          <h3>{detailTitle}</h3>
          {detailBuckets.length > 0 ? (
            <div className="token-day-table">
              <div className="token-day-table-head">
                <span>{detailFirstColumn}</span>
                <span>总量</span>
                <span>输入量</span>
                <span>输出量</span>
                <span>缓存量</span>
                <span>思考量</span>
              </div>
              {detailBuckets.slice().reverse().map((bucket) => (
                <div key={bucket.date} className="token-day-table-row" title={formatTokenTooltip(bucket)}>
                  <span>{isHourly ? bucket.date.slice(11) : bucket.date}</span>
                  <strong>{formatTokenCount(bucket.totalTokens)}</strong>
                  <span>{formatTokenNumber(bucket.inputTokens)}</span>
                  <span>{formatTokenNumber(bucket.outputTokens)}</span>
                  <span>{formatTokenNumber(bucket.cacheTokens)}</span>
                  <span>{formatTokenNumber(bucket.reasoningTokens)}</span>
                </div>
              ))}
            </div>
          ) : <p className="token-probe-empty">未发现 usage 字段</p>}
        </div>
        <div className="token-probe-card">
          <h3>按模型 Top 5</h3>
          {topModels.length > 0 ? topModels.map((model) => (
            <div key={`${model.sourceId}:${model.modelId}`} className="token-probe-row">
              <span>{model.sourceId} · {model.modelId}</span>
              <strong>{formatTokenCount(model.totalTokens)}</strong>
            </div>
          )) : <p className="token-probe-empty">暂无模型统计</p>}
        </div>
      </div>
    </>
  );
}

function progressSourceLabel(sourceId: string) {
  return sourceId === "claude_code" ? "Claude Code" : sourceLabel(sourceId);
}

function compactProgressPath(path: string) {
  return path
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~");
}

function ActivityDots() {
  return (
    <span className="scan-progress-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function ToolbarRangeSelector<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="app-time-range" aria-label={ariaLabel}>
      <div className="app-time-range-buttons">
        {options.map((option) => (
          <button
            key={option.value}
            className={`app-time-range-button${value === option.value ? " is-selected" : ""}`}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function isProgressDone(phase: string) {
  return phase.startsWith("完成");
}

function ProgressIndicator({ phase }: { phase: string }) {
  return isProgressDone(phase)
    ? <span className="scan-progress-complete" aria-hidden="true">✓</span>
    : <ActivityDots />;
}

function TokenProbeProgressPanel({ progress }: { progress: TokenProbeProgress }) {
  return (
    <div
      className={`token-progress-panel${isProgressDone(progress.phase) ? " is-complete" : ""}`}
      role="status"
      aria-label="Token 探测进度"
    >
      <div className="scan-progress-main">
        <ProgressIndicator phase={progress.phase} />
        <strong>{progressSourceLabel(progress.sourceId)}</strong>
        <span>{progress.phase}</span>
      </div>
      <div className="scan-progress-path">{compactProgressPath(progress.path)}</div>
      <div className="scan-progress-meta">
        {progress.filesScanned} 个文件 · {progress.recordsScanned} 条记录 · {progress.recordsWithUsage} 条 usage
      </div>
    </div>
  );
}

function TokenUsageView({
  report,
  loading,
  progress,
  range,
  onBack,
  onRefresh,
}: {
  report: TokenUsageProbeReport | null;
  loading: boolean;
  progress: TokenProbeProgress | null;
  range: TokenUsageRange;
  onBack: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="token-usage-view" aria-label="Token usage view">
      <div className="token-probe-panel">
        <div className="token-probe-header">
          <button className="token-back-button" type="button" onClick={onBack}>
            ← 返回会话
          </button>
          <div className="token-probe-actions">
            <span className="token-probe-badge">只读探测</span>
            <button className="scan-button" type="button" onClick={onRefresh} disabled={loading}>
              {loading ? "◷ 探测中" : "↻ 重新探测"}
            </button>
          </div>
        </div>

        <div>
          <h2>Token Usage 探测</h2>
          <p className="token-probe-description">
            从 Claude Code 和 Codex 的本地历史中只读提取 usage 字段，优先展示精确 token 数据。
          </p>
        </div>

        {loading && !report ? (
          progress ? <TokenProbeProgressPanel progress={progress} /> : (
            <div className="token-probe-loading" role="status">
              正在扫描本地历史 usage 字段...
            </div>
          )
        ) : report ? (
          <TokenUsageSummary report={report} range={range} />
        ) : (
          <div className="token-probe-loading" role="status">
            暂无探测结果，请点击重新探测。
          </div>
        )}
      </div>
    </section>
  );
}

function App() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedId);
  const detail = useSessionStore((s) => s.detail);
  const detailLoading = useSessionStore((s) => s.detailLoading);
  const sourceFilter = useSessionStore((s) => s.sourceFilter);
  const projectFilter = useSessionStore((s) => s.projectFilter);
  const timeRange = useSessionStore((s) => s.timeRange);
  const lastScannedAt = useSessionStore((s) => s.lastScannedAt);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setDetail = useSessionStore((s) => s.setDetail);
  const setDetailLoading = useSessionStore((s) => s.setDetailLoading);
  const updateFilters = useSessionStore((s) => s.updateFilters);
  const selectSession = useSessionStore((s) => s.selectSession);
  const markScannedNow = useSessionStore((s) => s.markScannedNow);
  const hasAutoScanned = useRef(false);
  const [activeView, setActiveView] = useState<AppView>("sessions");
  const [tokenProbeReport, setTokenProbeReport] = useState<TokenUsageProbeReport | null>(null);
  const [tokenProbeLoading, setTokenProbeLoading] = useState(false);
  const [tokenUsageRange, setTokenUsageRange] = useState<TokenUsageRange>("today");
  const [sessionScanLoading, setSessionScanLoading] = useState(false);
  const [sessionScanProgress, setSessionScanProgress] = useState<SessionScanProgress | null>(null);
  const [tokenProbeProgress, setTokenProbeProgress] = useState<TokenProbeProgress | null>(null);

  async function handleRefresh() {
    setSessionScanLoading(true);
    setSessionScanProgress(null);
    try {
      const nextSessions = await scanSources(timeRange);
      setSessions(nextSessions);
      markScannedNow();
      setSessionScanProgress((current) => current ? { ...current, phase: "完成" } : null);
    } catch (error) {
      console.error(error);
      setSessions([]);
    } finally {
      setSessionScanLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSession(id);
      await handleRefresh();
    } catch (error) {
      console.error(error);
    }
  }

  async function handleTokenProbe() {
    setTokenProbeLoading(true);
    setTokenProbeProgress(null);
    try {
      const report = await probeTokenUsageSources();
      setTokenProbeReport(report);
      setTokenProbeProgress((current) => current ? { ...current, phase: "完成" } : null);
    } catch (error) {
      console.error(error);
      setTokenProbeReport({
        filesScanned: 0,
        recordsScanned: 0,
        recordsWithUsage: 0,
        days: [],
        hours: [],
        byModel: [],
        byModelByDay: [],
        byModelByHour: [],
        samples: [],
      });
    } finally {
      setTokenProbeLoading(false);
    }
  }

  async function handleOpenTokenUsage() {
    setActiveView("tokenUsage");
    await handleTokenProbe();
  }

  function handleSessionFilterChange(next: {
    sourceFilter?: "all" | "claude_code" | "codex";
    projectFilter?: string;
    timeRange?: TimeRange;
  }) {
    updateFilters(next);

    if (next.timeRange && next.timeRange !== timeRange) {
      setSessions([]);
      setDetail(null);
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let cleanupSession: (() => void) | null = null;
    let cleanupToken: (() => void) | null = null;

    void listen<SessionScanProgress>("session-scan-progress", (event) => {
      setSessionScanProgress(event.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      cleanupSession = unlisten;
    });

    void listen<TokenProbeProgress>("token-probe-progress", (event) => {
      setTokenProbeProgress(event.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      cleanupToken = unlisten;
    });

    return () => {
      cancelled = true;
      cleanupSession?.();
      cleanupToken?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!selectedId) {
      setDetail(null);
      setDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setDetailLoading(true);

    void getSessionDetail(selectedId)
      .then((value) => {
        if (!cancelled) {
          startTransition(() => {
            setDetail(value);
            setDetailLoading(false);
          });
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          startTransition(() => {
            setDetail(null);
            setDetailLoading(false);
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, setDetail]);

  useEffect(() => {
    if (hasAutoScanned.current) {
      return;
    }

    hasAutoScanned.current = true;
    void handleRefresh();
  }, []);

  return (
    <main className="app-shell">
      <header className="app-toolbar">
        <div className="app-toolbar-left">
          <div className="app-logo" aria-hidden="true">O</div>
          <div>
            <h1>OmniTrace</h1>
            <div className="app-status-stack">
              <span>{sessions.length} 个会话</span>
              {lastScannedAt ? <span>上次扫描 {lastScannedAt}</span> : null}
            </div>
          </div>
        </div>
        <div className="app-toolbar-actions">
          {activeView === "sessions" ? (
            <ToolbarRangeSelector
              ariaLabel="会话扫描时间范围"
              options={sessionScanTimeRanges}
              value={timeRange}
              onChange={(value) => handleSessionFilterChange({ timeRange: value })}
            />
          ) : (
            <ToolbarRangeSelector
              ariaLabel="Token usage time range"
              options={tokenUsageRanges}
              value={tokenUsageRange}
              onChange={setTokenUsageRange}
            />
          )}
        </div>
        <div className="app-toolbar-actions app-toolbar-primary-actions">
          <button className="scan-button" type="button" onClick={() => void handleOpenTokenUsage()}>
            {tokenProbeLoading ? "◷ 探测中" : "◷ Token 探测"}
          </button>
          <button
            aria-label="↻ 扫描"
            className="scan-button"
            type="button"
            onClick={() => void handleRefresh()}
            disabled={sessionScanLoading}
          >
            {sessionScanLoading ? "◷ 扫描中" : "↻ 扫描"}
          </button>
        </div>
      </header>

      <div className="viewer-shell">
        {activeView === "tokenUsage" ? (
          <TokenUsageView
            report={tokenProbeReport}
            loading={tokenProbeLoading}
            progress={tokenProbeProgress}
            range={tokenUsageRange}
            onBack={() => setActiveView("sessions")}
            onRefresh={() => void handleTokenProbe()}
          />
        ) : (
          <ThreePaneShell
            sessions={sessions}
            selectedId={selectedId}
            detail={detail}
            detailLoading={detailLoading}
            sourceFilter={sourceFilter}
            projectFilter={projectFilter}
            scanProgress={sessionScanProgress}
            onDismissScanProgress={() => setSessionScanProgress(null)}
            onFilterChange={handleSessionFilterChange}
            onSelect={selectSession}
            onDelete={handleDelete}
          />
        )}
      </div>
    </main>
  );
}

export default App;
