import { describe, expect, it } from "vitest"

import { FLAG_CODES, FLAG_SPRITE } from "@/assets/flags"
import { hasFlag } from "@/components/Flag"

/**
 * The sprite is a generated string spliced into one document, so the ways it can
 * break are all silent: a stale <use> that resolves to nothing draws an empty
 * box, a duplicated id makes one flag render as another, and a dangling
 * url(#…) makes a whole flag lose its fill. None of that throws, and none of it
 * shows up in a type check. These assertions are the only thing standing between
 * a bad regeneration and a page of blank rectangles.
 */
describe("flag sprite", () => {
  const ids = [...FLAG_SPRITE.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])

  it("has artwork for every code it advertises", () => {
    expect(FLAG_CODES.size).toBeGreaterThan(100)
    for (const code of FLAG_CODES) {
      expect(FLAG_SPRITE).toContain(`id="flag-${code.toLowerCase()}"`)
    }
  })

  it("declares a symbol for each code and nothing else", () => {
    const symbols = [...FLAG_SPRITE.matchAll(/<symbol id="flag-([a-z]{2})"/g)].map((m) => m[1].toUpperCase())
    expect(new Set(symbols)).toEqual(FLAG_CODES)
  })

  it("keeps every id unique -- one document holds all of them", () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("resolves every internal reference", () => {
    const known = new Set(ids)
    const refs = [...FLAG_SPRITE.matchAll(/(?:href="|url\()#([^")]+)/g)].map((match) => match[1])
    for (const ref of refs) expect(known.has(ref)).toBe(true)
  })

  it("leaves no id behind other than the symbol ids", () => {
    // This source draws flags from bare paths -- no mask, clipPath or gradient.
    // If a future refresh brings some, they must have been namespaced by
    // scripts/build-flags.py, or the second flag defining "a" wins for both.
    for (const id of ids) expect(id).toMatch(/^flag-[a-z]{2}$/)
  })

  it("carries no XML prologue or nested <svg>, which would be discarded inline", () => {
    expect(FLAG_SPRITE).not.toContain("<?xml")
    expect(FLAG_SPRITE).not.toContain("<svg")
    expect(FLAG_SPRITE).not.toContain("xlink:")
  })

  it("normalises casing and whitespace, and rejects what it has no artwork for", () => {
    expect(hasFlag("jp")).toBe(true)
    expect(hasFlag(" jp ")).toBe(true)
    expect(hasFlag("US")).toBe(true)
    // 中国台湾 has no regional flag, so its code keeps the plain badge. Same for
    // anything outside the curated list.
    expect(hasFlag("TW")).toBe(false)
    expect(hasFlag("XX")).toBe(false)
    expect(hasFlag("")).toBe(false)
  })
})
