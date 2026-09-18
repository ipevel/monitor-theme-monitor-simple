import type { MouseEvent } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"
import { bytes, daysUntil, daysToReset, FOREVER, osName, pair, percent, rate, uptime } from "@/lib/format"
import { health, monthUsage, type Health } from "@/lib/node"
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
  return (
    <span className="tnum text-xs text-warn">
      {days === 0 ? "今天流量重置" : `${days} 天后流量重置`}
    </span>
  )
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
        "tnum inline-flex items-center gap-1.5 text-xs",
        (state === "offline" || state === "unconnected") && "text-muted-foreground",
        state === "invalid" && "text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[state])} />
      {label}
    </span>
  )
}

export function Country({ node }: { node: Node }) {
  if (!node.country) return null
  return (
    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
      {node.country}
    </Badge>
  )
}

function trafficFoot(node: Node) {
  return node.traffic_limit > 0
    ? pair(monthUsage(node), node.traffic_limit)
    : `${bytes(monthUsage(node))} / ${FOREVER}`
}

function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null) return <span className="text-xs text-muted-foreground" title="永不到期">{FOREVER}</span>
  const tone = days < 0 ? "text-destructive" : days <= 7 ? "text-warn" : "text-muted-foreground"
  return (
    <span className={cn("tnum text-xs", tone)}>
      {days < 0 ? `已过期 ${-days} 天` : `${days} 天后到期`}
    </span>
  )
}

export function NodeCard({ node, onOpen, list = false }: { node: Node; onOpen: () => void; list?: boolean }) {
  const m = node.metrics
  const state = health(node)
  const gap = node.metrics_invalid ? "不可用" : "—"
  const mem = m?.mem_used != null && m.mem_total != null ? pair(m.mem_used, m.mem_total) : gap
  const disk = m?.disk_used != null && m.disk_total != null ? pair(m.disk_used, m.disk_total) : gap
  // An agent that connected before it reported hardware has no core count yet;
  // "CPU 0 核" would read as a broken machine rather than a fresh one.
  const cores = node.cpu_cores > 0 ? `CPU ${node.cpu_cores} 核` : "CPU"

  // 普通左键走客户端路由；中键、⌘/Ctrl 点击和右键菜单交给浏览器，
  // 这样新窗口打开和复制链接地址都能用。
  const activate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen()
  }

  // Only a node that has never reported hardware has nothing worth drawing --
  // for it the card states what to do instead of a grid of dashes. Every other
  // state (online, waiting for a first sample, offline, unreadable) has at least
  // the month's traffic and usually more, so it gets the readings grid.
  const body = state === "unconnected" ? (
    <p className={cn("text-sm leading-relaxed text-muted-foreground", list ? "mt-2" : "mt-3")}>
      还没有接入。在后台生成安装命令并执行一次。
    </p>
  ) : (
    <>
      <div className={cn("grid gap-x-4 gap-y-4", list ? "grid-cols-2 md:grid-cols-4" : "mt-4 grid-cols-2")}>
        <Meter
          label={cores}
          pct={m?.cpu ?? null}
          empty={gap}
          foot={m?.load ? m.load.map((n) => n.toFixed(2)).join(" ") : gap}
        />
        <Meter label="内存" pct={percent(m?.mem_used ?? null, m?.mem_total ?? null)} empty={gap} foot={mem} />
        <Meter label="硬盘" pct={percent(m?.disk_used ?? null, m?.disk_total ?? null)} empty={gap} foot={disk} />
        <Meter
          label="流量"
          pct={percent(monthUsage(node), node.traffic_limit)}
          empty={node.traffic_limit > 0 ? gap : FOREVER}
          foot={trafficFoot(node)}
        />
      </div>

      <div className={cn("grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4 text-xs", list ? "md:grid-cols-4" : "mt-4")}>
        <span className="tnum inline-flex items-center gap-1.5">
          <ArrowDown className="size-3 text-muted-foreground" />
          {m?.net_rx != null ? rate(m.net_rx) : gap}
        </span>
        <span className="tnum inline-flex items-center gap-1.5">
          <ArrowUp className="size-3 text-muted-foreground" />
          {m?.net_tx != null ? rate(m.net_tx) : gap}
        </span>
        <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
          <ArrowDown className="size-3" />
          {bytes(node.total_rx)}
        </span>
        <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
          <ArrowUp className="size-3" />
          {bytes(node.total_tx)}
        </span>
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
          "min-w-0 p-4 transition-colors group-hover:border-ring",
          list && "flex flex-wrap items-center gap-x-6 gap-y-3",
        )}
      >
        <div className={cn("flex items-start justify-between gap-3", list && "min-w-48 flex-1")}>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <h3 className="truncate font-medium">{node.name}</h3>
              <Country node={node} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {node.os ? osName(node.os) : "等待首次上报"}
              {node.virt && node.virt !== "none" ? ` · ${node.virt}` : ""}
              {node.arch ? ` · ${node.arch}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Status node={node} />
            <Expiry node={node} />
            <ResetSoon node={node} />
          </div>
        </div>
        {body}
      </Card>
    </a>
  )
}
