import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type Props = { label: ReactNode; pct: number | null; foot: ReactNode; empty?: ReactNode }

/**
 * Two thresholds on top of the plain bar. `--ok`, `--warn` and `--destructive`
 * were all defined and none of them reached a card, so a disk at 95% drew
 * exactly what a disk at 5% drew -- the bar said how much, never how worrying.
 * Below the first threshold the bar stays neutral, so a healthy fleet is quiet.
 */
function tone(pct: number | null): string {
  if (pct === null) return "bg-foreground"
  if (pct >= 92) return "bg-destructive"
  if (pct >= 80) return "bg-warn"
  return "bg-foreground"
}

export function Meter({ label, pct, foot, empty = "—" }: Props) {
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const urgent = pct !== null && filled >= 80
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span
          className={cn(
            "tnum text-xs font-medium",
            urgent && (filled >= 92 ? "text-destructive" : "text-warn"),
          )}
        >
          {pct === null ? empty : `${filled < 10 ? filled.toFixed(1) : filled.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone(pct))}
          style={{ width: `${filled}%` }}
        />
      </div>
      <div className="tnum mt-1.5 truncate text-xs text-muted-foreground">{foot}</div>
    </div>
  )
}
