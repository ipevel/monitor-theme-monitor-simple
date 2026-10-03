/*
 * The time windows the detail view offers, and how a picked one survives the
 * list changing shape underneath it.
 *
 * They live beside `format.ts` rather than inside `NodeDetail` because the list
 * is no longer a constant: hub v1.3.2 reports how far back it actually keeps
 * samples (`history_days`), so a hub holding a month of data gets a month-wide
 * button and an older hub keeps the seven-day one it always had.
 */

export type RangeOption = { hours: number; label: string }

/** The windows every hub can serve, whatever its retention. */
export const BASE_RANGES: RangeOption[] = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 168, label: "7 天" },
]

/**
 * The windows to offer for a hub that keeps `days` days of history.
 *
 * Only ever an addition: the four base windows stay put, and a retention wider
 * than seven days appends one window that reaches all the way back. Seven days
 * is the fallback for a hub that reports nothing usable -- every hub before
 * v1.3.2 omits the field, and that is exactly the retention those hubs have.
 */
export function rangesFor(days?: number | null): RangeOption[] {
  const kept = typeof days === "number" && Number.isFinite(days) && days >= 1 ? Math.floor(days) : 7
  const hours = kept * 24
  if (hours <= 168) return BASE_RANGES
  return [...BASE_RANGES, { hours, label: kept >= 365 ? "1 年" : `${kept} 天` }]
}

/**
 * Which windows a tab offers.
 *
 * The latency tab keeps to a day and below: a ping chart drawn over a month is a
 * smear of overlapping lines, and the probe summary above it is what answers the
 * long window. A function rather than a ternary in the component body, for the
 * same reason `spanFor` is one.
 */
export function rangesOn(offers: RangeOption[], tab: string): RangeOption[] {
  return tab === "latency" ? offers.filter((r) => r.hours <= 24) : offers
}

/**
 * Which window to ask for when `picked` is no longer on offer.
 *
 * The list narrows on the latency tab, which drops everything past a day, and it
 * would narrow further if a hub's retention ever shrank: asking for a window
 * that has left the row would leave no button lit and a chart of the wrong span.
 * Falling back to the widest remaining window keeps the two in step.
 */
export function spanFor(offers: RangeOption[], picked: number): number {
  return offers.some((r) => r.hours === picked) ? picked : offers[offers.length - 1].hours
}
