import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { bytes, daysUntil, money } from "@/lib/format"
import { health, monthUsage } from "@/lib/node"
import { severity, TONE_TEXT } from "@/lib/severity"
import { cn } from "@/lib/utils"

const SOON = 7

/**
 * One cell of the overview strip: label, number, one line of context.
 *
 * The strip replaced four separate cards plus a second row of "expiring"
 * notices. Those were two horizontal bands doing one job, and the icon on each
 * card sat directly beside its label saying the same thing twice.
 */
function Cell({ label, value, note, tone, onSelect }: {
  label: string
  value: string
  note: string
  tone?: string
  onSelect?: () => void
}) {
  const inner = (
    <>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("tnum truncate text-[22px] leading-tight font-semibold", tone)}>{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{note}</div>
    </>
  )
  const shell = "flex min-w-0 flex-1 flex-col justify-center gap-1 px-5 py-4 text-left"

  if (!onSelect) return <div className={shell}>{inner}</div>
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(shell, "cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:bg-accent")}
    >
      {inner}
    </button>
  )
}

export function Summary({ nodes, onExpiring }: { nodes: Node[]; onExpiring: () => void }) {
  const online = nodes.filter((n) => n.online)

  // "Offline" and "not set up yet" are different problems, so the note names
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
  const cpu = busiest?.metrics?.cpu ?? null

  // Traffic totals respect the billing direction: monthUsage() counts only the
  // direction the plan is charged on, while the two figures below show both.
  const month = nodes.reduce((total, n) => total + monthUsage(n), 0)
  const monthRx = nodes.reduce((total, n) => total + n.month_rx, 0)
  const monthTx = nodes.reduce((total, n) => total + n.month_tx, 0)

  const expiring = nodes.filter((n) => {
    const d = daysUntil(n.expires_at)
    return d !== null && d >= 0 && d <= SOON
  })
  const paid = expiring.filter((n) => n.price > 0)
  const currencies = new Set(paid.map((n) => n.currency))
  // Totalled only where there is one currency to total; adding two together
  // would produce a number that means nothing.
  const currency = currencies.size === 1 ? [...currencies][0] : ""
  const spend = paid.reduce((total, n) => total + n.price, 0)

  return (
    <Card className="flex-row gap-0 divide-x divide-border overflow-hidden p-0">
      <Cell
        label="节点"
        value={`${online.length} / ${nodes.length}`}
        note={down.length > 0 ? down.join(" · ") : "全部在线"}
      />
      <Cell
        label="最忙节点"
        value={cpu === null ? "—" : `${cpu.toFixed(1)}%`}
        note={busiest?.name ?? "无在线节点"}
        tone={TONE_TEXT[severity(cpu)]}
      />
      <Cell
        label="本月流量"
        value={bytes(month)}
        note={`下行 ${bytes(monthRx)} · 上行 ${bytes(monthTx)}`}
      />
      <Cell
        label={`${SOON} 天内到期`}
        value={`${expiring.length} 台`}
        note={currency ? `合计 ${money(spend, currency)}` : expiring.length > 0 ? "含免费节点" : "无"}
        tone={expiring.length > 0 ? "text-warn" : undefined}
        onSelect={expiring.length > 0 ? onExpiring : undefined}
      />
    </Card>
  )
}
