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
    // A floor rather than an exact count: the sprite is generated from the
    // source directory now, and the failure worth catching is a partial run or a
    // half-unpacked directory, not a number that legitimately changes when the
    // flag set is refreshed.
    expect(FLAG_CODES.size).toBeGreaterThan(240)
    for (const code of FLAG_CODES) {
      expect(FLAG_SPRITE).toContain(`id="flag-${code.toLowerCase()}"`)
    }
  })

  it("covers the codes an IP lookup can actually return", () => {
    // The bug this pins, shipped in v1.7.0 and v1.8.0: the sprite was built from
    // a hand-written list of 120 codes, and CN and GB were not on it. A Chinese
    // or British node drew a bare "CN" badge while a Japanese one drew a flag.
    // Nothing failed and no test noticed -- a missing flag is a fallback, not an
    // error, which is what let it go unseen for two releases.
    for (const code of ["CN", "GB", "US", "JP", "DE", "FR", "HK", "SG", "RU", "UA", "BR", "IN", "ZA", "AU"]) {
      expect(hasFlag(code), code).toBe(true)
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
    // 中国台湾 has no regional flag, so its code keeps the plain badge -- the one
    // code held back on purpose (scripts/build-flags.py names the other three).
    expect(hasFlag("TW")).toBe(false)
    expect(hasFlag("XX")).toBe(false)
    expect(hasFlag("")).toBe(false)
  })
})
