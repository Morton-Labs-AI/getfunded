/**
 * NTEE major-group (first letter) decode. Source of truth: NTEE_MAJOR in the
 * data repo's src/funderdb/embed.py — keep the two in sync by hand.
 */
export const NTEE_MAJOR: Record<string, string> = {
  A: "Arts & Culture",
  B: "Education",
  C: "Environment",
  D: "Animal Welfare",
  E: "Health Care",
  F: "Mental Health",
  G: "Disease Research",
  H: "Medical Research",
  I: "Crime & Legal",
  J: "Employment",
  K: "Food & Agriculture",
  L: "Housing",
  M: "Public Safety",
  N: "Recreation & Sports",
  O: "Youth Development",
  P: "Human Services",
  Q: "International Affairs",
  R: "Civil Rights",
  S: "Community Improvement",
  T: "Philanthropy & Grantmaking",
  U: "Science & Technology Research",
  V: "Social Science Research",
  W: "Public & Societal Benefit",
  X: "Religion",
  Y: "Mutual Benefit",
  Z: "Unknown",
};

/** Decode an NTEE code ("N20") to its major-group label, or null. */
export function nteeMajorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return NTEE_MAJOR[code.charAt(0).toUpperCase()] ?? null;
}
