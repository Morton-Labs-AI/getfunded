/**
 * EIN detection: the one deterministic search path.
 *
 * A full Employer Identification Number is nine digits, printed 12-3456789.
 * We accept it with or without the dash (or a space or dot in its place) and
 * nothing else: a bare run of eight digits is not an EIN, and we never
 * zero-pad, because that would turn a two-digit search into an identifier
 * lookup that matches the wrong organization.
 */

/** Nine digits, optionally split 2+7 by a dash, space or dot. */
const EIN_SHAPE = /^\d{2}[-\s.]?\d{7}$/;

/** The nine digits of an EIN, or null when `input` is not one. */
export function detectEin(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (!EIN_SHAPE.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

export function isEin(input: string | null | undefined): boolean {
  return detectEin(input) !== null;
}

/** "quoted text" or “smart quoted text” → the inner text, else null. */
export function unquote(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  const m = raw.match(/^["“](.+)["”]$/);
  return m ? m[1].trim() : null;
}
