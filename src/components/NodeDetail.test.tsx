import { describe, expect, it } from "vitest"

import { hiddenFor } from "@/components/NodeDetail"

/*
 * Which probes a detail view has hidden, and on which host.
 *
 * Everything else in NodeDetail needs a chart, a fetch and a ResizeObserver
 * before it can say anything, so this is the one thing in there worth testing
 * on its own: the list is per-host, and probe numbers are reused across hosts.
 * Hiding probe 1 in Tokyo used to blank the only line on a host in Frankfurt
 * while the legend underneath still listed every probe -- an empty chart that
 * looked like a fetch that had failed.
 *
 * The view is keyed on the host as well now, so this is the second line of
 * defence rather than the first; it is cheap and it is the one that says what
 * the rule actually is.
 */
describe("hiddenFor", () => {
  it("returns the ids that belong to this host", () => {
    expect(hiddenFor({ node: 7, ids: [1, 3] }, 7)).toEqual([1, 3])
  })

  it("returns nothing for a different host", () => {
    expect(hiddenFor({ node: 7, ids: [1, 3] }, 9)).toEqual([])
  })

  it("returns nothing when nothing has been hidden yet", () => {
    expect(hiddenFor({ node: 7, ids: [] }, 7)).toEqual([])
  })
})
