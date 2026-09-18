import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Area, AreaChart, Brush, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Country, Status } from "@/components/NodeCard"
import { api, type Node } from "@/lib/api"
import {
  axisBytes, axisTop, bytes, clockFor, quarters, cpuName, CYCLES, FOREVER, money, osName, rate, timeTicks,
} from "@/lib/format"
import { CHUNK_RELOAD_KEY } from "@/lib/reload"
import { despike, type PingPoint } from "@/lib/series"

type Point = { ts: number; cpu: number; mem_used: number; disk_used: number; net_rx: number; net_tx: number }

/** One row of the metrics response before it has been checked. */
type RawPoint = {
  ts?: unknown
  cpu?: unknown
  mem_used?: unknown
  disk_used?: unknown
  net_rx?: unknown
  net_tx?: unknown
}

type Probes = Record<string, string>
type Loss = Record<string, number>
type Payload = { metrics: RawPoint[]; ping: PingPoint[]; probes: Probes; loss?: Loss }

/** One fetch, tagged with the query it answers. */
type Result = { key: string; payload: Payload; error: string }

const RANGES = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 168, label: "7 天" },
]
const RANGES_FOR = { resources: RANGES, latency: RANGES.filter((r) => r.hours <= 24) }

const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }
const SERIES = { dot: false as const, strokeWidth: 1.5, isAnimationActive: false }
const Y_WIDTH = 68

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
]

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const

/** A number safe to plot: NaN, Infinity and negatives all collapse to zero. */
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0)

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
 * variables are theme tokens, so dark mode gets a dark tooltip for free --
 * recharts' own default is an opaque white block in both modes. */
const TOOLTIP = {
  contentStyle: {
    fontSize: 12,
    backgroundColor: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    color: "var(--color-popover-foreground)",
  },
  labelStyle: { color: "var(--color-muted-foreground)" },
  itemStyle: { color: "var(--color-popover-foreground)" },
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
const CpuPanel = memo(function CpuPanel({ rows, top, hours }: { rows: Point[]; top: number; hours: number }) {
  return (
    <Panel title="CPU" ariaLabel="CPU 使用率历史曲线">
      <ResponsiveContainer>
        <AreaChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...timeAxis(rows, hours)} />
          <YAxis domain={[0, top]} ticks={quarters(top)} unit="%" width={Y_WIDTH} {...AXIS} />
          <Tooltip labelFormatter={labelTime} formatter={(v) => [`${Number(v).toFixed(1)}%`, "CPU"]} {...TOOLTIP} />
          <Area dataKey="cpu" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} {...SERIES} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
})

const MemoryPanel = memo(function MemoryPanel({ rows, total, hours }: { rows: Point[]; total: number; hours: number }) {
  const top = Math.max(total, 1)
  return (
    <Panel title={`内存 · ${bytes(total)}`} ariaLabel="内存占用历史曲线">
      <ResponsiveContainer>
        <AreaChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...timeAxis(rows, hours)} />
          <YAxis domain={[0, top]} ticks={quarters(top)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
          <Tooltip labelFormatter={labelTime} formatter={(v) => bytes(Number(v))} {...TOOLTIP} />
          <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.15} {...SERIES} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
})

const RatePanel = memo(function RatePanel({ rows, top, hours }: { rows: Point[]; top: number; hours: number }) {
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
          <Tooltip labelFormatter={labelTime} formatter={(v) => rate(Number(v))} {...TOOLTIP} />
          {/*
            * Not the status green. These used to be drawn in --ok, which is also
            * the colour of the "online" dot: one hue, two meanings, in a palette
            * whose whole point is that colour says alert and nothing else.
            */}
          <Line dataKey="net_rx" name="下行" stroke="var(--color-chart-1)" {...SERIES} />
          <Line dataKey="net_tx" name="上行" stroke="var(--color-chart-4)" {...SERIES} />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  )
})

const DiskPanel = memo(function DiskPanel({ rows, total, hours }: { rows: Point[]; total: number; hours: number }) {
  return (
    <Panel title={`硬盘 · ${bytes(total)}`} ariaLabel="硬盘占用历史曲线">
      <ResponsiveContainer>
        <AreaChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...timeAxis(rows, hours)} />
          <YAxis domain={[0, total]} ticks={quarters(total)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
          <Tooltip labelFormatter={labelTime} formatter={(v) => bytes(Number(v))} {...TOOLTIP} />
          <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.15} {...SERIES} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
})

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  )
}

export function NodeDetail({ node }: { node: Node }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("resources")
  const [ranges, setRanges] = useState({ resources: 6, latency: 6 })
  const hours = ranges[tab]
  const [smooth, setSmooth] = useState(false)
  const [hiddenProbes, setHiddenProbes] = useState<number[]>([])
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
          setResult({ key, payload: { metrics: [], ping: [], probes: {} }, error: e.message || "网络错误" })
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
    }]
  }, [baseRows, node.metrics, hours])

  const tops = useMemo(() => {
    const max = (pick: (m: Point) => number) => metricRows.reduce((hi, row) => Math.max(hi, pick(row)), 0)
    return {
      cpu: axisTop(max((row) => row.cpu), 4, 10, 100),
      rate: axisTop(max((row) => Math.max(row.net_rx, row.net_tx)), 1024, 1024),
    }
  }, [metricRows])

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  const style = (id: number) => PALETTE[pingSeries.findIndex((p) => p.id === id) % PALETTE.length]

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

  return (
    <div ref={root} className="space-y-4">
      <div className="flex items-center gap-2">
        {/* Focusable so the route change has somewhere to land; see the effect above. */}
        <h2 ref={heading} tabIndex={-1} className="truncate text-lg font-medium outline-none">{node.name}</h2>
        <Country node={node} />
        <Status node={node} />
        {node.agent_version && (
          <Badge variant="outline" className="font-normal">
            agent {node.agent_version}
          </Badge>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
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
          value={[node.arch, node.virt !== "none" ? node.virt : "", m?.procs != null ? `${m.procs} 进程` : ""]
            .filter(Boolean)
            .join(" · ")}
        />
        {/*
          * The two figures the card can only hint at. `load` is a one-minute
          * average and needs the core count beside it to be read, which is what
          * the CPU row above supplies; swap says nothing on a container that
          * has none, so it is dropped rather than printed as "0 / 0".
          */}
        <Fact
          label="负载 / 交换"
          value={[
            m?.load ? m.load.map((v) => v.toFixed(2)).join(" ") : "",
            m?.swap_total ? `交换 ${bytes(m.swap_used ?? 0)} / ${bytes(m.swap_total)}` : "",
          ].filter(Boolean).join(" · ")}
        />
        <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
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

      {node.remark && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{node.remark}</p>
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
            {RANGES_FOR[tab].map((r) => (
              <Tab
                key={r.hours}
                active={hours === r.hours}
                onClick={() => setRanges((all) => ({ ...all, [tab]: r.hours }))}
              >
                {r.label}
              </Tab>
            ))}
          </div>
          {tab === "latency" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={smooth}
                onChange={(e) => setSmooth(e.target.checked)}
                className="accent-foreground"
              />
              削峰
            </label>
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
        ) : (
          <div
            ref={chartBox}
            style={chartTop ? { height: `calc(100svh - ${chartTop}px - 1rem)` } : undefined}
            className="flex min-h-72 flex-col gap-3">
            <div className="min-h-0 w-full flex-1 text-muted-foreground" role="img" aria-label="各探测点网络延迟历史曲线">
              {shownProbes.length === 0 ? (
                <p className="py-8 text-center text-sm">没有选中任何探测</p>
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
                      {...TOOLTIP}
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
                        {...SERIES}
                        connectNulls
                      />
                    ))}
                    <Brush
                      dataKey="ts"
                      height={22}
                      travellerWidth={8}
                      tickFormatter={clockFor(hours)}
                      className="fill-muted"
                      stroke="var(--color-muted-foreground)"
                      onChange={(r) => setZoomState({ key, range: [r.startIndex ?? 0, r.endIndex ?? pingRows.length - 1] })}
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
                    onClick={() =>
                      setHiddenProbes((h) => (shown ? [...h, s.id] : h.filter((id) => id !== s.id)))
                    }
                    aria-pressed={shown}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-opacity ${
                      shown ? "" : "opacity-40"
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
      ) : data.metrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有历史数据</p>
      ) : (
        <div className="space-y-5">
          <CpuPanel rows={metricRows} top={tops.cpu} hours={hours} />
          <MemoryPanel rows={metricRows} total={node.mem_total} hours={hours} />
          <RatePanel rows={metricRows} top={tops.rate} hours={hours} />
          <DiskPanel rows={metricRows} total={node.disk_total} hours={hours} />
        </div>
      )}
    </div>
  )
}
