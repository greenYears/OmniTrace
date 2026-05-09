import "./styles.css";
import { startTransition, useEffect, useRef, useState } from "react";

import { SettingsView } from "./features/settings/SettingsView";
import { StartupScanView } from "./features/scanning/StartupScanView";
import { ThreePaneShell } from "./features/layout/ThreePaneShell";
import { AppSidebar } from "./features/sidebar/AppSidebar";
import { TimeRangeToolbar } from "./features/timeRange/TimeRangeToolbar";
import { isDateInTimeRange } from "./features/timeRange/timeRange";
import { deleteSession, getSessionDetail, getTokenReport, listSessions } from "./lib/tauri";
import { handleWindowDragPointerDown } from "./lib/windowDrag";
import { useSessionStore } from "./stores/useSessionStore";
import type {
  CustomDateRange,
  TimeRange,
  TokenUsageBucket,
  TokenUsageProbeReport,
} from "./types/session";

type AppView = "sessions" | "tokenUsage" | "settings";
type TokenUsageSourceFilter = "all" | "claude_code" | "codex";
type TokenLinePoint = {
  x: number;
  y: number;
};

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

function getBeijingDateTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
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

function getHourlyChartDay(timeRange: TimeRange, now = new Date(), customRange?: CustomDateRange) {
  if (timeRange === "today") {
    return getBeijingDateTimeParts(now).date;
  }

  if (timeRange === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return getBeijingDateTimeParts(yesterday).date;
  }

  if (timeRange === "custom" && customRange && customRange.start === customRange.end) {
    return customRange.start;
  }

  return null;
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

function getTokenMetricPoints(
  buckets: TokenUsageBucket[],
  maxValue: number,
  valueOf: (bucket: TokenUsageBucket) => number,
): TokenLinePoint[] {
  return buckets.map((bucket, index) => ({
    x: getTokenLinePointX(index, buckets.length),
    y: 100 - (valueOf(bucket) / maxValue) * 86,
  }));
}

function getTokenLineAreaPath(points: TokenLinePoint[]) {
  if (points.length === 0) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];
  return `${getSmoothTokenLinePath(points)} L ${formatSvgNumber(last.x)} 100 L ${formatSvgNumber(first.x)} 100 Z`;
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

type DateGroup = {
  date: string;
  rows: TokenUsageBucket[];
};

function groupBucketsByDate(buckets: TokenUsageBucket[]): DateGroup[] {
  const map = new Map<string, TokenUsageBucket[]>();
  for (const b of buckets) {
    let group = map.get(b.date);
    if (!group) {
      group = [];
      map.set(b.date, group);
    }
    group.push(b);
  }
  const groups: DateGroup[] = [];
  for (const [date, rows] of map) {
    rows.sort((a, b) => b.totalTokens - a.totalTokens);
    groups.push({ date, rows });
  }
  groups.sort((a, b) => b.date.localeCompare(a.date));
  return groups;
}

function modelDisplayName(bucket: TokenUsageBucket) {
  return bucket.modelId || "unknown";
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

function TokenUsageSummary({ report, timeRange, customRange }: { report: TokenUsageProbeReport; timeRange: TimeRange; customRange?: CustomDateRange }) {
  const [sourceFilter, setSourceFilter] = useState<TokenUsageSourceFilter>("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [activeHourlyIndex, setActiveHourlyIndex] = useState<number | null>(null);
  const filteredDays = report.days.filter((bucket) => isDateInTimeRange(bucket.date, timeRange, new Date(), customRange));
  const filteredModelDayBuckets = report.byModelByDay.filter((bucket) => isDateInTimeRange(bucket.date, timeRange, new Date(), customRange));
  const baseModelBuckets = timeRange === "all"
    ? aggregateModelBuckets(report.byModel)
    : aggregateModelBuckets(filteredModelDayBuckets);
  const filteredModelBuckets = filterTokenBuckets(baseModelBuckets, sourceFilter, modelFilter);
  const dailyChartBuckets = sourceFilter === "all" && modelFilter === "all"
    ? filteredDays
    : aggregateBucketsByDate(filteredModelBuckets);
  const hourlyDay = getHourlyChartDay(timeRange, new Date(), customRange);
  const isHourly = Boolean(hourlyDay);
  const hourlySourceBuckets = hourlyDay
    ? sourceFilter === "all" && modelFilter === "all"
      ? report.hours.filter((bucket) => bucket.date.startsWith(`${hourlyDay} `))
      : aggregateBucketsByDate(
          filterTokenBuckets(
            report.byModelByHour.filter((bucket) => bucket.date.startsWith(`${hourlyDay} `)),
            sourceFilter,
            modelFilter,
          ),
        )
    : [];
  const chartBuckets = hourlyDay
    ? buildHourlySeries(hourlySourceBuckets, hourlyDay)
    : dailyChartBuckets;
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
  useEffect(() => {
    if (!isHourly && activeHourlyIndex !== null) {
      setActiveHourlyIndex(null);
      return;
    }

    if (activeHourlyIndex !== null && activeHourlyIndex >= chartBuckets.length) {
      setActiveHourlyIndex(null);
    }
  }, [activeHourlyIndex, chartBuckets.length, isHourly]);
  const maxChartTotal = Math.max(...chartBuckets.map((bucket) => bucket.totalTokens), 1);
  const maxLineValue = Math.max(
    ...chartBuckets.flatMap((bucket) => [
      bucket.inputTokens,
      bucket.outputTokens,
      bucket.cacheTokens,
      bucket.reasoningTokens,
    ]),
    1,
  );
  const tokenLineSeries = [
    {
      name: "input",
      pathClassName: "token-line-path-input",
      areaClassName: "token-line-area-input",
      points: getTokenMetricPoints(chartBuckets, maxLineValue, (bucket) => bucket.inputTokens),
    },
    {
      name: "output",
      pathClassName: "token-line-path-output",
      areaClassName: "token-line-area-output",
      points: getTokenMetricPoints(chartBuckets, maxLineValue, (bucket) => bucket.outputTokens),
    },
    {
      name: "cache",
      pathClassName: "token-line-path-cache",
      areaClassName: "token-line-area-cache",
      points: getTokenMetricPoints(chartBuckets, maxLineValue, (bucket) => bucket.cacheTokens),
    },
    {
      name: "reasoning",
      pathClassName: "token-line-path-reasoning",
      areaClassName: "token-line-area-reasoning",
      points: getTokenMetricPoints(chartBuckets, maxLineValue, (bucket) => bucket.reasoningTokens),
    },
  ];
  const activeHourlyBucket = activeHourlyIndex === null ? null : chartBuckets[activeHourlyIndex] ?? null;
  const activeHourlyLeft = activeHourlyIndex === null ? 0 : getTokenLinePointX(activeHourlyIndex, chartBuckets.length);
  const detailBuckets = filterVisibleTokenDetailBuckets(chartBuckets, isHourly);
  const modelDetailBuckets = isHourly
    ? filterTokenBuckets(
        report.byModelByHour.filter((b) => b.date.startsWith(`${hourlyDay} `)),
        sourceFilter,
        modelFilter,
      ).filter((b) => b.totalTokens > 0)
    : filteredModelDayBuckets;
  const detailDateGroups = groupBucketsByDate(modelDetailBuckets);
  const hasModelDetail = detailDateGroups.length > 0;
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
          <h3>{isHourly ? "按小时消耗" : "按天消耗"}</h3>
          <span>{chartBuckets.length} {isHourly ? "小时" : "天"} · {totals.recordsWithUsage} 条 usage</span>
        </div>
        {chartBuckets.length > 0 ? (
          isHourly ? (
            <div
              className="token-line-chart"
              aria-label="按小时 token 消耗曲线图"
              onMouseLeave={() => setActiveHourlyIndex(null)}
            >
              <svg className="token-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {tokenLineSeries.map((series) => (
                  <path
                    key={`${series.name}:area`}
                    className={`token-line-area ${series.areaClassName}`}
                    d={getTokenLineAreaPath(series.points)}
                  />
                ))}
                {tokenLineSeries.map((series) => (
                  <path
                    key={series.name}
                    className={`token-line-path ${series.pathClassName}`}
                    d={getSmoothTokenLinePath(series.points)}
                  />
                ))}
              </svg>
              <div className="token-line-hitboxes">
                {chartBuckets.map((bucket, index) => {
                  const width = 100 / chartBuckets.length;
                  return (
                    <button
                      key={bucket.date}
                      type="button"
                      className={`token-line-hitbox${bucket.totalTokens > 0 ? " has-usage" : ""}${activeHourlyIndex === index ? " is-active" : ""}`}
                      style={{ left: `${index * width}%`, width: `${width}%` }}
                      aria-label={`${bucket.date} token 消耗`}
                      title={formatTokenTooltip(bucket)}
                      onFocus={() => setActiveHourlyIndex(index)}
                      onMouseEnter={() => setActiveHourlyIndex(index)}
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
            <div className="token-bar-chart" aria-label="按天 token 消耗柱状图">
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
                    <span className="token-bar-date">{bucket.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <p className="token-probe-empty">暂无 usage 数据</p>
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
          <h3>{isHourly ? "按小时明细" : "按天明细"}</h3>
          {hasModelDetail ? (
            <div className="token-day-table">
              <div className="token-day-table-head">
                <span>{isHourly ? "时间" : "日期"}</span>
                <span>模型</span>
                <span>总量</span>
                <span>输入量</span>
                <span>输出量</span>
                <span>缓存量</span>
                <span>思考量</span>
              </div>
              {detailDateGroups.map((group) =>
                group.rows.map((row, rowIndex) => (
                  <div
                    key={`${row.date}-${row.sourceId}-${row.modelId}`}
                    className={`token-day-table-row${rowIndex > 0 ? " is-sub-row" : ""}`}
                    title={formatTokenTooltip(row)}
                  >
                    {rowIndex === 0 ? (
                      <span className="token-day-date-cell">
                        {isHourly ? row.date.slice(11) : row.date}
                      </span>
                    ) : (
                      <span className="token-day-date-spacer" />
                    )}
                    <span className="token-day-model-cell">{modelDisplayName(row)}</span>
                    <strong>{formatTokenCount(row.totalTokens)}</strong>
                    <span>{formatTokenNumber(row.inputTokens)}</span>
                    <span>{formatTokenNumber(row.outputTokens)}</span>
                    <span>{formatTokenNumber(row.cacheTokens)}</span>
                    <span>{formatTokenNumber(row.reasoningTokens)}</span>
                  </div>
                )),
              )}
            </div>
          ) : detailBuckets.length > 0 ? (
            <div className="token-day-table">
              <div className="token-day-table-head token-day-table-row--simple">
                <span>{isHourly ? "时间" : "日期"}</span>
                <span>总量</span>
                <span>输入量</span>
                <span>输出量</span>
                <span>缓存量</span>
                <span>思考量</span>
              </div>
              {detailBuckets.slice().reverse().map((bucket) => (
                <div key={bucket.date} className="token-day-table-row token-day-table-row--simple" title={formatTokenTooltip(bucket)}>
                  <span>{bucket.date}</span>
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

function TokenUsageView({
  report,
  timeRange,
  customRange,
  onTimeRangeChange,
}: {
  report: TokenUsageProbeReport | null;
  timeRange: TimeRange;
  customRange?: CustomDateRange;
  onTimeRangeChange: (timeRange: TimeRange, customRange?: CustomDateRange) => void;
}) {
  if (!report) {
    return (
      <section className="token-usage-view" aria-label="Token usage view">
        <header className="view-toolbar" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
          <div className="view-toolbar-left" data-tauri-drag-region>
            <h2 className="view-toolbar-title" data-tauri-drag-region>Token Usage</h2>
          </div>
        </header>
        <div className="time-range-toolbar-row" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
          <TimeRangeToolbar value={timeRange} customRange={customRange} onChange={onTimeRangeChange} />
        </div>
        <div className="token-probe-panel">
          <p className="token-probe-empty">暂无 Token 数据，请在设置中扫描</p>
        </div>
      </section>
    );
  }

  return (
    <section className="token-usage-view" aria-label="Token usage view">
      <header className="view-toolbar" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
        <div className="view-toolbar-left" data-tauri-drag-region>
          <h2 className="view-toolbar-title" data-tauri-drag-region>Token Usage</h2>
        </div>
      </header>
      <div className="time-range-toolbar-row" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
        <TimeRangeToolbar value={timeRange} customRange={customRange} onChange={onTimeRangeChange} />
      </div>
      <div className="token-probe-panel">
        <TokenUsageSummary report={report} timeRange={timeRange} customRange={customRange} />
      </div>
    </section>
  );
}

function App() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedId);
  const detail = useSessionStore((s) => s.detail);
  const detailLoading = useSessionStore((s) => s.detailLoading);
  const detailRefreshKey = useSessionStore((s) => s.detailRefreshKey);
  const sourceFilter = useSessionStore((s) => s.sourceFilter);
  const projectFilter = useSessionStore((s) => s.projectFilter);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setDetail = useSessionStore((s) => s.setDetail);
  const setDetailLoading = useSessionStore((s) => s.setDetailLoading);
  const updateFilters = useSessionStore((s) => s.updateFilters);
  const selectSession = useSessionStore((s) => s.selectSession);
  const hasLoadedSessions = useRef(false);
  const [activeView, setActiveView] = useState<AppView>("sessions");
  const [bootState, setBootState] = useState<"booting" | "ready">(() =>
    localStorage.getItem("omnitrace-auto-scan") === "false" ? "ready" : "booting",
  );
  const [tokenReport, setTokenReport] = useState<TokenUsageProbeReport | null>(null);
  const [sessionTimeRange, setSessionTimeRange] = useState<TimeRange>("today");
  const [tokenTimeRange, setTokenTimeRange] = useState<TimeRange>("today");
  const [sessionCustomRange, setSessionCustomRange] = useState<CustomDateRange | undefined>();
  const [tokenCustomRange, setTokenCustomRange] = useState<CustomDateRange | undefined>();

  function handleSessionTimeRangeChange(range: TimeRange, customRange?: CustomDateRange) {
    setSessionTimeRange(range);
    setSessionCustomRange(range === "custom" ? customRange : undefined);
  }

  function handleTokenTimeRangeChange(range: TimeRange, customRange?: CustomDateRange) {
    setTokenTimeRange(range);
    setTokenCustomRange(range === "custom" ? customRange : undefined);
  }

  async function handleDelete(id: string) {
    try {
      await deleteSession(id);
      const nextSessions = await listSessions();
      setSessions(nextSessions);
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshSessions() {
    const nextSessions = await listSessions();
    setSessions(nextSessions);
  }

  async function refreshTokenReport() {
    const nextReport = await getTokenReport();
    setTokenReport(nextReport);
  }

  async function handleScanComplete() {
    await Promise.all([
      refreshSessions(),
      refreshTokenReport(),
    ]);
  }

  async function handleStartupScanComplete() {
    await handleScanComplete();
    setBootState("ready");
  }

  function handleStartupScanSkip() {
    setBootState("ready");
  }

  function handleSessionFilterChange(next: {
    sourceFilter?: "all" | "claude_code" | "codex";
    projectFilter?: string;
  }) {
    updateFilters(next);
  }

  function handleViewChange(view: AppView) {
    setActiveView(view);
    if (view === "tokenUsage" && !tokenReport) {
      void getTokenReport()
        .then(setTokenReport)
        .catch(console.error);
    }
  }

  // Auto-load sessions from SQLite on mount
  useEffect(() => {
    if (hasLoadedSessions.current) {
      return;
    }
    hasLoadedSessions.current = true;
    listSessions()
      .then(setSessions)
      .catch(console.error);
  }, [setSessions]);

  // Load detail when selected session changes or is explicitly refreshed.
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
  }, [selectedId, detailRefreshKey, setDetail, setDetailLoading]);

  if (bootState === "booting") {
    return (
      <main className="app-shell">
        <div className="app-main">
          <div className="viewer-shell">
            <StartupScanView
              onComplete={() => void handleStartupScanComplete()}
              onSkip={handleStartupScanSkip}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <AppSidebar activeView={activeView} onViewChange={handleViewChange} />
      <div className="app-main">
        <div className="viewer-shell">
          {activeView === "settings" ? (
            <SettingsView onScanComplete={handleScanComplete} />
          ) : activeView === "tokenUsage" ? (
            <TokenUsageView
              report={tokenReport}
              timeRange={tokenTimeRange}
              customRange={tokenCustomRange}
              onTimeRangeChange={handleTokenTimeRangeChange}
            />
          ) : (
            <ThreePaneShell
              sessions={sessions}
              selectedId={selectedId}
              detail={detail}
              detailLoading={detailLoading}
              sourceFilter={sourceFilter}
              projectFilter={projectFilter}
              timeRange={sessionTimeRange}
              customRange={sessionCustomRange}
              onFilterChange={handleSessionFilterChange}
              onTimeRangeChange={handleSessionTimeRangeChange}
              onSelect={selectSession}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
