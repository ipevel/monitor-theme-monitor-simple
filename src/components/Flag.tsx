import { FLAG_CODES, FLAG_SPRITE } from "@/assets/flags"
import { cn } from "@/lib/utils"

/** Codes we have artwork for. Everything else keeps the plain text badge. */
export function hasFlag(code: string) {
  return FLAG_CODES.has(code.trim().toUpperCase())
}

/**
 * The sprite, mounted once per document.
 *
 * It is 71 KB of <symbol> markup (21 KB gzipped) held in a zero-sized SVG, so a
 * flag anywhere in the tree is one <use> away. Inlined rather than served from a
 * file because the hub decides the MIME type, and an SVG delivered as anything
 * but `image/svg+xml` refuses to render inside an <img>.
 */
export function FlagSprite() {
  return (
    <svg aria-hidden className="absolute size-0 overflow-hidden" dangerouslySetInnerHTML={{ __html: FLAG_SPRITE }} />
  )
}

/**
 * A country's flag at the size a card actually draws it.
 *
 * 3:2 throughout -- every flag in the source set is that ratio, so one outer
 * viewBox scales them all consistently. The hairline is not decoration: Japan,
 * Poland and Cyprus are white on an edge, and the card behind them is white too.
 */
export function Flag({ code, className }: { code: string; className?: string }) {
  const key = code.trim().toUpperCase()
  if (!FLAG_CODES.has(key)) return null
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <svg viewBox="0 0 30 20" className="h-[13px] w-[19.5px] rounded-[2.5px]" aria-hidden>
        <use href={`#flag-${key.toLowerCase()}`} />
      </svg>
      <span className="pointer-events-none absolute inset-0 rounded-[2.5px] ring-1 ring-black/15 dark:ring-white/20" />
    </span>
  )
}
