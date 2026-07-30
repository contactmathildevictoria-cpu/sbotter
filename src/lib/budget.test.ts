import { describe, expect, it } from "vitest";
import { hasTimeLeft, shouldRunAnother, timeLeft } from "@/lib/budget";

const START = 1_000_000;

describe("hasTimeLeft", () => {
  it("is true until the budget is spent", () => {
    expect(hasTimeLeft(START, 1000, START)).toBe(true);
    expect(hasTimeLeft(START, 1000, START + 999)).toBe(true);
  });

  it("is false at and past the boundary", () => {
    expect(hasTimeLeft(START, 1000, START + 1000)).toBe(false);
    expect(hasTimeLeft(START, 1000, START + 5000)).toBe(false);
  });

  it("is false for a zero budget", () => {
    expect(hasTimeLeft(START, 0, START)).toBe(false);
  });
});

describe("timeLeft", () => {
  it("counts down and floors at zero", () => {
    expect(timeLeft(START, 1000, START)).toBe(1000);
    expect(timeLeft(START, 1000, START + 400)).toBe(600);
    expect(timeLeft(START, 1000, START + 1000)).toBe(0);
    expect(timeLeft(START, 1000, START + 9999)).toBe(0);
  });
});

describe("shouldRunAnother", () => {
  it("stops before starting work that would overshoot", () => {
    // 60s budget, 52s expected per iteration (the website pass): fine at the
    // start, refused once less than one iteration's worth is left.
    expect(shouldRunAnother(START, 60_000, START, 52_000)).toBe(true);
    expect(shouldRunAnother(START, 60_000, START + 7_000, 52_000)).toBe(true);
    expect(shouldRunAnother(START, 60_000, START + 8_000, 52_000)).toBe(false);
  });

  it("guarantees the loop can't exceed the budget", () => {
    // The property the enrichment passes rely on: if every iteration costs at
    // most `expected`, a loop gated on this can never run past `budget`.
    const budget = 200_000;
    const expected = 52_000;
    let now = START;
    let iterations = 0;
    while (shouldRunAnother(START, budget, now, expected)) {
      now += expected;
      iterations++;
      if (iterations > 100) throw new Error("guard never stopped the loop");
    }
    expect(now - START).toBeLessThanOrEqual(budget);
    expect(iterations).toBe(3); // 3 x 52s = 156s; a 4th would reach 208s
  });

  it("degrades to a plain elapsed check with no expected cost", () => {
    expect(shouldRunAnother(START, 1000, START + 999)).toBe(true);
    expect(shouldRunAnother(START, 1000, START + 1000)).toBe(false);
  });

  it("refuses immediately when one iteration can't fit at all", () => {
    // A budget smaller than a single iteration does no work rather than
    // starting something it will be killed in the middle of.
    expect(shouldRunAnother(START, 10_000, START, 52_000)).toBe(false);
  });
});
