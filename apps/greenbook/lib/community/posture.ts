/**
 * Community posture — one env var, read in one place.
 *
 * The nav badge at components/nav.tsx currently reads "read-only · local". It
 * is TRUE today, and that is the only reason it is worth anything: the app has
 * no auth, no user concept, and one read-only pool. The moment a member can
 * write, leaving that string up is a lie in the most trust-sensitive pixel of
 * the product. So the badge is derived from the same constant that gates
 * everything else, and `off` keeps today's copy exactly — nothing moves until
 * the mode is deliberately flipped.
 *
 *   off     the default. No community surfaces render. Ship it this way.
 *   invite  logins live, signup gated by community.invites / allowlist_domains.
 *   open    public signup.
 *
 * NOTE THE SPLIT OF RESPONSIBILITY: this constant controls PRESENTATION (badge,
 * robots, whether links render). The community.settings row `signup_mode`
 * controls WHO ACTUALLY GETS IN, and it is enforced in Postgres by
 * community.may_sign_up(). Presentation must never be the access control —
 * a hidden link is not a gate.
 */
export type CommunityMode = "off" | "invite" | "open";

function parse(raw: string | undefined): CommunityMode {
  return raw === "invite" || raw === "open" ? raw : "off";
}

export const COMMUNITY_MODE: CommunityMode = parse(process.env.COMMUNITY_MODE);

/** Are any community surfaces live at all? */
export const communityLive = COMMUNITY_MODE !== "off";

/** The nav badge. `off` returns today's string, byte for byte. */
export function postureBadge(): string {
  switch (COMMUNITY_MODE) {
    case "open":
      return "community beta";
    case "invite":
      return "invite-only · beta";
    default:
      return "read-only · local";
  }
}

/**
 * Whether the CORPUS routes (/, /browse, /org, /programs, /data) may be
 * indexed. Only ever true under `open`.
 *
 * Member routes are a separate decision and are NEVER indexable — see
 * memberRobots(). Members joined a funder database, not a public people-search
 * index; opening the corpus must not open the roster.
 */
export function corpusIndexable(): boolean {
  return COMMUNITY_MODE === "open";
}

/** Metadata.robots for every corpus route. */
export const corpusRobots = {
  index: corpusIndexable(),
  follow: corpusIndexable(),
} as const;

/**
 * Metadata.robots for every member-facing route (/members, /settings,
 * /collections, /contributions, /review, /onboarding, the auth pages).
 * Unconditional, and exported as a frozen literal so it cannot be made
 * conditional by a later edit without deleting this comment.
 */
export const memberRobots = { index: false, follow: false } as const;
