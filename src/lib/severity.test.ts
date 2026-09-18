import { describe, expect, it } from "vitest"

import { DANGER_AT, DANGER_EXIT, severity, TONE_TEXT, WARN_AT, WARN_EXIT, withHysteresis } from "./severity"

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

describe("withHysteresis", () => {
  it("holds a reached level until the reading clears it", () => {
    // The two-point hold is what keeps a host hovering at the line from
    // flickering in and out of the alert count every two-second sample.
    expect(withHysteresis(WARN_AT + 1, "normal")).toBe("warn")
    expect(withHysteresis(WARN_EXIT + 1, "warn")).toBe("warn")
    expect(withHysteresis(WARN_EXIT - 0.5, "warn")).toBe("normal")
    expect(withHysteresis(DANGER_EXIT + 1, "danger")).toBe("danger")
    expect(withHysteresis(DANGER_EXIT - 0.5, "danger")).toBe("warn")
  })

  it("enters a higher level immediately, without waiting for a hold", () => {
    expect(withHysteresis(DANGER_AT + 1, "warn")).toBe("danger")
    expect(withHysteresis(WARN_AT + 1, "normal")).toBe("warn")
    expect(withHysteresis(WARN_AT - 1, "normal")).toBe("normal")
  })

  it("treats a missing reading as the plain threshold, not as a held level", () => {
    // A dash is no value at all; keeping a colour behind nothing would claim a
    // reading that is not there.
    expect(withHysteresis(null, "warn")).toBe("normal")
    expect(withHysteresis(null, "danger")).toBe("normal")
  })
})
