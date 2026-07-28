/**
 * The return shape every server action in this repo uses. Actions never throw
 * to the client; failures come back as an UPPER_SNAKE code the caller
 * translates.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
