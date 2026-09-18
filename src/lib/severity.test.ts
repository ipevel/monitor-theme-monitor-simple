import { describe, expect, it } from "vitest"

import { DANGER_AT, severity, TONE_TEXT, WARN_AT } from "./severity"

describe("severity", () => {
  it("leaves an ordinary reading uncoloured", () => {
    expect(severity(0)).toBe("normal")
    expect(severity(WARN_AT - 0.01)).toBe("normal")
  })

  it("turns amber at the warn threshold and red at the danger one", () => {
    expect(severity(WARN_AT)).toBe("warn")
    expect(severity(DANGER_AT - 0.01)).toBe("warn")
    expect(severity(DANGER_AT)).toBe("danger")
    expect(severity(100)).toBe("danger")
  })

  it("treats a missing or unusable reading as uncoloured, not as zero", () => {
    // A dash is not a low value; colouring it would claim a reading we do not have.
    expect(severity(null)).toBe("normal")
    expect(severity(Number.NaN)).toBe("normal")
    expect(severity(Number.POSITIVE_INFINITY)).toBe("normal")
  })

  it("maps every level to a text tone", () => {
    expect(TONE_TEXT.normal).toBe("text-foreground")
    expect(TONE_TEXT.warn).toBe("text-warn")
    expect(TONE_TEXT.danger).toBe("text-destructive")
  })
})
