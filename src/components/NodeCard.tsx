import { memo, type MouseEvent } from "react"

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

/**
 * Traffic is the one number whose reset date changes what it means: 400 GB on
 * the 3rd of the month is not the same reading as 400 GB the day before it
 * rolls over. Only shown as it approaches, so an ordinary card stays quiet.
 */
function ResetSoon({ node }: { node: Node }) {
  if (node.traffic_limit <= 0) return null
  const days = daysToReset(node.traffic_reset_day)
  if (days === null || days > SOON_DAYS) return null
  return <span className="tnum shrink-0 text-warn">{days === 0 ? "今天重置" : `${days} 天后重置`}</span>
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
        className={cn(
          "size-1.5 rounded-full",
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

function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null) return <span className="tnum shrink-0" title="永不到期">{FOREVER}</span>
  const tone = days < 0 ? "text-destructive" : days <= SOON_DAYS ? "text-warn" : ""
  // "12 days" cannot tell you which batch to top up; the date can, and keeping
  // it in the tooltip costs no width in a column that is already tight.
  return (
    <span className={cn("tnum shrink-0", tone)} title={`${node.expires_at} 到期`}>
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
function Reading({ label, pct, dim }: { label: string; pct: number | null; dim: boolean }) {
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
    </div>
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
  const tone = (pct: number | null) => (dim || severity(pct) === "normal" ? "" : toneFor(pct))
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-2">
      {load !== null && <span className={cn("tnum", tone(loadPercent(node)))}>负载 {load.toFixed(2)}</span>}
      {swap !== null && <span className={cn("tnum", tone(swap))}>交换 {Math.round(swap)}%</span>}
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
  return (
    <div className={cn("mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-2", dim && "opacity-70")}>
      <span className="tnum">↓ {rx === null ? "—" : rate(rx)}</span>
      <span className="tnum">↑ {tx === null ? "—" : rate(tx)}</span>
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
export const NodeCard = memo(function NodeCard({ node, onOpen, list = false, quality, pending = false }: {
  node: Node
  onOpen: (id: number) => void
  list?: boolean
  quality?: Quality
  pending?: boolean
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
          <Reading label="CPU" pct={m?.cpu ?? null} dim={dim} />
          <Reading label="内存" pct={percent(m?.mem_used ?? null, m?.mem_total ?? null)} dim={dim} />
          <Reading label="硬盘" pct={percent(m?.disk_used ?? null, m?.disk_total ?? null)} dim={dim} />
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
        {/*
         * `text-[11px] text-muted-2`, down from `text-xs text-muted-foreground`.
         * As the louder of the two greys this row ran brighter than the load and
         * swap line it sits under -- the card's quietest information was
         * outshouting the readings it is meant to support.
         */}
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-2">
          <span className="flex min-w-0 items-center gap-2">
            {/*
             * The card no longer draws a traffic bar, so this is the only place a
             * plan about to run out can be seen. Over the limit is the one case
             * worth colour: 515 GB of a 500 GB plan and 15 GB of it look the same
             * otherwise, and the second one does not matter.
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
           * Same fill on hover as on focus and as on a selected chip: the card
           * used to answer a hover with a border and a keyboard focus with a
           * ring, two different languages for one question.
           */
          "relative overflow-hidden transition-colors group-hover:border-ring group-hover:bg-accent/60",
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
            className={cn("absolute inset-y-4 left-0 w-[3px] rounded-r-full", TONE_EDGE[level])}
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
          <Status node={node} />
        </div>
        {body}
      </Card>
    </a>
  )
})
