import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Area, AreaChart, Brush, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Country, Status } from "@/components/NodeCard"
import { SegmentBar, type MetricKey } from "@/components/SegmentBar"
import { api, friendly, type Node } from "@/lib/api"
import { addresses, type AddressSource } from "@/lib/address"
import {
  axisBytes, axisTop, bytes, clockFor, quarters, cpuName, CYCLES, FOREVER, maskIp, money, osName, pc,
  percent, rate, timeTicks, uptime,
} from "@/lib/format"
import { loadPercent, monthUsage } from "@/lib/node"
import { rangesFor, rangesOn, spanFor } from "@/lib/ranges"
import { CHUNK_RELOAD_KEY } from "@/lib/reload"
import { despike, type PingPoint } from "@/lib/series"
import { toneFor } from "@/lib/severity"
import { cn } from "@/lib/utils"

/*
 * `net_rx_max`/`net_tx_max`/`cpu_max` are the bucket's peak rather than its mean:
 * hub v1.3.1 stores the highest rate reported inside each minute, so a ten-second
 * speed test is no longer averaged away into the rest of that minute and thereby
 * invisible in a 7-day window. `cpu_max` arrived with the same idea a version
 * later, in v1.3.2, and is stored the same way.
 *
 * `minutes` is how many minute rows the bucket actually folded in, also v1.3.2,
 * and `step` in the payload says how many seconds a full bucket covers. The two
 * together are the only way to tell a bucket that averaged a whole period from
 * one that averaged a fraction of it -- see `shortBuckets`.
 *
 * All four are optional because rows predating that hub column, and every older
 * hub, omit them.
 */
type Point = {
  ts: number
  cpu: number
  cpu_max: number | null
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  net_rx_max: number | null
  net_tx_max: number | null
  minutes: number | null
}

/** One row of the metrics response before it has been checked. */
type RawPoint = {
  ts?: unknown
  cpu?: unknown
  cpu_max?: unknown
  mem_used?: unknown
  disk_used?: unknown
  net_rx?: unknown
  net_tx?: unknown
  net_rx_max?: unknown
  net_tx_max?: unknown
  minutes?: unknown
}

type Probes = Record<string, string>
type Loss = Record<string, number>
/*
 * `hours` is the window the hub actually answered for, which is not always the
 * one asked for: it clamps the request to its retention, so a hub keeping 7 days
 * answers 168 for a request of 720. Read back rather than assumed -- otherwise
 * the range button says 30 天 over a chart of 7.
 *
 * `step` is how many seconds each returned point covers, new in v1.3.2: whole
 * minutes inside the detail window, whole hours beyond it. Zero-length windows
 * and older hubs omit it.
 */
type Payload = {
  metrics: RawPoint[]
  ping: PingPoint[]
  probes: Probes
  loss?: Loss
  hours?: unknown
  step?: unknown
}

/** One probe's series after it has been assembled from the ping payload. */
type PingSeries = { id: number; name: string; points: PingPoint[]; loss: number }
/** One timestamped column shared by every probe line at that instant. */
type PingRow = { ts: number } & Record<string, number | [number, number] | null>

/** One fetch, tagged with the query it answers. */
type Result = { key: string; payload: Payload; error: string }

/*
 * Gated once per mount: true for the first render, false forever after, so the
 * chart pays exactly one animation flight and every later render (socket point,
 * range change) draws statically.
 *
 * Held in state rather than a ref because reading a ref during render is not
 * render-safe -- React is free to re-render before the effect commits, and a
 * concurrent render can observe the mutated value. The initial value is
 * computed once by the lazy initialiser, so the reduced-motion check happens
 * before the chart ever mounts and such a user sees no frame of animation.
 * The effect then flips it, costing one extra render, which is the price of
 * reading a value that render is allowed to depend on.
 */
function useMountOnce() {
  const [animate] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? false
      : true,
  )
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    // Deferred by a task so the first paint still carries the animation start.
    const id = setTimeout(() => setSettled(true), 0)
    return () => clearTimeout(id)
  }, [])
  return animate && !settled
}

const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }
const SERIES = {
  dot: false as const,
  strokeWidth: 1.5,
  isAnimationActive: false,
  // A hover anchor. With dots off there was no telling which of several grey
  // lines the cursor sat on; activeDot renders only for the hovered point, so
  // it costs nothing across the 1500-point series.
  activeDot: { r: 3, strokeWidth: 0 },
}
const Y_WIDTH = 68

/*
 * The peak companion to a mean line -- the rate panels' pair, and CPU's. Same
 * hue, dashed and thinner, so it reads as a property of the line under it rather
 * than as another series competing for attention. The mean stays the primary
 * reading; the peak is the answer to "did anything actually saturate this in the
 * window", which for CPU is a spike that a one-minute average flattens.
 *
 * `connectNulls` is deliberately off: a hub before v1.3.1 sends no rate peak and
 * one before v1.3.2 no CPU peak, and joining across that gap would draw a
 * confident straight line through data that does not exist.
 */
const PEAK_SERIES = {
  ...SERIES,
  strokeWidth: 1,
  strokeDasharray: "4 3",
  strokeOpacity: 0.55,
}

/*
 * The cursor line used to be recharts' hard-coded #ccc -- one foreign grey that
 * did not follow the theme and read too bright on the dark card. It now draws
 * in the same border token as the grid.
 */
const CURSOR = { stroke: "var(--color-border)", strokeWidth: 1 }

/**
 * Probes are assigned colours in the order they appear and distinguished by dash
 * as well: with five or more, colour alone is not enough, and the previous
 * palette drew probe 1 and probe 5 in two oranges.
 */
const PALETTE = [
  { stroke: "var(--color-chart-1)", dash: undefined },
  { stroke: "var(--color-chart-2)", dash: "6 3" },
  { stroke: "var(--color-chart-3)", dash: "2 3" },
  { stroke: "var(--color-chart-4)", dash: "10 4 2 4" },
  { stroke: "var(--color-chart-5)", dash: "1 4" },
  // Six or more probes: colour alone is gone, so the dash recombines while the
  // stroke stays inside the same five chart tokens (no new hue). The 6th and 7th
  // keep a distinct dash so they never read as a repeat of probe 1.
  { stroke: "var(--color-chart-1)", dash: "12 2 2 2" },
  { stroke: "var(--color-chart-2)", dash: "8 2 1 2 1 2" },
  { stroke: "var(--color-chart-3)", dash: "4 4" },
]

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const

/** A number safe to plot: NaN, Infinity and negatives all collapse to zero. */
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0)

/**
 * A bucket's peak rate, floored at that bucket's mean.
 *
 * The floor is what keeps the two lines in the right order. `net_rx_max` is the
 * highest rate recorded inside the minute, while `net_rx` is the mean of the
 * samples in it, so a genuine peak can never sit below its own mean -- but the
 * hub computes the mean from its own arrival times rather than the agent's
 * clock, so network jitter can push the mean a hair above the reported peak.
 * Drawing that as-is puts the peak line under the average it belongs above.
 *
 * Returns null when there is no peak to draw at all, which is every hub before
 * v1.3.1 and every row predating the column. The chart then omits the line
 * instead of drawing it flat on top of the mean.
 */
const peak = (v: unknown, mean: number): number | null => {
  if (v === null || v === undefined) return null
  const p = num(v)
  return p > 0 ? Math.max(p, mean) : null
}

/**
 * A count the hub may simply not have sent.
 *
 * Kept null rather than zeroed the way `num` does it: for `minutes`, zero would
 * be a reading ("this bucket folded in no rows at all") and absent means "this
 * hub does not report coverage", and the one caller has to tell them apart.
 */
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null

function Panel({ title, ariaLabel, legend, children }: {
  title: string
  ariaLabel: string
  legend?: { label: string; color: string }[]
  children: React.ReactNode
}) {
  return (
    <div>
      <h4 className="mb-2 flex flex-wrap items-center gap-x-3 text-xs font-medium text-muted-foreground">
        {title}
        {legend && (
          <span className="flex items-center gap-2 font-normal">
            {legend.map((entry) => (
              <span key={entry.label} className="inline-flex items-center gap-1">
                <svg width="12" height="6" aria-hidden>
                  <line x1="0" y1="3" x2="12" y2="3" stroke={entry.color} strokeWidth="2" />
                </svg>
                {entry.label}
              </span>
            ))}
          </span>
        )}
      </h4>
      <div className="h-40 w-full text-muted-foreground" role="img" aria-label={ariaLabel}>
        {children}
      </div>
    </div>
  )
}

/** One tooltip style for every chart, so four panels cannot drift apart. The
 *  variables are theme tokens, so dark mode gets a dark tooltip for free --
 *  recharts' own default is an opaque white block in both modes. The panel is
 *  frosted over the chart it annotates; the solid `backgroundColor` is declared
 *  first as the fallback for an engine without backdrop-filter or color-mix. */
const TOOLTIP = {
  contentStyle: {
    fontSize: 12,
    backgroundColor: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: 10,
    color: "var(--color-popover-foreground)",
    boxShadow: "var(--elevation-pop)",
  } as React.CSSProperties,
  labelStyle: { color: "var(--color-muted-foreground)" },
  itemStyle: { color: "var(--color-popover-foreground)" },
  cursor: CURSOR,
}

/* Frosted variant layered on after the solid fallback, so an unsupported
   browser keeps the solid popover rather than losing its background. */
const GLASS_TOOLTIP = {
  ...TOOLTIP,
  contentStyle: {
    ...TOOLTIP.contentStyle,
    backgroundColor: "color-mix(in srgb, var(--color-popover) 80%, transparent)",
    backdropFilter: "blur(12px) saturate(1.3)",
    WebkitBackdropFilter: "blur(12px) saturate(1.3)",
  } as React.CSSProperties,
}

const labelTime = (value: unknown) => new Date(Number(value)).toLocaleString("zh-CN")

/**
 * The time axis, built from explicit ticks.
 *
 * A module-level function taking `hours`, rather than a closure inside the
 * component: the four resource panels below are memoised, and a value rebuilt on
 * every render would defeat the comparison they exist for.
 */
const timeAxis = (rows: { ts: number }[], hours: number, from = 0, to = rows.length - 1) => ({
  dataKey: "ts",
  type: "number" as const,
  domain: ["dataMin", "dataMax"] as const,
  ticks: rows.length ? timeTicks(rows[from].ts, rows[to].ts) : undefined,
  tickFormatter: clockFor(hours),
  minTickGap: hours > 24 ? 72 : 40,
  ...AXIS,
})

/*
 * The four resource charts, each memoised on its own.
 *
 * The detail page sits on a two-second push, and `metricRows` only gains a point
 * when the window's own cadence is crossed -- otherwise it is the same array
 * reference, because the rows are rebuilt only when a fetch lands. Without a
 * boundary here every push re-laid-out all four charts: up to 1500 points each,
 * around thirty times a minute, on a page whose whole purpose is to be left open
 * on a spare screen. The cost is real on a low-end machine and on battery.
 */
const CpuPanel = memo(function CpuPanel({ rows, top, hours, hasPeak }: { rows: Point[]; top: number; hours: number; hasPeak: boolean }) {
  const ani = useMountOnce()
  return (
    <Panel title="CPU" ariaLabel="CPU 使用率历史曲线">
      <ResponsiveContainer>
        {/*
          * A ComposedChart rather than the AreaChart this used to be: recharts
          * drops a `Line` handed to AreaChart, so the peak needs the chart type
          * that accepts both.
          */}
        <ComposedChart data={rows}>
          <defs>
            <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...timeAxis(rows, hours)} />
          <YAxis domain={[0, top]} ticks={quarters(top)} unit="%" width={Y_WIDTH} {...AXIS} />
          <Tooltip labelFormatter={labelTime} formatter={(v) => `${Number(v).toFixed(1)}%`} {...GLASS_TOOLTIP} />
          <Area dataKey="cpu" name="CPU" stroke="var(--color-chart-1)" fill="url(#cpuFill)" {...SERIES} isAnimationActive={ani} />
          {/*
            Drawn only when the hub reported a CPU peak for this window: the
            field is v1.3.2, and an empty line over a v1.3.1 hub would read as a
            flat zero rather than as an absent series.
          */}
          {hasPeak && (
            <Line
              dataKey="cpu_max"
              name="CPU 峰值"
              stroke="var(--color-chart-1)"
              {...PEAK_SERIES}
              isAnimationActive={ani}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
})

const MemoryPanel = memo(function MemoryPanel({ rows, total, hours }: { rows: Point[]; total: number; hours: number }) {
  const top = Math.max(total, 1)
  const ani = useMountOnce()
  return (
    <Panel title={`内存 · ${bytes(total)}`} ariaLabel="内存占用历史曲线">
      <ResponsiveContainer>
        <AreaChart data={rows}>
          <defs>
            <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...timeAxis(rows, hours)} />
          <YAxis domain={[0, top]} ticks={quarters(top)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
          <Tooltip labelFormatter={labelTime} formatter={(v) => bytes(Number(v))} {...GLASS_TOOLTIP} />
          <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-2)" fill="url(#memFill)" {...SERIES} isAnimationActive={ani} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
})

const RatePanel = memo(function RatePanel({ rows, top, hours, hasPeak }: { rows: Point[]; top: number; hours: number; hasPeak: boolean }) {
  const ani = useMountOnce()
  return (
    <Panel
      title="网络速率"
      ariaLabel="网络上下行速率历史曲线"
      legend={[
        { label: "下行", color: "var(--color-chart-1)" },
        { label: "上行", color: "var(--color-chart-4)" },
      ]}
    >
      <ResponsiveContainer>
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...timeAxis(rows, hours)} />
          <YAxis domain={[0, top]} ticks={quarters(top)} tickFormatter={axisBytes} unit="/s" width={Y_WIDTH} {...AXIS} />
          <Tooltip labelFormatter={labelTime} formatter={(v) => rate(Number(v))} {...GLASS_TOOLTIP} />
          {/*
            * Not the status green. These used to be drawn in --ok, which is also
            * the colour of the "online" dot: one hue, two meanings, in a palette
            * whose whole point is that colour says alert and nothing else.
            */}
          <Line dataKey="net_rx" name="下行" stroke="var(--color-chart-1)" {...SERIES} isAnimationActive={ani} />
          <Line dataKey="net_tx" name="上行" stroke="var(--color-chart-4)" {...SERIES} isAnimationActive={ani} />
          {/*
            * Drawn only when the hub actually reported a peak for this window.
            * Old hubs omit the fields, new hubs include them only for rows that
            * recorded one, and a pair of empty dashed lines is worse than none.
            */}
          {hasPeak && (
            <>
              <Line dataKey="net_rx_max" name="下行峰值" stroke="var(--color-chart-1)" {...PEAK_SERIES} isAnimationActive={ani} />
              <Line dataKey="net_tx_max" name="上行峰值" stroke="var(--color-chart-4)" {...PEAK_SERIES} isAnimationActive={ani} />
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  )
})

const DiskPanel = memo(function DiskPanel({ rows, total, hours }: { rows: Point[]; total: number; hours: number }) {
  const ani = useMountOnce()
  // Memory already guarded this with Math.max(total, 1). Disk did not, so a
  // container that never reported a capacity drew a [0,0] axis with an area
  // glued to the baseline -- reading "disk is full at zero" rather than "no
  // capacity known". Without a ceiling the percentage has no meaning, so say
  // so instead of drawing a broken chart.
  if (total <= 0) {
    return (
      <Panel title="硬盘" ariaLabel="硬盘占用历史曲线">
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          该节点没有上报硬盘容量
        </div>
      </Panel>
    )
  }
  return (
    <Panel title={`硬盘 · ${bytes(total)}`} ariaLabel="硬盘占用历史曲线">
      <ResponsiveContainer>
        <AreaChart data={rows}>
          <defs>
            <linearGradient id="diskFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...timeAxis(rows, hours)} />
          <YAxis domain={[0, total]} ticks={quarters(total)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
          <Tooltip labelFormatter={labelTime} formatter={(v) => bytes(Number(v))} {...GLASS_TOOLTIP} />
          <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-2)" fill="url(#diskFill)" {...SERIES} isAnimationActive={ani} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
})

/*
 * The latency chart, memoised on its own for the same reason the four resource
 * panels are: the detail page sits on a two-second push and, until now, this
 * 5-line × up-to-1500-point tree reconciled on every one of them. Every prop
 * here is a stable reference across pushes (pingSeries/pingRows/shownProbes are
 * memoised above, hidden/zoom are state, the callbacks are useCallback'd), so
 * the memo short-circuits the push and re-renders only on a real change.
 */
const LatencyChart = memo(function LatencyChart({
  pingSeries, pingRows, shownProbes, smooth, hours, zoom, chartBox, chartTop,
  hidden, nodeId, onZoom, onToggle,
}: {
  pingSeries: PingSeries[]
  pingRows: PingRow[]
  shownProbes: PingSeries[]
  smooth: boolean
  hours: number
  zoom: [number, number] | null
  chartBox: React.RefObject<HTMLDivElement | null>
  chartTop: number
  hidden: Hidden
  nodeId: number
  onZoom: (range: [number, number] | null) => void
  onToggle: (id: number) => void
}) {
  const hiddenProbes = hiddenFor(hidden, nodeId)
  const style = (id: number) => PALETTE[pingSeries.findIndex((p) => p.id === id) % PALETTE.length]

  return (
    <div
      ref={chartBox}
      style={chartTop ? { height: `calc(100svh - ${chartTop}px - 1rem)` } : undefined}
      className="flex min-h-72 flex-col gap-3">
      <div className="min-h-0 w-full flex-1 text-muted-foreground" role="img" aria-label="各探测点网络延迟历史曲线">
        {shownProbes.length === 0 ? (
          <p className="py-8 text-center text-sm">没有选中任何探测</p>
        ) : pingRows.length < 2 ? (
          /*
           * A line needs two points: one row gives each probe a single sample,
           * invisible with dots off. This is the first probe response arriving
           * for a newly added node, same as the resource-chart rule.
           */
          <p className="py-8 text-center text-sm text-muted-foreground">
            只有 {pingRows.length} 个采样点，暂时画不出曲线。过几分钟再看。
          </p>
        ) : (
          <ResponsiveContainer>
            <ComposedChart data={pingRows}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                {...timeAxis(
                  pingRows,
                  hours,
                  Math.min(zoom?.[0] ?? 0, pingRows.length - 1),
                  Math.min(zoom?.[1] ?? pingRows.length - 1, pingRows.length - 1),
                )}
              />
              <YAxis unit="ms" width={52} domain={["auto", "auto"]} {...AXIS} />
              <Tooltip
                labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                formatter={(v, name, item) => {
                  const loss = Number(item?.payload?.[`l${String(item.dataKey).slice(1)}`] ?? 0)
                  return [`${Number(v)} ms${loss > 0 ? ` · 丢 ${loss}%` : ""}`, name]
                }}
                {...GLASS_TOOLTIP}
              />
              {shownProbes.length === 1 &&
                shownProbes.map((s) => (
                  <Area
                    key={`band${s.id}`}
                    dataKey={`b${s.id}`}
                    stroke="none"
                    fill={style(s.id).stroke}
                    fillOpacity={0.16}
                    isAnimationActive={false}
                    tooltipType="none"
                    legendType="none"
                  />
                ))}
              {shownProbes.map((s) => (
                <Line
                  key={s.id}
                  dataKey={`${smooth ? "s" : "t"}${s.id}`}
                  name={s.name}
                  stroke={style(s.id).stroke}
                  strokeDasharray={style(s.id).dash}
                  /*
                   * Not connectNulls. A probe that stopped answering
                   * produces no sample, and joining across the gap draws
                   * a straight line through the outage -- the chart
                   * asserts the link was up throughout. The gap is the
                   * finding.
                   */
                  {...SERIES}
                />
              ))}
              {/*
                Controlled. The Brush used to be uncontrolled, so the
                actual cropping lived in recharts' own store and the
                "reset zoom" button only cleared our React state: the
                button vanished but the chart stayed zoomed, leaving the
                Brush drag as the only way back. Feeding the indices back
                makes a null zoom re-align the internal window to the full
                range (verified against recharts 3.10's controlled branch).

                Handles at 8px were drawn for a mouse: on a phone the
                traveller is a sliver under a fingertip, and dragging it
                is the only way to zoom.
                `touch-none` is deliberately not set on the chart box --
                it would stop the page scrolling with a finger anywhere
                over the graph, which is most of the screen in portrait.
              */}
              <Brush
                dataKey="ts"
                height={28}
                travellerWidth={20}
                startIndex={zoom?.[0] ?? 0}
                endIndex={zoom?.[1] ?? pingRows.length - 1}
                tickFormatter={clockFor(hours)}
                className="fill-muted"
                stroke="var(--color-muted-foreground)"
                onChange={(r) => onZoom([r.startIndex ?? 0, r.endIndex ?? pingRows.length - 1])}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {(pingSeries.length > 1 || pingSeries.some((s) => s.loss > 0)) && (
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {pingSeries.map((s) => {
          const shown = !hiddenProbes.includes(s.id)
          return (
            <button
              key={s.id}
              onClick={() => onToggle(s.id)}
              aria-pressed={shown}
              /*
               * Hidden was opacity-40 over the whole button, which pushed
               * its 12px label to ~2.5:1 and its border under 1.1:1 -- it
               * is an aria-pressed toggle, not a disabled control, so the
               * difference now uses an opaque muted ink and a suffix
               * instead of a translucency that failed contrast.
               */
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                shown ? "border-border" : "border-ui-border text-muted-foreground"
              }`}
            >
              <svg width="14" height="6" className="shrink-0" aria-hidden>
                <line
                  x1="0" y1="3" x2="14" y2="3"
                  stroke={style(s.id).stroke}
                  strokeDasharray={style(s.id).dash}
                  strokeWidth="2"
                />
              </svg>
              {s.name}
              {!shown && <span className="text-muted-2">已隐藏</span>}
              {s.loss > 0 && (
                <span className="tabular-nums opacity-60">
                  丢 {s.loss < 1 ? "<1" : Math.round(s.loss)}%
                </span>
              )}
            </button>
          )
        })}
      </div>
      )}
    </div>
  )
})

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function Fact({ label, value, tone = "" }: { label: string; value?: string | number | null; tone?: string }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-sm", tone)}>{value}</dd>
    </div>
  )
}

/**
 * A fact with the meter the card draws, so the two screens agree.
 *
 * The card carried a metre per reading and this page carried none, which made
 * the detail view strictly less readable than the tile that opened it: four
 * byte pairs stacked as text say what was measured but not how close to full
 * any of it is. Same `SegmentBar`, therefore the same 16 cells and the same
 * rounding -- a 76.53% reading cannot be twelve cells here and eleven there.
 *
 * The bar is a restatement of the number above it, not a separate reading, so
 * it stays out of the accessibility tree; the value is already the `<dd>`.
 */
function MeteredFact({
  label,
  value,
  pct,
  metric,
  tone = "",
}: {
  label: string
  value?: string | number | null
  pct: number | null
  metric: MetricKey
  tone?: string
}) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-sm", tone)}>{value}</dd>
      {pct !== null && <SegmentBar pct={pct} metric={metric} className="mt-1.5 h-1.5 max-w-40" />}
    </div>
  )
}

/**
 * Where a shown address came from, as the tooltip. The same four the hub's own
 * panel names, in the same words, so an address that reads "手动填写" there
 * reads the same here.
 */
const SOURCES: Record<AddressSource, string> = {
  manual: "手动填写",
  interface: "网卡地址",
  exit: "hub 看到的出口，不在节点网卡上（NAT 或代理）",
  connection: "hub 看到的连接地址",
}

/**
 * Host name and address, with the address masked until asked for.
 *
 * The hub only sends these to an authenticated caller, so a visitor never
 * reaches this row at all -- but "logged in" is not the same as "may see the
 * address", and the panel is one shared link away from being public. So what
 * prints by default is the prefix: enough to tell which network a machine sits
 * on, which is what being handed a host to triage actually needs.
 *
 * Which address that is comes from `addresses()` rather than from the payload's
 * order, so a node whose operator set an address by hand -- or one behind NAT --
 * is described here the way it is described in the panel it was configured in.
 *
 * The full value is one click away and the click is not remembered -- no
 * localStorage, no URL flag. `key={node.id}` already remounts this per host, so
 * revealing one machine's address cannot carry over to the next one opened.
 *
 * The host name is left in the clear: it is the machine's own name, it is what
 * its logs and its tickets call it, and the panel shows `node.name` to every
 * visitor already.
 */
export function Identity({ node }: { node: Node }) {
  const [shown, setShown] = useState(false)
  const addrs = addresses(node)
  if (!node.hostname && addrs.length === 0) return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">主机 / IP</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
        {node.hostname && <span className="truncate">{node.hostname}</span>}
        {addrs.map(({ address, source }) => (
          <span key={address} title={SOURCES[source]} className="tnum truncate">
            {shown ? address : maskIp(address)}
          </span>
        ))}
        {addrs.length > 0 && (
          <button
            type="button"
            onClick={() => setShown(!shown)}
            aria-pressed={shown}
            title={shown ? "隐藏完整地址" : "显示完整地址"}
            className="shrink-0 rounded text-xs text-muted-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {shown ? "隐藏" : "显示"}
          </button>
        )}
      </dd>
    </div>
  )
}

/** Which host a set of hidden probe ids belongs to. */
export type Hidden = { node: number; ids: number[] }

/**
 * The hidden ids for one host: the same node's, or none at all.
 *
 * Pulled out so the rule has a test. The list is per-host, so ids belonging to
 * another node must read as empty rather than carry over -- a host in Frankfurt
 * reusing probe number 1 that Tokyo hid would otherwise draw an empty chart
 * with a full legend underneath.
 */
export function hiddenFor(hidden: Hidden, nodeId: number): number[] {
  return hidden.node === nodeId ? hidden.ids : []
}

export function NodeDetail({ node, peaks = true, historyDays = null }: { node: Node; peaks?: boolean; historyDays?: number | null }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("resources")
  /*
   * The spans on offer are derived from what the hub keeps, so the only state is
   * the hour count picked per tab.
   *
   * `spanFor` is what keeps the button and the chart agreeing when `historyDays`
   * arrives after the first render, or shrinks underneath a selection: a window
   * the hub is about to clamp is still the honest request to send, and the hub
   * echoes back what it actually answered for, but asking for 30 天 on a hub
   * holding 7 would be a lie in the UI until someone read the footnote.
   *
   * Both lists are memoised because they come out of function calls: the React
   * Compiler can see a call's result is a fresh value but not that it is never
   * mutated, so an unwrapped `rangesFor(...)` in the component body costs the
   * whole component its optimisation -- it gives up and reports
   * `preserve-manual-memoization` against `onZoom` and `metricRows`, two hooks
   * with nothing to do with the range buttons. `useMemo` puts the value back in
   * a form it can reason about.
   */
  const [sel, setSel] = useState({ resources: 6, latency: 6 })
  const options = useMemo(() => rangesFor(historyDays), [historyDays])
  const shown = useMemo(() => rangesOn(options, tab), [options, tab])
  const hours = spanFor(shown, sel[tab])
  const [smooth, setSmooth] = useState(false)
  /*
   * Which probes are hidden, and on which node.
   *
   * One value carrying both, rather than a list cleared by an effect on
   * `node.id`: the ids are per-node, so hiding probe 1 on a host in Tokyo could
   * blank the only line on a host in Frankfurt that happens to reuse the number
   * -- and the chart looked simply empty while the legend underneath still
   * listed everything. Deriving the list during render clears it for a new node
   * in one pass, which an effect cannot: it would setState to get there.
   */
  const [hidden, setHidden] = useState<Hidden>({ node: node.id, ids: [] })
  const toggleProbe = useCallback(
    (id: number) =>
      setHidden((h) => {
        const ids = hiddenFor(h, node.id)
        return { node: node.id, ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] }
      }),
    [node.id],
  )
  const [chartTop, setChartTop] = useState(0)

  // Keyed rather than cleared. A result is tagged with the query it answers, so
  // a reply for the previous range can never render under the new one, and
  // switching tabs needs no state reset in an effect -- the tag simply stops
  // matching and the skeleton shows until the new reply lands.
  const [result, setResult] = useState<Result | null>(null)
  const [zoomState, setZoomState] = useState<{ key: string; range: [number, number] | null } | null>(null)

  const key = `${node.id}:${hours}:${tab}`
  const data = result?.key === key ? result.payload : null
  const failed = result?.key === key ? result.error : ""
  const zoom = zoomState?.key === key ? zoomState.range : null
  const onZoom = useCallback(
    (range: [number, number] | null) => setZoomState({ key, range }),
    [key],
  )

  const root = useRef<HTMLDivElement>(null)
  const chartBox = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  // Reaching this component at all means the split chunk loaded, so the guard
  // against a reload loop can be cleared and the next update may reload again.
  useEffect(() => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY)
  }, [])

  /*
   * The heading takes focus on the way in.
   *
   * Opening a node unmounts the card that was clicked, so the focused element
   * disappears with it and a screen reader is left with nothing to announce --
   * this is a pushState, not a navigation it can report on its own. `preventScroll`
   * because the route has already scrolled to the top and focus should not fight
   * it. The way back is handled by the list, which focuses the card it came from.
   */
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    let active = true

    // Counting in device pixels used to ask the hub for 5000-odd points on a
    // 2560-wide 2x display, for a chart about 1200 CSS px across. 1.5x the
    // container is enough supersampling for any of these series.
    const width = root.current?.clientWidth || globalThis.innerWidth
    const points = Math.min(1500, Math.max(300, Math.round(width * 1.5)))
    const series = tab === "latency" ? "ping" : "metrics"
    api<Payload>(`/nodes/${node.id}/metrics?hours=${hours}&points=${points}&series=${series}`)
      .then((next) => { if (active) setResult({ key, payload: next, error: "" }) })
      .catch((e: Error) => {
        if (active) {
          setResult({ key, payload: { metrics: [], ping: [], probes: {} }, error: friendly(e) })
        }
      })
    return () => { active = false }
  }, [key, node.id, hours, tab])

  // Measured once per layout rather than from a ref callback, which is invoked
  // with a fresh function on every render and so re-measured -- and re-wrote the
  // height, forcing synchronous layout -- every two seconds.
  useLayoutEffect(() => {
    const el = chartBox.current
    if (!el) {
      setChartTop(0)
      return
    }
    const measure = () => setChartTop(Math.round(el.getBoundingClientRect().top + scrollY))
    measure()
    // Observing the body rather than the box: the box's size is what this sets,
    // so watching it would feed itself. A window resize or a taller page still
    // moves the box, and both show up on the body.
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [tab, data, node.id])

  const m = node.metrics
  const pingSeries = useMemo(
    () =>
      [...new Set((data?.ping ?? []).map((p) => p.task_id))]
        .map((id) => {
          const points = (data?.ping ?? []).filter((p) => p.task_id === id)
          const loss = data?.loss?.[id] ?? 0
          return { id, name: data?.probes?.[id] ?? `探测 ${id}`, points, loss }
        })
        .filter((s) => s.points.length > 0),
    [data],
  )

  const baseRows = useMemo(() => {
    const rows: Point[] = []
    for (const raw of data?.metrics ?? []) {
      if (typeof raw.ts !== "number" || !Number.isFinite(raw.ts)) continue
      rows.push({
        ts: raw.ts * 1_000,
        cpu: num(raw.cpu),
        mem_used: num(raw.mem_used),
        disk_used: num(raw.disk_used),
        net_rx: num(raw.net_rx),
        net_tx: num(raw.net_tx),
        // A peak below its own mean is impossible for rows the hub filled in, but
        // older hubs omit the field entirely and a malformed one could send
        // anything. Falling back to the mean keeps the peak line off the chart
        // rather than under it, and matches the hub's own rule that a row without
        // a recorded peak counts as its own mean.
        net_rx_max: peak(raw.net_rx_max, num(raw.net_rx)),
        net_tx_max: peak(raw.net_tx_max, num(raw.net_tx)),
        // The CPU peak arrived one hub version later than the rate peaks and is
        // read the same way, floored at the mean so the line never sits under the
        // average it belongs above.
        cpu_max: peak(raw.cpu_max, num(raw.cpu)),
        // How many minute rows the bucket folded in, for the coverage note below.
        // Kept null rather than zeroed the way `num` does it: absent means a hub
        // too old to report coverage, which is not the same reading as a bucket
        // that is genuinely short.
        minutes: count(raw.minutes),
      })
    }
    return rows.sort((a, b) => a.ts - b.ts)
  }, [data])

  const metricRows = useMemo(() => {
    const snapshot = node.metrics
    if (!snapshot || baseRows.length === 0) return baseRows
    if (
      snapshot.cpu === null || snapshot.mem_used === null || snapshot.disk_used === null ||
      snapshot.net_rx === null || snapshot.net_tx === null
    ) return baseRows

    // Append the sample that just arrived over the socket, so the chart moves
    // with the cards behind it instead of freezing at the last fetch. Spaced to
    // the window's own cadence: tacking a point on every 2 s would squeeze the
    // tail of a 7-day series into a single pixel.
    const slot = (hours * 3_600_000) / 120
    const last = baseRows[baseRows.length - 1]
    const at = Math.max(Date.now(), last.ts + 1_000)
    if (at - last.ts < slot) return baseRows
    return [...baseRows, {
      ts: at,
      cpu: snapshot.cpu,
      mem_used: snapshot.mem_used,
      disk_used: snapshot.disk_used,
      net_rx: snapshot.net_rx,
      net_tx: snapshot.net_tx,
      // The socket frame is one instant, not a minute's worth of samples, so its
      // own rate is its peak. `metrics()` on the public node exposes only the
      // instantaneous fields, which is exactly what the card above already shows.
      net_rx_max: snapshot.net_rx,
      net_tx_max: snapshot.net_tx,
      // Same reasoning for CPU: one instant, so the instantaneous reading is its
      // own peak. Null coverage, because a single frame covers no span at all and
      // claiming otherwise would make the note below count a fabricated gap.
      cpu_max: snapshot.cpu,
      minutes: null,
    }]
  }, [baseRows, node.metrics, hours])

  const tops = useMemo(() => {
    const max = (pick: (m: Point) => number) => metricRows.reduce((hi, row) => Math.max(hi, pick(row)), 0)
    return {
      /*
       * Each axis has to clear the peaks, not just the means: a test that hit
       * 90 MB/s inside a minute averages down to a few MB/s, and a CPU spike
       * inside a bucket vanishes into it just as thoroughly. Scaling to the mean
       * alone would clip the very spike the peak line exists to show.
       */
      cpu: axisTop(max((row) => Math.max(row.cpu, row.cpu_max ?? 0)), 4, 10, 100),
      rate: axisTop(
        max((row) => Math.max(row.net_rx, row.net_tx, row.net_rx_max ?? 0, row.net_tx_max ?? 0)),
        1024,
        1024,
      ),
    }
  }, [metricRows])

  /*
   * Whether this window carries any peak at all. Derived from the rows rather
   * than from a version check: the fields arrived with hub v1.3.1 but are per-row,
   * so a window spanning the upgrade holds both kinds, and the honest question is
   * whether anything to draw is present -- not which hub answered.
   *
   * The theme setting gates it as well, so someone who finds the dashed pair
   * noisy can turn it off without the chart losing its axis headroom.
   */
  const hasPeak = useMemo(
    () => peaks && metricRows.some((row) => row.net_rx_max !== null || row.net_tx_max !== null),
    [metricRows, peaks],
  )

  /*
   * The same question for CPU, kept as its own answer because the two arrived in
   * different hub versions: v1.3.1 reports the rate peaks and no CPU peak, and a
   * window can straddle the upgrade and hold rows of both kinds.
   */
  const hasCpuPeak = useMemo(
    () => peaks && metricRows.some((row) => row.cpu_max !== null),
    [metricRows, peaks],
  )

  /*
   * The window the hub actually sent.
   *
   * `hours` is echoed in the payload because the request is clamped server-side
   * to the hub's retention, so 30 天 can come back as a week. Unsaid, the button
   * would read 30 天 over a chart holding 7, and the axis would draw the missing
   * three weeks as flat silence.
   */
  const actualHours =
    typeof data?.hours === "number" && Number.isFinite(data.hours) && data.hours > 0 ? data.hours : null

  /*
   * Whether any bucket in the middle of the window covers less than its span.
   *
   * `minutes` says how many minute rows a bucket actually folded in and `step`
   * how many it would hold had the node reported throughout, so a bucket below
   * the full count is one the node went quiet inside. Both ends are dropped, and
   * for different reasons: the last bucket is the one still filling, and it is
   * short on every hub that has ever reported; the first is cut by the retention
   * window, which starts mid-bucket because the query begins at now - hours*3600
   * rather than on a bucket boundary. Neither is the node going quiet, so only
   * the middle can say anything.
   *
   * A hub before v1.3.2 sends neither field, and then there is nothing to say.
   */
  const coverage = useMemo(() => {
    const step = typeof data?.step === "number" && Number.isFinite(data.step) && data.step > 0 ? data.step : null
    if (step === null || baseRows.length < 3) return null
    const full = step / 60
    const middle = baseRows.slice(1, -1)
    const shortBuckets = middle.filter((row) => row.minutes !== null && row.minutes < full).length
    if (shortBuckets === 0) return null
    return {
      shortBuckets,
      total: middle.length,
      span: full >= 60 ? `${Math.round(full / 60)} 小时` : `${full} 分钟`,
    }
  }, [data, baseRows])

  const shownProbes = useMemo(
    // Read off `hidden` rather than the derived list: the derived list is a
    // fresh array whenever the node it describes is not the current one, and a
    // dependency that changes every render is no memoisation at all.
    () => pingSeries.filter((s) => !hiddenFor(hidden, node.id).includes(s.id)),
    [pingSeries, hidden, node.id],
  )

  const pingRows = useMemo(() => {
    const rows = new Map<
      number,
      { ts: number } & Record<string, number | [number, number] | null>
    >()
    for (const s of pingSeries) {
      const smoothed = despike(s.points)
      s.points.forEach((p, i) => {
        const row = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i].latency
        row[`l${s.id}`] = p.loss ?? 0
        row[`b${s.id}`] = p.band ?? null
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries])

  /*
   * The card's three readings, in the card's format and the card's colours.
   *
   * This page has the most room of anything in the panel for a value and was
   * the only place printing one in grey: a CPU at 95% was red on its card and
   * uncoloured once opened, which reads as "the detail page disagrees". Same
   * `pc()`, same thresholds -- `toneFor` is the one the cards use.
   */
  const cpuPct = m?.cpu ?? null
  const memPct = percent(m?.mem_used ?? null, m?.mem_total ?? null)
  const diskPct = percent(m?.disk_used ?? null, m?.disk_total ?? null)
  // Core-relative, so the meter matches the card's instead of drawing a load of
  // 0.04 as 4% on a sixteen-core box.
  const loadPct = loadPercent(node)

  return (
    <div ref={root} className="animate-rise space-y-4">
      {/* min-w-0, or a long hostname takes the status and the agent badge off
          the right edge of the viewport instead of giving ground: a flex child
          without it refuses to shrink below its content.
          The title carries the name in full, since truncation here would
          otherwise be the only copy of it on the page. */}
      <div className="flex min-w-0 items-center gap-2">
        {/* Focusable so the route change has somewhere to land; see the effect above. */}
        <h2
          ref={heading}
          tabIndex={-1}
          title={node.name}
          dir="auto"
          className="min-w-0 truncate text-lg font-medium outline-none"
        >
          {node.name}
        </h2>
        <Country node={node} />
        <Status node={node} />
        {node.agent_version && (
          <Badge variant="outline" className="font-normal">
            agent {node.agent_version}
          </Badge>
        )}
      </div>

      {/*
       * Two groups: what the machine is doing, then what it is.
       *
       * This list used to be all specification -- seven rows describing the
       * hardware and not one saying whether it was on fire. The page with the
       * most room for a reading was the only place in the panel that carried
       * none, so the card that opened it had already said more than the page it
       * opened. The three figures from that card come first, with uptime and
       * today's traffic; what the machine is follows beneath.
       */}
      <div className="space-y-3">
        <section aria-labelledby="detail-now">
          <h3 id="detail-now" className="mb-2 text-[11px] text-muted-foreground">现状</h3>
          <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
            <Fact label="在线" value={m?.uptime ? uptime(m.uptime) : "—"} />
            <MeteredFact label="CPU" metric="cpu" pct={cpuPct} tone={toneFor(cpuPct)} value={pc(cpuPct)} />
            <MeteredFact
              label="内存"
              metric="mem"
              pct={memPct}
              tone={toneFor(memPct)}
              value={
                m?.mem_total
                  ? `${bytes(m.mem_used ?? 0)} / ${bytes(m.mem_total)}${memPct === null ? "" : `（${pc(memPct)}）`}`
                  : "—"
              }
            />
            <MeteredFact
              label="硬盘"
              metric="disk"
              pct={diskPct}
              tone={toneFor(diskPct)}
              value={
                m?.disk_total
                  ? `${bytes(m.disk_used ?? 0)} / ${bytes(m.disk_total)}${diskPct === null ? "" : `（${pc(diskPct)}）`}`
                  : "—"
              }
            />
            {/*
              * The two figures the card can only hint at. `load` is a one-minute
              * average and needs the core count beside it to be read, which is
              * the CPU row above. The meter uses the core-relative saturation,
              * not the raw average, so it cannot disagree with the card's.
              */}
            <MeteredFact
              label="负载"
              metric="load"
              pct={loadPct}
              tone={toneFor(loadPct)}
              value={
                m?.load
                  ? `${m.load.map((v) => v.toFixed(2)).join(" ")}${node.cpu_cores > 0 ? ` / ${node.cpu_cores} 核` : ""}`
                  : ""
              }
            />
            <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
          </dl>
        </section>

        {/*
          Traffic and billing. The card can only show a percentage, so this is
          the only place the actual byte counts and quota mechanics are legible.
        */}
        <section aria-labelledby="detail-traffic">
          <h3 id="detail-traffic" className="mb-2 text-[11px] text-muted-foreground">流量 · 计费</h3>
          <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
            <Fact
              label="本月用量"
              value={
                node.traffic_limit > 0
                  ? `${bytes(monthUsage(node))} / ${bytes(node.traffic_limit)}`
                  : `${bytes(monthUsage(node))} / ${FOREVER}`
              }
            />
            {node.traffic_reset_day > 0 && (
              <Fact label="重置日" value={`每月 ${node.traffic_reset_day} 日重置`} />
            )}
            {node.traffic_mode && node.traffic_mode !== "sum" && (
              <Fact
                label="计费方向"
                value={{ up: "上行", down: "下行", max: "较大值" }[node.traffic_mode] ?? node.traffic_mode}
              />
            )}
            <Fact label="累计流量" value={`↓ ${bytes(node.total_rx)} · ↑ ${bytes(node.total_tx)}`} />
            {m?.tcp != null && m.udp != null && (
              <Fact label="连接" value={`TCP ${m.tcp} · UDP ${m.udp}`} />
            )}
            {m?.procs != null && <Fact label="进程" value={`${m.procs}`} />}
            {m?.swap_total ? (
              <Fact label="交换" value={`${bytes(m.swap_used ?? 0)} / ${bytes(m.swap_total)}`} />
            ) : null}
          </dl>
        </section>

        <section aria-labelledby="detail-spec">
          <h3 id="detail-spec" className="mb-2 text-[11px] text-muted-foreground">配置</h3>
          <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
            <Identity node={node} />
            <Fact label="系统" value={[osName(node.os), node.kernel].filter(Boolean).join(" · ")} />
            <Fact
              label="CPU"
              value={
                node.cpu_cores > 0
                  ? node.cpu_name
                    ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}`
                    : `${node.cpu_cores} 核`
                  : "—"
              }
            />
            <Fact
              label="内存 / 硬盘"
              value={
                node.mem_total > 0 || node.disk_total > 0
                  ? `${bytes(node.mem_total)} / ${bytes(node.disk_total)}`
                  : "—"
              }
            />
            <Fact
              label="架构"
              value={[node.arch, node.virt !== "none" ? node.virt : ""]
                .filter(Boolean)
                .join(" · ")}
            />
            <Fact
              label="续费"
              value={[
                node.price > 0
                  ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}`
                  : "免费",
                node.expires_at ? `${node.expires_at} 到期` : FOREVER,
              ].join(" · ")}
            />
          </dl>
        </section>
      </div>

      {/*
        Two remarks, and they are not the same thing. The public one is new in
        hub v1.3.2 and is served to anonymous visitors, so it is the operator
        speaking to whoever is looking; the admin one only reaches an
        authenticated request. Labelled rather than merged, because a node can
        carry both and the difference is who wrote it for whom.
      */}
      {node.public_remark && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{node.public_remark}</p>
      )}

      {node.remark && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
          <span className="mr-2 text-xs text-muted-foreground">管理备注</span>
          {node.remark}
        </p>
      )}

      <div className="space-y-2 border-t pt-4">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex gap-1">
            {shown.map((r) => (
              <Tab
                key={r.hours}
                active={hours === r.hours}
                onClick={() => setSel((all) => ({ ...all, [tab]: r.hours }))}
              >
                {r.label}
              </Tab>
            ))}
          </div>
          {/*
            The hub clamps the request to its own retention, so a window wider
            than what it keeps comes back shorter. Said out loud, because
            otherwise the lit button claims 30 天 over a chart holding 7.
          */}
          {actualHours !== null && actualHours < hours && (
            <p className="text-xs text-muted-foreground">
              主控只提供了 {actualHours >= 48 ? `${Math.round(actualHours / 24)} 天` : `${actualHours} 小时`}的历史
            </p>
          )}
          {tab === "latency" && (
            <>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={smooth}
                  onChange={(e) => setSmooth(e.target.checked)}
                  className="accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                />
                削峰
              </label>
              {/*
                The only way out of a zoom. The brush has no reset of its own,
                so a window dragged by accident -- easy to do, since the same
                gesture that pans the page moves the traveller -- left the chart
                on a slice of the day with no visible way back.
              */}
              {zoom && (
                <button
                  onClick={() => setZoomState({ key, range: null })}
                  className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  重置缩放
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : failed ? (
        <p className="py-8 text-center text-sm text-destructive" role="alert">读取历史数据失败：{failed}</p>
      ) : tab === "latency" ? (
        pingSeries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有延迟数据</p>
        ) : pingSeries.every((s) => s.points.every((p) => p.latency === null)) ? (
          /*
           * Probes ran and every one of them timed out. Distinct from having no
           * data at all: the host was unreachable for the whole window, which is
           * a finding, and it was previously drawn as an empty chart that looked
           * like a failed request.
           */
          <p className="py-8 text-center text-sm text-warn">这段时间所有探测都超时</p>
        ) : (
          <LatencyChart
            pingSeries={pingSeries}
            pingRows={pingRows}
            shownProbes={shownProbes}
            smooth={smooth}
            hours={hours}
            zoom={zoom}
            chartBox={chartBox}
            chartTop={chartTop}
            hidden={hidden}
            nodeId={node.id}
            onZoom={onZoom}
            onToggle={toggleProbe}
          />
        )
      ) : data.metrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有历史数据</p>
      ) : metricRows.length < 2 ? (
        /*
         * A line needs two points, and the series are drawn without dots, so a
         * single sample produced a pair of axes around nothing: a chart that
         * looks broken rather than one that says it has nothing to draw yet.
         * This is the normal state of a node added minutes ago.
         */
        <p className="py-8 text-center text-sm text-muted-foreground">
          只有 {metricRows.length} 个采样点，暂时画不出曲线。过几分钟再看。
        </p>
      ) : (
        <div className="space-y-5">
          <CpuPanel rows={metricRows} top={tops.cpu} hours={hours} hasPeak={hasCpuPeak} />
          <MemoryPanel rows={metricRows} total={node.mem_total} hours={hours} />
          <RatePanel rows={metricRows} top={tops.rate} hours={hours} hasPeak={hasPeak} />
          <DiskPanel rows={metricRows} total={node.disk_total} hours={hours} />
          {coverage && (
            <p className="text-xs text-muted-foreground">
              每点覆盖 {coverage.span}，其中 {coverage.shortBuckets} / {coverage.total} 个采样点未覆盖满：
              节点在这段时间里没有持续上报，曲线画出的只是它报了的那部分。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
