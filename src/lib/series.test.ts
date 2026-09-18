import { describe, expect, it } from "vitest"

import { despike, SPARK_FLOOR, type PingPoint } from "./series"

const series = (latencies: (number | null)[]): PingPoint[] =>
  latencies.map((latency, i) => ({ task_id: 1, ts: i * 60, latency }))

describe("despike", () => {
  it("replaces an isolated spike with the local median", () => {
    const out = despike(series([20, 21, 20, 22, 400, 21, 20, 21, 20]))
    expect(out[4].latency).toBe(21)
  })

  it("leaves a sustained step alone", () => {
    // Every point of the high half looks normal to its neighbours, so there is
    // nothing isolated to correct -- the median itself moves.
    const out = despike(series([20, 20, 20, 20, 200, 200, 200, 200, 200]))
    expect(out[4].latency).toBe(200)
    expect(out[8].latency).toBe(200)
  })

  it("passes nulls through", () => {
    const out = despike(series([20, null, 400, 21, 20]))
    expect(out[1].latency).toBeNull()
  })

  it("changes nothing when nothing is outlying", () => {
    const input = series([20, 21, 20, 22, 21, 20])
    expect(despike(input).map((p) => p.latency)).toEqual(input.map((p) => p.latency))
  })

  it("keeps the surrounding fields of a corrected point", () => {
    const input: PingPoint[] = series([20, 21, 20, 22, 400, 21, 20, 21, 20])
    input[4].loss = 7
    input[4].band = [10, 30]
    const out = despike(input)
    expect(out[4].loss).toBe(7)
    expect(out[4].band).toEqual([10, 30])
    expect(out[4].ts).toBe(input[4].ts)
  })
})

describe("SPARK_FLOOR", () => {
  it("is a megabyte a second, so an idle host draws low", () => {
    expect(SPARK_FLOOR).toBe(1024 * 1024)
  })
})
