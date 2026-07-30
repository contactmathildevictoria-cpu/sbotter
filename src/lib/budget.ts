/**
 * Wall-clock budgets for batch loops that run inside a serverless function.
 *
 * PURE — no clock of its own, no I/O. `now` is passed in so the behaviour is
 * testable without faking timers.
 *
 * Why a budget and not just a row cap: a cap only bounds the loop if you know
 * how long one iteration takes. The website-scrape pass fetches a homepage plus
 * up to 4 subpages at a 10s timeout each, so a single slow company can take
 * ~50s — 20 of those would blow a 300s function limit on their own. A budget
 * checked between iterations turns "probably fits" into "always fits, and says
 * so when it didn't finish".
 */

/** True while there is still time left in the budget. */
export function hasTimeLeft(
  startedAt: number,
  budgetMs: number,
  now: number,
): boolean {
  return now - startedAt < budgetMs;
}

/** Milliseconds left, floored at 0. */
export function timeLeft(
  startedAt: number,
  budgetMs: number,
  now: number,
): number {
  return Math.max(0, budgetMs - (now - startedAt));
}

/**
 * Whether a loop should run another iteration.
 *
 * Takes the *expected* cost of the next iteration so a loop stops before
 * starting work it can't finish, rather than after overshooting. Pass 0 when
 * the per-iteration cost is unknown or negligible.
 */
export function shouldRunAnother(
  startedAt: number,
  budgetMs: number,
  now: number,
  expectedIterationMs = 0,
): boolean {
  return now - startedAt + expectedIterationMs < budgetMs;
}
