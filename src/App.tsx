import "./styles.css";
import { startTransition, type PointerEvent, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { ThreePaneShell } from "./features/layout/ThreePaneShell";
import { deleteSession, getSessionDetail, probeTokenUsageSources, scanSources } from "./lib/tauri";
import { useSessionStore } from "./stores/useSessionStore";
import type {
  CustomDateRange,
  SessionScanProgress,
  TimeRange,
  TokenProbeProgress,
  TokenUsageBucket,
  TokenUsageProbeReport,
} from "./types/session";

type AppView = "sessions" | "tokenUsage";
type TokenUsageRange = TimeRange;
type TokenUsageSourceFilter = "all" | "claude_code" | "codex";
type TokenLineMetric = {
  key: keyof Pick<TokenUsageBucket, "inputTokens" | "outputTokens" | "cacheTokens" | "reasoningTokens">;
  name: "input" | "output" | "cache" | "reasoning";
};
type TokenLinePoint = {
  x: number;
  y: number;
};

const tokenUsageRanges: Array<{ value: TokenUsageRange; label: string }> = [
  { value: "today", label: "当日" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
  { value: "custom", label: "自定义" },
  { value: "all", label: "全部" },
];
const tokenUsageTimeZone = "Asia/Shanghai";
const sessionScanTimeRanges: Array<{ value: TimeRange; label: string }> = [
  { value: "today", label: "当日" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
  { value: "custom", label: "自定义" },
  { value: "all", label: "全部" },
];
const tokenLineMetrics: TokenLineMetric[] = [
  { key: "inputTokens", name: "input" },
  { key: "outputTokens", name: "output" },
  { key: "cacheTokens", name: "cache" },
  { key: "reasoningTokens", name: "reasoning" },
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

function isValidDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidCustomDateRange(range: CustomDateRange) {
  return isValidDateValue(range.startDate) && isValidDateValue(range.endDate) && range.startDate <= range.endDate;
}

function serializeTimeRange(range: TimeRange, customRange: CustomDateRange) {
  return range === "custom" && isValidCustomDateRange(customRange)
    ? `custom:${customRange.startDate}:${customRange.endDate}`
    : range;
}

function getTodayDateValue() {
  return getBeijingDateTimeParts(new Date()).date;
}

function getCustomDateParts(value: string) {
  const [year = "", month = "", day = ""] = value.split("-");

  return { year, month, day };
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

export function filterBucketsByRange(
  days: TokenUsageBucket[],
  range: TokenUsageRange,
  customRange: CustomDateRange = { startDate: "", endDate: "" },
) {
  const sortedDays = [...days]
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (range === "today") {
    const latestDay = sortedDays[sortedDays.length - 1]?.date;
    return latestDay ? sortedDays.filter((day) => day.date === latestDay) : [];
  }

  if (range === "custom") {
    return isValidCustomDateRange(customRange)
      ? sortedDays.filter((day) => day.date >= customRange.startDate && day.date <= customRange.endDate)
      : [];
  }

  if (range === "all" || sortedDays.length === 0) {
    return sortedDays;
  }

  const latest = new Date(`${sortedDays[sortedDays.length - 1].date}T00:00:00Z`);
  const rangeDays = range === "7d" ? 7 : 30;
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

export function getTokenLineHoverIndex(
  pointerX: number,
  chartLeft: number,
  chartWidth: number,
  bucketCount: number,
) {
  if (chartWidth <= 0 || bucketCount <= 0) {
    return null;
  }

  const relativeX = Math.min(Math.max(pointerX - chartLeft, 0), chartWidth - 0.01);
  const ratio = relativeX / chartWidth;

  return Math.min(bucketCount - 1, Math.max(0, Math.floor(ratio * bucketCount)));
}

export function getTokenLinePointX(index: number, bucketCount: number) {
  if (bucketCount <= 1) {
    return 50;
  }

  return ((index + 0.5) / bucketCount) * 100;
}

function formatSvgNumber(value: number) {
  return Number.parseFloat(value.toFixed(3)).toString();
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getSmoothTokenLinePath(points: TokenLinePoint[]) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${formatSvgNumber(points[0].x)} ${formatSvgNumber(points[0].y)}`;
  }

  const commands = [`M ${formatSvgNumber(points[0].x)} ${formatSvgNumber(points[0].y)}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;
    const minY = Math.min(current.y, next.y);
    const maxY = Math.max(current.y, next.y);
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: clampNumber(current.y + (next.y - previous.y) / 6, minY, maxY),
    };
    const controlTwo = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: clampNumber(next.y - (afterNext.y - current.y) / 6, minY, maxY),
    };

    commands.push([
      "C",
      formatSvgNumber(controlOne.x),
      formatSvgNumber(controlOne.y),
      formatSvgNumber(controlTwo.x),
      formatSvgNumber(controlTwo.y),
      formatSvgNumber(next.x),
      formatSvgNumber(next.y),
    ].join(" "));
  }

  return commands.join(" ");
}

function getSmoothTokenAreaPath(points: TokenLinePoint[], baselineY: number) {
  if (points.length === 0) {
    return "";
  }

  const firstX = points[0].x;
  const lastX = points[points.length - 1].x;

  return [
    getSmoothTokenLinePath(points),
    `L ${formatSvgNumber(lastX)} ${formatSvgNumber(baselineY)}`,
    `L ${formatSvgNumber(firstX)} ${formatSvgNumber(baselineY)}`,
    "Z",
  ].join(" ");
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
  customRange,
}: {
  report: TokenUsageProbeReport;
  range: TokenUsageRange;
  customRange: CustomDateRange;
}) {
  const [sourceFilter, setSourceFilter] = useState<TokenUsageSourceFilter>("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [activeHourlyIndex, setActiveHourlyIndex] = useState<number | null>(null);
  const isHourly = range === "today";
  const latestDay = getLatestUsageDay(report.days);
  const filteredDays = filterBucketsByRange(report.days, range, customRange);
  const baseModelBuckets = isHourly
    ? filterHourlyBucketsByDay(report.byModelByHour, latestDay)
    : filterBucketsByRange(report.byModelByDay, range, customRange);
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
  const maxLineValue = Math.max(
    ...chartBuckets.flatMap((bucket) => tokenLineMetrics.map((metric) => bucket[metric.key])),
    1,
  );
  const getLineY = (value: number) => 92 - (value / maxLineValue) * 84;
  const lineSeries = tokenLineMetrics.map((metric) => {
    const points = chartBuckets.map((bucket, index) => ({
      x: getTokenLinePointX(index, chartBuckets.length),
      y: getLineY(bucket[metric.key]),
    }));

    return {
      ...metric,
      path: getSmoothTokenLinePath(points),
      areaPath: getSmoothTokenAreaPath(points, 92),
    };
  });
  const activeHourlyBucket = activeHourlyIndex === null ? null : chartBuckets[activeHourlyIndex] ?? null;
  const activeHourlyLeft = activeHourlyIndex === null || chartBuckets.length === 0
    ? 50
    : Math.min(Math.max(((activeHourlyIndex + 0.5) / chartBuckets.length) * 100, 6), 94);
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
  const handleTokenLinePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setActiveHourlyIndex(getTokenLineHoverIndex(event.clientX, rect.left, rect.width, chartBuckets.length));
  };

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
                {lineSeries.map((series) => (
                  <path
                    key={`${series.name}-area`}
                    className={`token-line-area token-line-area-${series.name}`}
                    d={series.areaPath}
                  />
                ))}
                {lineSeries.map((series) => (
                  <path
                    key={`${series.name}-path`}
                    className={`token-line-path token-line-path-${series.name}`}
                    d={series.path}
                  />
                ))}
              </svg>
              <div
                className="token-line-hitboxes"
                onPointerMove={handleTokenLinePointerMove}
                onPointerLeave={() => setActiveHourlyIndex(null)}
              >
                {chartBuckets.map((bucket, index) => {
                  const tooltip = formatTokenTooltip(bucket);
                  const width = 100 / chartBuckets.length;

                  return (
                    <div
                      key={bucket.date}
                      className={[
                        "token-line-hitbox",
                        bucket.totalTokens > 0 ? "has-usage" : "",
                        activeHourlyIndex === index ? "is-active" : "",
                      ].filter(Boolean).join(" ")}
                      aria-label={tooltip}
                      data-tooltip={tooltip}
                      onFocus={() => setActiveHourlyIndex(index)}
                      onBlur={() => setActiveHourlyIndex(null)}
                      style={{ left: `${index * width}%`, width: `${width}%` }}
                      tabIndex={0}
                    />
                  );
                })}
                {activeHourlyBucket ? (
                  <div
                    className="token-line-tooltip"
                    role="status"
                    style={{ left: `${activeHourlyLeft}%` }}
                  >
                    {formatTokenTooltip(activeHourlyBucket)}
                  </div>
                ) : null}
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

function ToolbarRangeSelector<T extends string>({
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
  customRange,
  onBack,
  onRefresh,
}: {
  report: TokenUsageProbeReport | null;
  loading: boolean;
  progress: TokenProbeProgress | null;
  range: TokenUsageRange;
  customRange: CustomDateRange;
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
          <TokenUsageSummary report={report} range={range} customRange={customRange} />
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
  const [sessionCustomRange, setSessionCustomRange] = useState<CustomDateRange>({ startDate: "", endDate: "" });
  const [tokenCustomRange, setTokenCustomRange] = useState<CustomDateRange>({ startDate: "", endDate: "" });
  const [sessionScanLoading, setSessionScanLoading] = useState(false);
  const [sessionScanProgress, setSessionScanProgress] = useState<SessionScanProgress | null>(null);
  const [tokenProbeProgress, setTokenProbeProgress] = useState<TokenProbeProgress | null>(null);
  const canUseSessionRange = timeRange !== "custom" || isValidCustomDateRange(sessionCustomRange);

  async function handleRefresh() {
    if (!canUseSessionRange) {
      return;
    }

    setSessionScanLoading(true);
    setSessionScanProgress(null);
    try {
      const nextSessions = await scanSources(serializeTimeRange(timeRange, sessionCustomRange));
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
              customRange={sessionCustomRange}
              onCustomRangeChange={setSessionCustomRange}
            />
          ) : (
            <ToolbarRangeSelector
              ariaLabel="Token usage time range"
              options={tokenUsageRanges}
              value={tokenUsageRange}
              onChange={setTokenUsageRange}
              customRange={tokenCustomRange}
              onCustomRangeChange={setTokenCustomRange}
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
            disabled={sessionScanLoading || !canUseSessionRange}
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
            customRange={tokenCustomRange}
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
