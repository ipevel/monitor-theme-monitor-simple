import { Activity, ArrowDown, ArrowDownUp, ArrowUp, Gauge, Server } from "lucide-react"

import { Card } from "@/components/ui/card"
import { speedHistory, type Node } from "@/lib/api"
import { bytes, rate } from "@/lib/format"
import { health } from "@/lib/node"
import { SPARK_FLOOR } from "@/lib/series"
import { cn } from "@/lib/utils"

function Tile({ icon: Icon, label, children }: {
  icon: typeof Server; label: string; children: React.ReactNode
}) {
  return (
    <Card className="gap-0 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      {children}
    </Card>
  )
}

function Flow({ down, up, className }: { down: string; up: string; className?: string }) {
  return (
    <div className={cn("tnum grid grid-cols-1 gap-x-2 sm:grid-cols-2", className)}>
      <span className="inline-flex items-center gap-1">
        <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
        {down}
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
        {up}
      </span>
    </div>
  )
}

function Spark({ series }: { series: { values: number[]; className: string }[] }) {
  // SPARK_FLOOR rather than the series' own maximum: see src/lib/series.ts.
  const top = Math.max(SPARK_FLOOR, ...series.flatMap((s) => s.values), 1)
  const width = Math.max(...series.map((s) => s.values.length), 2) - 1
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      {series.map((s, i) => (
        <polyline
          key={i}
          className={s.className}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          points={s.values.map((v, x) => `${(x / width) * 100},${23 - (v / top) * 22}`).join(" ")}
        />
      ))}
    </svg>
  )
}

export function Summary({ nodes }: { nodes: Node[] }) {
  const online = nodes.filter((n) => n.online)
  const sum = (pick: (n: Node) => number) => nodes.reduce((total, n) => total + pick(n), 0)

  // "Offline" and "not set up yet" are different problems, so the tile names
  // them separately instead of adding them into one misleading number.
  const offline = nodes.filter((n) => health(n) === "offline").length
  const unconnected = nodes.filter((n) => health(n) === "unconnected").length
  const down = [
    offline > 0 ? `${offline} 个离线` : "",
    unconnected > 0 ? `${unconnected} 个未接入` : "",
  ].filter(Boolean)

  const busiest = online.reduce<Node | null>((top, n) => {
    const cpu = n.metrics?.cpu
    if (cpu === null || cpu === undefined) return top
    return cpu > (top?.metrics?.cpu ?? -1) ? n : top
  }, null)
  const cpu = busiest?.metrics?.cpu ?? 0
  const now = speedHistory.at(-1) ?? { rx: 0, tx: 0 }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile icon={Server} label="节点">
        <div className="tnum mt-1 text-xl font-semibold">
          {online.length} / {nodes.length}
        </div>
        <div className="mt-auto pt-1 text-xs text-muted-foreground">
          {down.length > 0 ? `● ${down.join(" · ")}` : "全部在线"}
        </div>
      </Tile>

      <Tile icon={Activity} label="最忙节点">
        <div className="tnum mt-1 text-xl font-semibold">{busiest ? `${cpu.toFixed(1)}%` : "—"}</div>
        <div className={cn("mt-auto truncate pt-1 text-xs", cpu >= 85 ? "font-medium text-destructive" : "text-muted-foreground")}>
          {busiest ? busiest.name : "无在线节点"}
        </div>
      </Tile>

      <Tile icon={ArrowDownUp} label="累计流量">
        <div className="tnum mt-1 text-xl font-semibold">{bytes(sum((n) => n.total_rx) + sum((n) => n.total_tx))}</div>
        <div className="mt-2 text-xs text-muted-foreground">今日</div>
        <Flow down={bytes(sum((n) => n.day_rx))} up={bytes(sum((n) => n.day_tx))} className="mt-0.5 text-sm" />
      </Tile>

      <Tile icon={Gauge} label="实时网速">
        <Flow down={rate(now.rx)} up={rate(now.tx)} className="mt-1 text-sm font-semibold" />
        <div className="mt-auto pt-1">
          <Spark
            series={[
              { values: speedHistory.map((s) => s.rx), className: "text-foreground" },
              { values: speedHistory.map((s) => s.tx), className: "text-muted-foreground" },
            ]}
          />
        </div>
      </Tile>
    </div>
  )
}
