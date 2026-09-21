import { memo, type MouseEvent } from "react"
import { ArrowDown, ArrowLeftRight, ArrowUp, Clock3, Gauge } from "lucide-react"

import { Flag, hasFlag } from "@/components/Flag"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { bytes, daysUntil, daysToReset, FOREVER, pair, pc, percent, rate, SOON_DAYS, uptime } from "@/lib/format"
import {
  alertLevel, health, loadPercent, monthUsage, railLevel, stale, swapPercent, type Health,
} from "@/lib/node"
import { LOSS_DANGER, LOSS_WARN, type Quality } from "@/lib/quality"
import { severity, TONE_EDGE, TONE_TEXT, toneFor } from "@/lib/severity"
import { cn } from "@/lib/utils"

/*
 * A one-hour CPU trend, drawn by hand rather than with recharts: fifty cards
 * each carrying a ResponsiveContainer would pay a layout observer and a chart
 * tree for a line that only has to say "flat vs spiky". Pure SVG, no animation,
 * neutral grey -- the alert colour already lives in the number above it, and a
 * 20px line that also changes colour is noise. Fewer than two points render
 * nothing, matching the detail page's "a line needs two points" rule.
 */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const W = 60
  const H = 20
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W
      const y = H - 2 - (Math.min(Math.max(v, 0), 100) / 100) * (H - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="var(--color-muted-2)"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={W}
        cy={H - 2 - (Math.min(Math.max(values[values.length - 1], 0), 100) / 100) * (H - 4)}
        r={1.5}
        fill="var(--color-muted-2)"
      />
    </svg>
  )
}

/**
 * Traffic is the one number whose reset date changes what it means: 400 GB on
 * the 3rd of the month is not the same reading as 400 GB the day before it
 * rolls over. Only shown as it approaches, so an ordinary card stays quiet.
 */
function ResetSoon({ node }: { node: Node }) {
  if (node.traffic_limit <= 0) return null
  const days = daysToReset(node.traffic_reset_day)
  if (days === null || days > SOON_DAYS) return null
  return <span className="inline-flex items-center gap-1 tnum shrink-0 text-warn">
    <Clock3 className="size-3 shrink-0 opacity-70" aria-hidden />
    {days === 0 ? "今天重置" : `${days} 天后重置`}
  </span>
}

const DOT: Record<Health, string> = {
  ok: "bg-ok",
  /*
   * Neutral, not amber. "Connected, waiting for its first sample" is not a
   * resource alert, and drawing it in the amber that means "over 80%" made two
   * unrelated states read as the same one.
   */
  pending: "bg-muted-foreground",
  invalid: "bg-destructive",
  offline: "bg-destructive",
  unconnected: "bg-muted-foreground",
}

export function Status({ node }: { node: Node }) {
  const state = health(node)
  const down = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const up = node.metrics?.uptime
  /*
   * A reading that stopped arriving. `online` is the hub's flag and it lags, so
   * the state can read "ok" while the numbers have been frozen for minutes --
   * the panel would be showing a healthy-looking card built from history.
   * Checked only for the two states that claim to be current: on an offline
   * node, `last_seen` is the time it went away, which is already the message.
   */
  const aged = state === "ok" || state === "pending" ? stale(node) : null
  /*
   * One card, one verdict.
   *
   * A host sitting at 95% CPU used to draw a red rail on its left edge and a
   * green dot at the end of its status line -- two answers to "is this node
   * fine", given at the same volume. The rail is the alert; the dot means the
   * agent is reporting, which a node can be doing perfectly while being on
   * fire. So the dot steps back to neutral whenever the rail is up: green now
   * reads as "nothing is wrong", not as "something is connected".
   */
  const alerting = state === "ok" && alertLevel(node) !== "normal"
  const label = aged !== null
    ? `数据陈旧 ${uptime(aged)}`
    : {
        ok: up ? `在线 ${uptime(up)}` : "在线",
        // "已连接"说的是面板自己的链路，不是机器的：hub 收到了这台 agent，
        // 只等它的第一个样本。用「接入」与「未接入」同一族词，三种状态
        // 不再各说各话。
        pending: "已接入 · 等待数据",
        // 与概览条同一个词。这台机器报上来的数读不出来，它连着、也不是没
        // 数据，说「不可用」像没连上，说「异常」才对得上概览条那句。
        invalid: "数据异常",
        offline: down >= 60 ? `离线 ${uptime(down)}` : "离线",
        unconnected: "未接入",
      }[state]

  return (
    <span
      className={cn(
        "tnum inline-flex shrink-0 items-center gap-1.5 text-xs",
        (state === "offline" || state === "unconnected") && "text-muted-foreground",
        state === "invalid" && "text-destructive",
        aged !== null && "text-warn",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "status-dot size-1.5 rounded-full",
          aged !== null ? "bg-warn" : alerting ? "bg-muted-foreground" : DOT[state],
        )}
      />
      {label}
    </span>
  )
}

/**
 * The country, as a flag.
 *
 * The two letters were doing three jobs at once -- region, filter key and a
 * column of identical-looking boxes down the grid. The flag says the same thing
 * faster, and the node's name already spells the country out beside it. Codes
 * with no artwork (中国台湾, and anything outside the sprite) keep the badge, so a
 * missing flag never turns into a missing row.
 */
export function Country({ node }: { node: Node }) {
  const code = node.country?.trim().toUpperCase()
  if (!code) return null
  if (!hasFlag(code)) {
    return (
      <Badge variant="secondary" className="shrink-0 rounded px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
        {code}
      </Badge>
    )
  }
  return (
    <span className="shrink-0" title={code}>
      <Flag code={code} />
      <span className="sr-only">{code}</span>
    </span>
  )
}

function trafficFoot(node: Node) {
  return node.traffic_limit > 0
    ? pair(monthUsage(node), node.traffic_limit)
    : `${bytes(monthUsage(node))} / ${FOREVER}`
}

/**
 * Unlimited plans have no ratio to read, so they never take a warning tone.
 * An ordinary month keeps the footnote's own grey -- colouring every ordinary
 * value would put the footnote back in competition with the numbers above it.
 */
function trafficTone(node: Node) {
  if (node.traffic_limit <= 0) return ""
  const level = severity(percent(monthUsage(node), node.traffic_limit))
  return level === "normal" ? "" : TONE_TEXT[level]
}

/**
 * 本月用量对配额的满宽细条。
 *
 * 卡片重排时撤掉过一条流量条；这里请回来的是更安静、且只在有意义处出现的
 * 那种——有套餐配额的卡才有"快用完了"可画，无限套餐没有分母，138 GB / ∞
 * 保持一行文字。填充与三大读数同一梯队，精确数字仍由下方的脚注给出。
 */
function MonthRail({ node, dim }: { node: Node; dim: boolean }) {
  // `> 0` 而不是 `<= 0` 取反前的写法：undefined 的比较两种都为 false，
  // `<= 0` 挡不住缺字段，会画出一条 NaN 宽度的条；`> 0` 与 trafficFoot
  // 的判法一致，缺字段一律按无限套餐处理。
  if (!(node.traffic_limit > 0)) return null
  const pct = percent(monthUsage(node), node.traffic_limit)
  const width = pct === null ? 0 : Math.max(0, Math.min(pct, 100))
  const fill = dim
    ? "bg-muted-foreground/30"
    : severity(pct) === "danger" ? "bg-destructive" : severity(pct) === "warn" ? "bg-warn" : "bg-muted-foreground/70"
  return (
    <div className="mb-1.5 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className={cn("h-full rounded-full", fill)} style={{ width: `${width}%` }} />
    </div>
  )
}

function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null) return <span className="tnum shrink-0" title="永不到期">{FOREVER}</span>
  const tone = days < 0 ? "text-destructive" : days <= SOON_DAYS ? "text-warn" : ""
  // "12 days" cannot tell you which batch to top up; the date can, and keeping
  // it in the tooltip costs no width in a column that is already tight.
  return (
    <span className={cn("inline-flex items-center gap-1 tnum shrink-0", tone)} title={`${node.expires_at} 到期`}>
      <Clock3 className="size-3 shrink-0 opacity-70" aria-hidden />
      {days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今天到期" : `${days} 天后到期`}
    </span>
  )
}

/**
 * One number, one label.
 *
 * The card used to draw four meters, each with a label, a percentage, an ~85px
 * track and a foot line, plus a four-cell network row: twenty-odd pieces of text
 * and sixteen bars per screen, in bars too short to compare 80% against 90%.
 * Three numbers at 20px are read at a glance and take a third of the height.
 * Colour stays reserved for the two thresholds that mean something; a node whose
 * readings are stale or missing is dimmed instead, so it cannot be mistaken for
 * a live one.
 */
function Reading({ label, pct, dim, sub }: { label: string; pct: number | null; dim: boolean; sub?: string }) {
  const width = pct === null ? 0 : Math.max(0, Math.min(pct, 100))
  const fill = dim
    ? "bg-muted-foreground/30"
    : severity(pct) === "danger" ? "bg-destructive" : severity(pct) === "warn" ? "bg-warn" : "bg-muted-foreground/70"
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "tnum mt-0.5 truncate text-xl font-semibold",
          dim ? "text-muted-foreground" : toneFor(pct),
        )}
      >
        {pc(pct)}
      </div>
      {/*
       * The magnitude the percentage cannot say: 55% of 4 GB and 55% of 64 GB
       * are the same column here. Drawn quieter than the reading it qualifies
       * and only when there is a real figure -- an unreadable or stale node
       * shows nothing beneath the dashes rather than a guessed capacity.
       */}
      {sub && <div className="tnum truncate text-[10px] leading-tight text-muted-2">{sub}</div>}
      {/*
       * A thin meter under every reading. It is not the primary signal -- the
       * coloured number above it is -- but it gives the row a texture the plain
       * text grid lacked and lets the eye compare "almost full" against "barely
       * used" in one sweep. Drawn at 2px so a 90%-full card does not outshout
       * the 80% threshold above it.
       */}
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn("h-full rounded-full", fill)} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

/**
 * A half-height rail for the context figures the big grid cannot hold.
 *
 * 负载和交换 live on a text-[11px] line where a full 4px meter would shout, so
 * these run at 2px and a 56px track -- long enough to read "empty vs nearly
 * full" at a glance, short enough that the line stays a footnote. Same fill
 * ladder as the readings above, one step quieter at normal: a healthy reading
 * is grey, a saturated one still turns amber or red.
 */
function MiniRail({ pct, dim }: { pct: number | null; dim: boolean }) {
  const width = pct === null ? 0 : Math.max(0, Math.min(pct, 100))
  const fill = dim
    ? "bg-muted-foreground/30"
    : severity(pct) === "danger" ? "bg-destructive" : severity(pct) === "warn" ? "bg-warn" : "bg-muted-foreground/40"
  return (
    <span aria-hidden className="h-0.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
      <span className={cn("block h-full rounded-full", fill)} style={{ width: `${width}%` }} />
    </span>
  )
}

/**
 * What the three big numbers cannot say on their own.
 *
 * A CPU percentage is a two-second window. A host pinned at twenty times its
 * core count reads as quiet if the sample lands between scheduler stalls, and a
 * box thrashing its swap looks like any other -- both figures were already in
 * the payload and neither could reach a threshold, so a broken machine drew
 * three grey numbers and a green dot. Stated here as context rather than as
 * three more alerts: they take a warning tone past the same thresholds, and
 * otherwise stay in the footnote's grey.
 */
function ContextLine({ node, dim }: { node: Node; dim: boolean }) {
  const load = node.metrics?.load?.[0] ?? null
  const swap = swapPercent(node)
  if (load === null && swap === null) return null
  // Only a reading past a threshold is coloured. Painting the ordinary ones in
  // `TONE_TEXT.normal` -- which is the foreground -- made them the darkest text
  // in the card, louder than the three numbers above them: an idle machine's
  // "负载 0.40" is context, and context is what this line's grey already says.
  // The rail carries the same ladder at half height, so saturation is visible
  // as a length before it ever needs to be a colour.
  const tone = (pct: number | null) => (dim || severity(pct) === "normal" ? "" : toneFor(pct))
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-2">
      {load !== null && (
        <span className={cn("inline-flex items-center gap-1 tnum", tone(loadPercent(node)))}>
          <Gauge className="size-3 shrink-0 opacity-70" aria-hidden />
          负载 {load.toFixed(2)}
          <MiniRail pct={loadPercent(node)} dim={dim} />
        </span>
      )}
      {swap !== null && (
        <span className={cn("inline-flex items-center gap-1 tnum", tone(swap))}>
          <ArrowLeftRight className="size-3 shrink-0 opacity-70" aria-hidden />
          交换 {Math.round(swap)}%
          <MiniRail pct={swap} dim={dim} />
        </span>
      )}
    </div>
  )
}

/**
 * What the link is doing right now, rather than what it did this month.
 *
 * The two figures were already arriving on every two-second push -- they ride
 * in `metrics` alongside CPU -- and were being read by nothing except the
 * detail page's chart. So the one question a panel is meant to answer at a
 * glance, "which host is actually moving traffic", cost a click per node to
 * answer, and the monthly total above it cannot distinguish a host peaking now
 * from one that has been idle for a fortnight.
 *
 * Uncoloured on purpose: a rate has no threshold to be past, and giving it the
 * amber of a real alert would put a busy machine next to a broken one.
 */
function RateLine({ node, dim }: { node: Node; dim: boolean }) {
  const m = node.metrics
  const rx = m?.net_rx ?? null
  const tx = m?.net_tx ?? null
  if (rx === null && tx === null) return null
  /*
   * 流量在动的机器亮一档。速率没有阈值，永远不该穿告警色——但"这台现在
   * 有没有在跑流量"是这张卡本来就答得了的问题：非零时整行和箭头比静止的
   * 灰亮一级，零速率保持原来的安静灰。切换只随读数变化，两秒一推不会频闪。
   */
  const active = !dim && ((rx ?? 0) > 0 || (tx ?? 0) > 0)
  return (
    <div className={cn("mt-1 flex flex-wrap items-center gap-x-3 text-[11px]", dim ? "text-muted-foreground" : active ? "text-muted-foreground" : "text-muted-2")}>
      <span className="inline-flex items-center gap-1 tnum">
        <ArrowDown className={cn("size-3 shrink-0", active ? "opacity-90" : "opacity-70")} aria-hidden />
        {rx === null ? "—" : rate(rx)}
      </span>
      <span className="inline-flex items-center gap-1 tnum">
        <ArrowUp className={cn("size-3 shrink-0", active ? "opacity-90" : "opacity-70")} aria-hidden />
        {tx === null ? "—" : rate(tx)}
      </span>
    </div>
  )
}

/**
 * Latency and loss, drawn only while the switch that fetches them is on.
 *
 * Loss is coloured and latency is not. Eighty milliseconds and two hundred are
 * both ordinary on a home line, and colouring them would put the two figures in
 * competition with the thresholds above; a link dropping a fifth of its packets
 * is unusable whatever its median says.
 *
 * `pending` covers the gap between switching the row on and its first reading
 * arriving, which is a second or two of requests going out in batches of six.
 * Without it the switch appears to do nothing at all on the cards that have not
 * been reached yet.
 */
function QualityLine({ quality, pending }: { quality?: Quality; pending: boolean }) {
  if (!quality) {
    return (
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-2">
        <span className="tnum">{pending ? "测量中…" : "延迟 — · 丢包 —"}</span>
      </div>
    )
  }
  const loss = quality.loss
  const tone = loss >= LOSS_DANGER ? "text-destructive" : loss >= LOSS_WARN ? "text-warn" : ""
  return (
    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-2">
      <span className="tnum">延迟 {quality.latency === null ? "—" : `${Math.round(quality.latency)} ms`}</span>
      <span className={cn("tnum", tone)}>丢包 {loss > 0 && loss < 1 ? "<1" : Math.round(loss)}%</span>
    </div>
  )
}

/**
 * Memoised end to end: `safeNodes` hands back the same object while nothing
 * moved, `onOpen` is stable, and a `Quality` entry keeps its identity across
 * publishes -- so on a quiet fleet a push re-renders no card at all, and the
 * search box re-renders only the cards whose text actually matched.
 */
export const NodeCard = memo(function NodeCard({ node, onOpen, list = false, quality, pending = false, cpuSpark }: {
  node: Node
  onOpen: (id: number) => void
  list?: boolean
  quality?: Quality
  pending?: boolean
  cpuSpark?: number[]
}) {
  const m = node.metrics
  const state = health(node)
  const aged = state === "ok" || state === "pending" ? stale(node) : null
  // Anything that is not "online with a fresh sample" shows dimmed numbers: the
  // last reading before an agent went away is worth keeping, but it is history.
  const dim = state !== "ok" || aged !== null
  const level = railLevel(node, state, aged)

  // 普通左键走客户端路由；中键、⌘/Ctrl 点击和右键菜单交给浏览器，
  // 这样新窗口打开和复制链接地址都能用。
  const activate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(node.id)
  }

  // Only a node that has never reported hardware has nothing worth drawing --
  // for it the card states what to do instead of three dashes. Every other state
  // (online, waiting for a first sample, offline, unreadable) has a month's
  // traffic to show, so it keeps the row.
  const body = state === "unconnected" ? (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", list && "flex-1")}>
      还没有接入。在后台生成安装命令并执行一次。
    </p>
  ) : (
    <>
      {/* w-full below sm: a fixed 256px column is wider than the card's own
          inner width on a 320px phone, where overflow-hidden used to clip the
          readings away without saying so. */}
      <div className={cn("min-w-0", list && "w-full sm:w-64 sm:shrink-0")}>
        <div className="grid grid-cols-3 gap-x-4">
          <Reading label="CPU" pct={m?.cpu ?? null} dim={dim} sub={node.cpu_cores > 0 ? `${node.cpu_cores} 核` : undefined} />
          <Reading
            label="内存"
            pct={percent(m?.mem_used ?? null, m?.mem_total ?? null)}
            dim={dim}
            sub={m?.mem_total ? `${bytes(m.mem_used ?? 0)} / ${bytes(m.mem_total)}` : undefined}
          />
          <Reading
            label="硬盘"
            pct={percent(m?.disk_used ?? null, m?.disk_total ?? null)}
            dim={dim}
            sub={m?.disk_total ? `${bytes(m.disk_used ?? 0)} / ${bytes(m.disk_total)}` : undefined}
          />
        </div>
        <ContextLine node={node} dim={dim} />
        <RateLine node={node} dim={dim} />
      </div>

      {/*
       * One line, both ends pinned.
       *
       * This row used to wrap, and that was the bug: a plan whose counter resets
       * in a few days carried a third item, pushed itself onto a second line, and
       * every card beside it in the grid ended up with its footnote at a
       * different height. "6 天后重置" is ten characters and says the same thing
       * without moving anything. The traffic figure is the only part allowed to
       * give ground, hence truncate on it alone.
       */}
      <div className={cn("min-w-0", list && "w-full sm:w-72 sm:shrink-0")}>
        <MonthRail node={node} dim={dim} />
        {/*
         * `text-[11px] text-muted-2`, down from `text-xs text-muted-foreground`.
         * As the louder of the two greys this row ran brighter than the load and
         * swap line it sits under -- the card's quietest information was
         * outshouting the readings it is meant to support.
         */}
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-2">
          <span className="flex min-w-0 items-center gap-2">
            {/*
             * 用量条的精确值在这里：条读"快满没有"，这一行读"用了多少"。超限
             * 是唯一值得上色的情况——500 GB 的套餐用到 515 GB 和 15 GB，条都
             * 顶到头，差别只在这行数字本身。
             */}
            <span className={cn("tnum truncate", trafficTone(node))}>本月 {trafficFoot(node)}</span>
            <ResetSoon node={node} />
          </span>
          <Expiry node={node} />
        </div>
        {(quality || pending) && <QualityLine quality={quality} pending={pending} />}
      </div>
    </>
  )

  return (
    <a
      href={`/node/${node.id}`}
      onClick={activate}
      className="group block min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <Card
        className={cn(
          /*
           * Lift, not tint. The card answers a hover by raising a couple of
           * pixels and gaining the hover shadow rather than repainting itself
           * an accent grey, which used to compete with the two alert colours.
           */
          "relative overflow-hidden transition-[transform,box-shadow,border-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:border-ring group-hover:shadow-card-hover group-active:translate-y-0",
          /*
           * The list view exists to fit more on screen, and on the same padding
           * as the grid it did not: identical card, identical row height, no
           * reason to switch. Tighter padding and a shorter gap buy back the
           * rows; the column widths give ground below sm instead of being
           * clipped.
           */
          list ? "flex-row flex-wrap items-center gap-x-8 gap-y-2 p-4" : "gap-3.5 p-5",
        )}
      >
        {/*
         * The rail. Recolouring four digits was the entire difference between an
         * alerting card and a healthy one, which in a four-column grid of white
         * cards reads as texture rather than as a signal. Same mark the overview
         * strip already uses, so the two agree.
         */}
        {level !== "normal" && (
          <span
            aria-hidden
            className={cn("alert-rail absolute inset-y-4 left-0 w-[3px] rounded-r-full", TONE_EDGE[level])}
          />
        )}
        <div className={cn("flex min-w-0 items-start justify-between gap-3", list && "min-w-56 flex-1 items-center")}>
          <div className="flex min-w-0 items-center gap-1.5">
            {/* `title` and `dir`: a 70-character hostname is truncated to fit the
                column, and without the full value there is no way to read what
                was cut off -- nor to tell which node a search matched on its
                tail. `dir="auto"` keeps an RTL name from throwing its trailing
                punctuation to the front of the line. */}
            <h3 className="truncate text-[15px] font-medium" title={node.name} dir="auto">{node.name}</h3>
            <Country node={node} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* One-hour CPU trend, shown only while the network-quality switch is
                on and a reading has arrived -- it rides the same per-node fetch. */}
            {cpuSpark && <Sparkline values={cpuSpark} />}
            <Status node={node} />
          </div>
        </div>
        {body}
      </Card>
    </a>
  )
})
