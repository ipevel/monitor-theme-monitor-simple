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
