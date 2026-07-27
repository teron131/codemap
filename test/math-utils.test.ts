/** Checks shared numeric population summaries. */
import { describe, expect, it } from "vitest";

import { describeNumbers } from "../src/codemap/math-utils.js";

describe("math utilities", () => {
  it("describes numeric populations with sample deviation and interpolated percentiles", () => {
    expect(describeNumbers([4, 1, 3, 2])).toEqual({
      count: 4,
      mean: 2.5,
      std: 1.29,
      min: 1,
      p25: 1.75,
      p50: 2.5,
      p75: 3.25,
      p90: 3.7,
      max: 4,
      bins: {
        "1-2": 2,
        "3-4": 2,
      },
    });
  });

  it("derives bin ranges from each observed population", () => {
    expect(describeNumbers([7]).bins).toEqual({ "7-7": 1 });
    expect(describeNumbers([10, 20, 30, 40]).bins).toEqual({
      "10-20": 2,
      "21-31": 1,
      "32-40": 1,
    });
    expect(describeNumbers([0, 0.5, 1]).bins).toEqual({
      "[0,0.333333)": 1,
      "[0.333333,0.666667)": 1,
      "[0.666667,1]": 1,
    });
  });
});
