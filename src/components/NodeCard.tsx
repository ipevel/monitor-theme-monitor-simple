import { ArrowDown, ArrowUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"
import { bytes, daysUntil, FOREVER, osName, pair, percent, rate, uptime } from "@/lib/format"
import { cn } from "@/lib/utils"

function monthUsage(node: Node): number {
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up": return tx
    case "down": return rx
    case "max": return Math.max(rx, tx)
    default: return rx + tx
  }
}

function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

export function Status({ node }: { node: Node }) {
  const down = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const label = node.online
    ? `在线 ${node.metrics ? uptime(node.metrics.uptime) : ""}`
    : deployed(node)
      ? `离线 ${down >= 60 ? uptime(down) : ""}`
      : "未接入"
  return (
    <span className={cn("tnum inline-flex items-center gap-1.5 text-xs", !node.online && "text-muted-foreground")}>
      <span className={cn("size-1.5 rounded-full", node.online ? "bg-ok" : "bg-destructive")} />
      {label.trim()}
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

  const body = deployed(node) ? (
    <>
      <div className={cn("grid gap-x-4 gap-y-4", list ? "grid-cols-2 md:grid-cols-4" : "mt-4 grid-cols-2")}>
        <Meter
          label={`CPU ${node.cpu_cores} 核`}
          pct={m ? m.cpu : null}
          foot={m ? m.load.map((n) => n.toFixed(2)).join(" ") : "—"}
        />
        <Meter
          label="内存"
          pct={m ? percent(m.mem_used, m.mem_total) : null}
          foot={m ? pair(m.mem_used, m.mem_total) : bytes(node.mem_total)}
        />
        <Meter
          label="硬盘"
          pct={m ? percent(m.disk_used, m.disk_total) : null}
          foot={m ? pair(m.disk_used, m.disk_total) : bytes(node.disk_total)}
        />
        <Meter
          label="流量"
          pct={node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : null}
          empty={FOREVER}
          foot={trafficFoot(node)}
        />
      </div>

      <div className={cn("grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4 text-xs", list ? "md:grid-cols-4" : "mt-4")}>
        <span className="tnum inline-flex items-center gap-1.5">
          <ArrowDown className="size-3 text-muted-foreground" />
          {m ? rate(m.net_rx) : "—"}
        </span>
        <span className="tnum inline-flex items-center gap-1.5">
          <ArrowUp className="size-3 text-muted-foreground" />
          {m ? rate(m.net_tx) : "—"}
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
  ) : (
    <p className={cn("text-sm leading-relaxed text-muted-foreground", list ? "mt-2" : "mt-3")}>
      还没有接入。在后台生成安装命令并执行一次。
    </p>
  )

  return (
    <Card
      onClick={onOpen}
      className={cn(
        "min-w-0 cursor-pointer p-4 transition-colors hover:border-ring",
        list && "flex flex-wrap items-center gap-x-6 gap-y-3",
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
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
        </div>
      </div>
      {body}
    </Card>
  )
}
