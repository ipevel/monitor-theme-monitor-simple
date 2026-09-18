import { memo } from "react"

import { ChevronRight } from "lucide-react"

import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { bytes, daysUntil, money, percent, SOON_DAYS } from "@/lib/format"
import { alertLevel, health, loadPercent, monthUsage } from "@/lib/node"
import { severity, TONE_TEXT } from "@/lib/severity"
import { cn } from "@/lib/utils"

/**
 * One cell of the overview strip: label, number, one line of context.
 *
 * The strip replaced four separate cards plus a second row of "expiring"
 * notices. Those were two horizontal bands doing one job, and the icon on each
 * card sat directly beside its label saying the same thing twice.
 *
 * Every cell is a button, including the ones with nothing to open -- and those
 * are `disabled` rather than a `<div>`. Two of the five used to change element
 * type depending on whether there was anything to click, so the strip shifted
 * under the pointer as the fleet changed; and a cell that could be clicked
 * looked exactly like one that could not until someone hovered it.
 */
function Cell({ label, value, note, tone, onSelect, className }: {
  label: string
  value: string
  note: string
  tone?: string
  onSelect?: () => void
  className?: string
}) {
  const inner = (
    <>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("tnum flex items-center gap-1 truncate text-[22px] leading-tight font-semibold", tone)}>
        <span className="truncate">{value}</span>
        {/*
         * The only affordance a cell gets, and it is there whether or not the
         * pointer is anywhere near: a chevron says "this opens something" in a
         * way a hover fill cannot, because a hover fill is only visible to
         * someone who already tried.
         */}
        {onSelect && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{note}</div>
    </>
  )
  const shell = "flex min-w-0 flex-1 flex-col justify-center gap-1 px-5 py-4 text-left"

  return (
    <button
      type="button"
      disabled={!onSelect}
      onClick={onSelect}
      title={onSelect ? `只看${label.replace(/台$/, "")}的节点` : undefined}
      className={cn(
        shell,
        "rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        onSelect
          ? "cursor-pointer hover:bg-accent focus-visible:bg-accent"
          : "cursor-default",
        className,
      )}
    >
      {inner}
    </button>
  )
}

export const Summary = memo(function Summary({ nodes, onExpiring, onAlerting }: {
  nodes: Node[]
  onExpiring: () => void
  onAlerting: () => void
}) {
  const online = nodes.filter((n) => n.online)

  // "Offline" and "not set up yet" are different problems, so the note names
  // them separately instead of adding them into one misleading number.
  const offline = nodes.filter((n) => health(n) === "offline").length
  const unconnected = nodes.filter((n) => health(n) === "unconnected").length
  const down = [
    offline > 0 ? `${offline} 个离线` : "",
    unconnected > 0 ? `${unconnected} 个未接入` : "",
  ].filter(Boolean)

  // The first thing anyone asks a monitoring panel is how many things are
  // wrong, and until now the answer had to be assembled by reading every card.
  // The total reads the same alertLevel the chip and the cards do, so the
  // three can never disagree; an unreadable node is named for what it is
  // rather than folded into "超限", which it is not.
  const levels = nodes.map(alertLevel)
  const alerting = levels.filter((l) => l !== "normal").length
  const invalidCount = nodes.filter((n) => health(n) === "invalid").length
  const dangers = levels.filter((l) => l === "danger").length - invalidCount
  const warns = levels.filter((l) => l === "warn").length
  const alertNote = [
    dangers > 0 ? `${dangers} 台超限` : "",
    invalidCount > 0 ? `${invalidCount} 台数据异常` : "",
    warns > 0 ? `${warns} 台偏高` : "",
  ].filter(Boolean).join(" · ")

  // The busiest node, over every resource rather than CPU alone. A host whose
  // disk is full while its CPU idles was invisible in a tile that only ever
  // compared processors.
  const busiest = online.reduce<{ node: Node; pct: number; label: string } | null>((top, n) => {
    const candidates = [
      { pct: n.metrics?.cpu ?? null, label: "CPU" },
      { pct: percent(n.metrics?.mem_used ?? null, n.metrics?.mem_total ?? null), label: "内存" },
      { pct: percent(n.metrics?.disk_used ?? null, n.metrics?.disk_total ?? null), label: "硬盘" },
      { pct: loadPercent(n), label: "负载" },
    ]
    for (const c of candidates) {
      if (c.pct !== null && c.pct > (top?.pct ?? -1)) top = { node: n, pct: c.pct, label: c.label }
    }
    return top
  }, null)

  // Traffic totals respect the billing direction: monthUsage() counts only the
  // direction the plan is charged on, while the two figures below show both.
  const month = nodes.reduce((total, n) => total + monthUsage(n), 0)
  const monthRx = nodes.reduce((total, n) => total + n.month_rx, 0)
  const monthTx = nodes.reduce((total, n) => total + n.month_tx, 0)

  const expiring = nodes.filter((n) => {
    const d = daysUntil(n.expires_at)
    return d !== null && d >= 0 && d <= SOON_DAYS
  })
  const paid = expiring.filter((n) => n.price > 0)
  const currencies = new Set(paid.map((n) => n.currency))
  // Totalled only where there is one currency to total; adding two together
  // would produce a number that means nothing.
  const currency = currencies.size === 1 ? [...currencies][0] : ""
  const spend = paid.reduce((total, n) => total + n.price, 0)
  // The soonest renewal is the one that decides what to do this week; a total
  // spread over seven days cannot say whether anything is due tomorrow.
  const soonest = expiring.reduce<number | null>((min, n) => {
    const d = daysUntil(n.expires_at)
    return d === null ? min : min === null ? d : Math.min(min, d)
  }, null)

  return (
    /*
     * Five cells, and on a phone they are a two-column grid rather than five
     * squeezed slivers: the strip was a flex row with no breakpoint, so at 375px
     * each cell got 75px and every note wrapped or clipped. The last cell spans
     * both columns there rather than sitting alone in a half-row.
     */
    <Card className="grid grid-cols-2 overflow-hidden p-0 sm:flex sm:flex-row sm:divide-x sm:divide-border">
      <Cell
        label="节点"
        value={`${online.length} / ${nodes.length}`}
        note={down.length > 0 ? down.join(" · ") : "全部在线"}
      />
      <Cell
        label="告警"
        value={alerting > 0 ? `${alerting} 台` : "无"}
        note={alerting > 0 ? alertNote : "全部正常"}
        tone={dangers > 0 ? "text-destructive" : warns > 0 ? "text-warn" : undefined}
        onSelect={alerting > 0 ? onAlerting : undefined}
      />
      <Cell
        label="最忙节点"
        value={busiest === null ? "—" : `${busiest.pct.toFixed(1)}%`}
        note={busiest ? `${busiest.node.name} · ${busiest.label}` : "无在线节点"}
        tone={TONE_TEXT[severity(busiest?.pct ?? null)]}
      />
      <Cell
        label="本月流量"
        value={bytes(month)}
        note={`下行 ${bytes(monthRx)} · 上行 ${bytes(monthTx)}`}
      />
      <Cell
        // Same words as the filter chip it opens, so the two read as one thing.
        // The threshold lives in the tooltip: "7 天内到期" was the widest label
        // on the strip and it was spending that width on a number nobody needs
        // to see twice.
        label="即将到期"
        value={`${expiring.length} 台`}
        note={
          expiring.length === 0
            ? "无"
            : [
                soonest !== null ? `${soonest === 0 ? "今天" : `${soonest} 天后`}到期` : "",
                currency ? `合计 ${money(spend, currency)}` : "含免费节点",
              ].filter(Boolean).join(" · ")
        }
        tone={expiring.length > 0 ? "text-warn" : undefined}
        onSelect={expiring.length > 0 ? onExpiring : undefined}
        className="col-span-2 sm:col-span-1"
      />
    </Card>
  )
})
