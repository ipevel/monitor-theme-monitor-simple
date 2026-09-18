import type { MouseEvent } from "react"

import { Flag, hasFlag } from "@/components/Flag"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { bytes, daysUntil, daysToReset, FOREVER, pair, percent, uptime } from "@/lib/format"
import { health, monthUsage, type Health } from "@/lib/node"
import { severity, TONE_TEXT } from "@/lib/severity"
import { cn } from "@/lib/utils"

/**
 * Traffic is the one number whose reset date changes what it means: 400 GB on
 * the 3rd of the month is not the same reading as 400 GB the day before it
 * rolls over. Only shown as it approaches, so an ordinary card stays quiet.
 */
function ResetSoon({ node }: { node: Node }) {
  if (node.traffic_limit <= 0) return null
  const days = daysToReset(node.traffic_reset_day)
  if (days === null || days > 7) return null
  return <span className="tnum shrink-0 text-warn">{days === 0 ? "今天重置" : `${days} 天后重置`}</span>
}

const DOT: Record<Health, string> = {
  ok: "bg-ok",
  pending: "bg-warn",
  invalid: "bg-destructive",
  offline: "bg-destructive",
  unconnected: "bg-muted-foreground",
}

export function Status({ node }: { node: Node }) {
  const state = health(node)
  const down = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const up = node.metrics?.uptime
  const label = {
    ok: up ? `在线 ${uptime(up)}` : "在线",
    pending: "已连接 · 等待上报",
    invalid: "数据不可用",
    offline: down >= 60 ? `离线 ${uptime(down)}` : "离线",
    unconnected: "未接入",
  }[state]

  return (
    <span
      className={cn(
        "tnum inline-flex shrink-0 items-center gap-1.5 text-xs",
        (state === "offline" || state === "unconnected") && "text-muted-foreground",
        state === "invalid" && "text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[state])} />
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
  const tone = days < 0 ? "text-destructive" : days <= 7 ? "text-warn" : ""
  return (
    <span className={cn("tnum shrink-0", tone)}>
      {days < 0 ? `已过期 ${-days} 天` : `${days} 天后到期`}
    </span>
  )
}

/** Percentages read as "7.5%" small and "88%" whole; the extra digit only helps
 *  where the number is below ten and would otherwise be a lone "3%". */
function pc(value: number | null) {
  if (value === null) return "—"
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)}%`
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
          dim ? "text-muted-foreground" : TONE_TEXT[severity(pct)],
        )}
      >
        {pc(pct)}
      </div>
    </div>
  )
}

export function NodeCard({ node, onOpen, list = false }: { node: Node; onOpen: () => void; list?: boolean }) {
  const m = node.metrics
  const state = health(node)
  // Anything that is not "online with a fresh sample" shows dimmed numbers: the
  // last reading before an agent went away is worth keeping, but it is history.
  const dim = state !== "ok"

  // 普通左键走客户端路由；中键、⌘/Ctrl 点击和右键菜单交给浏览器，
  // 这样新窗口打开和复制链接地址都能用。
  const activate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen()
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
      <div className={cn("grid grid-cols-3 gap-x-4", list && "w-64 shrink-0")}>
        <Reading label="CPU" pct={m?.cpu ?? null} dim={dim} />
        <Reading label="内存" pct={percent(m?.mem_used ?? null, m?.mem_total ?? null)} dim={dim} />
        <Reading label="硬盘" pct={percent(m?.disk_used ?? null, m?.disk_total ?? null)} dim={dim} />
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
      <div className={cn("flex items-center justify-between gap-3 text-xs text-muted-foreground", list && "w-72 shrink-0")}>
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
    </>
  )

  return (
    <a
      href={`/node/${node.id}`}
      onClick={activate}
      className="group block min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card
        className={cn(
          "gap-3.5 p-5 transition-colors group-hover:border-ring",
          list && "flex-row flex-wrap items-center gap-x-8",
        )}
      >
        <div className={cn("flex min-w-0 items-start justify-between gap-3", list && "min-w-56 flex-1 items-center")}>
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-[15px] font-medium">{node.name}</h3>
            <Country node={node} />
          </div>
          <Status node={node} />
        </div>
        {body}
      </Card>
    </a>
  )
}
