/**
 * Who is searching. A grantseeker's state, cause and budget change which
 * funders are worth their time, so ranking prefers funders that give where
 * they work and to work like theirs. It never hides anyone: a national funder
 * that fits the words still ranks; it simply stops crowding out the ones that
 * fund next door. Pure, and unit tested.
 *
 * Sources, strongest first:
 *   1. the URL (`for_state`, `for_cause`, `for_budget`, `for_city`): the public
 *      "Tune results" panel, a shared link, the eval suite;
 *   2. a place named in the words ("in Ohio" sets the state for this search);
 *   3. the signed-in workspace's profile (`workspaces.profile`), unless the
 *      URL says `tune=off`.
 */
import type { SearchParams } from "./params";
import { STATE_NAMES, stateName, type Understanding } from "./understand";

export type ContextSource = "url" | "query" | "profile";

export type SearcherContext = {
  state: string | null;
  stateSource: ContextSource | null;
  city: string | null;
  /** NTEE major group letter. */
  cause: string | null;
  causeSource: ContextSource | null;
  /** Annual budget in whole dollars. */
  budget: number | null;
};

export const EMPTY_CONTEXT: SearcherContext = { state: null, stateSource: null, city: null, cause: null, causeSource: null, budget: null };

/** The slice of a workspace profile ranking can use. */
export type ProfileContext = {
  state?: string | null;
  city?: string | null;
  causes?: string[] | null;
  budget?: number | null;
};

/** What each cause is about, in the plain words a funder's summary uses. */
export const CAUSE_WORDS: Record<string, { label: string; words: string[] }> = {
  A: { label: "arts and culture", words: ["arts", "museum", "theater", "music", "dance", "culture", "humanities", "orchestra"] },
  B: { label: "education", words: ["education", "school", "schools", "literacy", "scholarship", "scholarships", "students", "college", "tutoring"] },
  C: { label: "the environment", words: ["environment", "environmental", "conservation", "climate", "watershed", "river", "forest", "land"] },
  D: { label: "animal welfare", words: ["animal", "animals", "humane", "shelter", "wildlife", "veterinary", "rescue"] },
  E: { label: "health care", words: ["health", "clinic", "hospital", "medical", "patients", "nursing", "dental"] },
  F: { label: "mental health", words: ["mental", "counseling", "addiction", "suicide", "behavioral", "substance", "recovery", "crisis"] },
  G: { label: "people living with a disease or disability", words: ["cancer", "diabetes", "disease", "alzheimer", "autism", "disability", "caregivers"] },
  H: { label: "medical research", words: ["research", "cancer", "clinical", "cure", "medical", "scientific"] },
  I: { label: "legal aid and justice", words: ["legal", "justice", "court", "prison", "reentry", "victims"] },
  J: { label: "jobs and workforce training", words: ["job", "jobs", "workforce", "employment", "training", "career", "apprenticeship"] },
  K: { label: "food security and agriculture", words: ["food", "hunger", "nutrition", "pantry", "farm", "meals", "agriculture"] },
  L: { label: "housing and homelessness", words: ["housing", "homeless", "homelessness", "shelter", "homes", "affordable"] },
  M: { label: "public safety and disaster relief", words: ["disaster", "emergency", "fire", "rescue", "relief", "preparedness", "safety"] },
  N: { label: "recreation and sports", words: ["sports", "recreation", "athletic", "camp", "park", "parks", "league"] },
  O: { label: "youth development", words: ["youth", "mentoring", "boys", "girls", "scouts", "teens", "after-school"] },
  P: { label: "human services", words: ["family", "families", "children", "seniors", "aging", "caregivers", "foster"] },
  Q: { label: "international development and relief", words: ["international", "global", "refugees", "humanitarian", "overseas", "developing"] },
  R: { label: "civil rights and advocacy", words: ["rights", "equity", "voting", "advocacy", "immigrants", "racial", "justice"] },
  S: { label: "community and economic development", words: ["community", "economic", "neighborhood", "revitalization", "downtown", "business"] },
  T: { label: "nonprofit capacity and philanthropy", words: ["philanthropy", "nonprofit", "nonprofits", "capacity", "volunteer", "volunteers"] },
  U: { label: "science and technology", words: ["science", "stem", "technology", "engineering", "robotics", "math", "computer"] },
  V: { label: "social science and policy research", words: ["research", "policy", "economics", "data", "study"] },
  W: { label: "public benefit, journalism and libraries", words: ["journalism", "news", "library", "libraries", "radio", "civic", "broadcasting"] },
  X: { label: "faith-based work", words: ["church", "ministry", "faith", "religious", "christian", "jewish", "congregation"] },
};

export const CAUSE_KEYS = Object.keys(CAUSE_WORDS);

/**
 * The profile's free-text program areas ("Education", "Youth development")
 * mapped to NTEE major groups, so a profile filled in before cause areas
 * existed still tunes search.
 */
export function causesFromProgramAreas(areas: string[] | null | undefined): string[] {
  if (!areas?.length) return [];
  const out = new Set<string>();
  for (const area of areas) {
    const a = area.toLowerCase();
    for (const [key, { label, words }] of Object.entries(CAUSE_WORDS)) {
      if (a.includes(label.split(" ")[0]) || words.some((w) => new RegExp(`\\b${w}\\b`).test(a))) out.add(key);
    }
  }
  return [...out];
}

/** The fields of `workspaces.profile` that tune search (lib/workspace/context.ts). */
export type ProfileFields = {
  state?: string;
  city?: string;
  cause_areas?: string[];
  program_areas?: string[];
  annual_budget?: number;
};

/**
 * A workspace profile as search context, or null when it says nothing search
 * can use. Cause areas chosen in onboarding win; free-text program areas from
 * older profiles are mapped as a fallback.
 */
export function profileContextFrom(profile: ProfileFields | null | undefined): ProfileContext | null {
  if (!profile) return null;
  const causes = profile.cause_areas?.length ? profile.cause_areas : causesFromProgramAreas(profile.program_areas);
  const ctx: ProfileContext = { state: profile.state ?? null, city: profile.city ?? null, causes, budget: profile.annual_budget ?? null };
  return ctx.state || causes.length || ctx.budget ? ctx : null;
}

function validState(s: string | null | undefined): string | null {
  const v = s?.trim().toUpperCase();
  return v && STATE_NAMES[v] ? v : null;
}

function validCause(c: string | null | undefined): string | null {
  const v = c?.trim().toUpperCase();
  return v && CAUSE_WORDS[v] ? v : null;
}

/** Combine the sources. URL beats a place in the words, which beats the profile. */
export function resolveContext(p: SearchParams, u: Understanding, profile: ProfileContext | null): SearcherContext {
  const ctx: SearcherContext = { ...EMPTY_CONTEXT };
  const useProfile = profile !== null && p.tune !== "off";

  const urlState = validState(p.forState);
  if (urlState) {
    ctx.state = urlState;
    ctx.stateSource = "url";
    ctx.city = p.forCity;
  } else if (u.place) {
    ctx.state = u.place.state;
    ctx.stateSource = "query";
    ctx.city = u.place.city;
  } else if (useProfile && validState(profile.state)) {
    ctx.state = validState(profile.state);
    ctx.stateSource = "profile";
    ctx.city = profile.city ?? null;
  }

  const urlCause = validCause(p.forCause);
  if (urlCause) {
    ctx.cause = urlCause;
    ctx.causeSource = "url";
  } else if (useProfile && profile.causes?.length) {
    const first = profile.causes.map(validCause).find((c): c is string => c !== null) ?? null;
    if (first) {
      ctx.cause = first;
      ctx.causeSource = "profile";
    }
  }

  ctx.budget = p.forBudget ?? (useProfile && profile.budget && profile.budget > 0 ? profile.budget : null);
  return ctx;
}

/** True when the words already say what the cause is about, so adding it would only repeat them. */
function mentionsCause(text: string, cause: string): boolean {
  const t = text.toLowerCase();
  return CAUSE_WORDS[cause].words.some((w) => new RegExp(`\\b${w}`).test(t));
}

/**
 * The text the meaning-based search embeds. The searcher's cause and place are
 * added when the words do not already carry them, so "general operating
 * support" from a Toledo literacy group reads like that group's need, and the
 * index walk itself starts near the funders that fit.
 */
export function embedText(q: string, u: Understanding, ctx: SearcherContext): string {
  let text = q.trim();
  if (ctx.cause && ctx.causeSource !== "query" && !mentionsCause(text, ctx.cause)) {
    text += ` for ${CAUSE_WORDS[ctx.cause].label}`;
  }
  if (ctx.state && !u.place) {
    text += ` in ${ctx.city ? `${ctx.city}, ` : ""}${stateName(ctx.state)}`;
  }
  return text;
}
