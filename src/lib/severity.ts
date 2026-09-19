/**
 * The two thresholds, in one place.
 *
 * A reading turns amber at 80% and red at 92%. Both the card's numbers and the
 * summary tile's read this, so a value cannot be amber in one row and red in the
 * other. Below the first threshold nothing is coloured: a healthy fleet stays
 * grey, which is the whole point of having the threshold at all.
 */
export const WARN_AT = 80
export const DANGER_AT = 92

export type Severity = "normal" | "warn" | "danger"

export function severity(pct: number | null): Severity {
  if (pct === null || !Number.isFinite(pct)) return "normal"
  if (pct >= DANGER_AT) return "danger"
  if (pct >= WARN_AT) return "warn"
  return "normal"
}

/**
 * Exit thresholds, held two points below the entry ones.
 *
 * A host hovering at the line crossed it on every two-second push: one sample
 * at 79.9% dropped it out of the alert count and the problem-first sort, the
 * next at 80.1% put it back, and the grid reshuffled itself all afternoon.
 * Once a level is reached it holds until the reading falls clearly below it.
 * The cost is at most two points of late all-clear; the gain is a panel that
 * stands still. Entering a higher level stays immediate.
 */
export const WARN_EXIT = 78
export const DANGER_EXIT = 90

/** Applies the hold: `prev` is the level this reading last reported. */
export function withHysteresis(pct: number | null, prev: Severity): Severity {
  const level = severity(pct)
  if (pct === null) return level
  if (prev === "danger" && level === "warn" && pct >= DANGER_EXIT) return "danger"
  if (prev === "warn" && level === "normal" && pct >= WARN_EXIT) return "warn"
  return level
}

/** Text tones for the three levels. Kept beside the thresholds they encode. */
export const TONE_TEXT: Record<Severity, string> = {
  normal: "text-foreground",
  warn: "text-warn",
  danger: "text-destructive",
}

/**
 * The tone for a single reading.
 *
 * `TONE_TEXT[severity(pct)]` was written out in four places, which is three
 * chances for one of them to drift -- and the detail page's was missing
 * entirely, so a CPU at 95% was red on its card and grey once opened. One
 * function, so a reading cannot be two colours on two screens.
 */
export function toneFor(pct: number | null): string {
  return TONE_TEXT[severity(pct)]
}

/**
 * The rail down the left edge of a card that is alerting.
 *
 * Recolouring a 20px number was the only thing an alert did, which left an
 * alerting card carrying exactly the same weight as a healthy one four columns
 * away -- in a grid of white cards the four amber digits read as texture, not as
 * a signal. The overview strip had already solved this with a filled rail on
 * each tile; the cards now use the same mark, so the two agree.
 */
export const TONE_EDGE: Record<Severity, string> = {
  normal: "",
  warn: "bg-warn",
  danger: "bg-destructive",
}
