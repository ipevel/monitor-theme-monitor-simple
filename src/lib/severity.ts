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

/** Text tones for the three levels. Kept beside the thresholds they encode. */
export const TONE_TEXT: Record<Severity, string> = {
  normal: "text-foreground",
  warn: "text-warn",
  danger: "text-destructive",
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
