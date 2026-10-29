/**
 * What a search box query means, before any database work. Pure, so every
 * rule is unit tested (tests/unit/search/understand.test.ts).
 *
 *   place          a U.S. state named in the words: "in Ohio", "in OH",
 *                  "Toledo", "Denver, CO". Ranking then prefers funders that
 *                  give there; nothing is filtered out.
 *   topic          the words with the place phrase removed, for the full-text
 *                  legs (filings write "OH", never "Ohio").
 *   navigational   the words look like a funder's own name ("Ford Foundation",
 *                  "Lilly Endowment"): a name lookup, not a topic search.
 */

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", VI: "U.S. Virgin Islands", GU: "Guam", AS: "American Samoa", MP: "Northern Mariana Islands",
};

/**
 * Large or well-known cities whose name points to one state. Names shared by
 * several states (Springfield, Columbia, Charleston) or by common words
 * (Mobile, Independence, Hope) are left out on purpose.
 */
export const CITY_STATES: Record<string, string> = {
  "new york city": "NY", nyc: "NY", brooklyn: "NY", bronx: "NY", buffalo: "NY", rochester: "NY", syracuse: "NY", albany: "NY",
  "los angeles": "CA", "san francisco": "CA", "san diego": "CA", "san jose": "CA", oakland: "CA", sacramento: "CA", fresno: "CA",
  "long beach": "CA", "bay area": "CA", "silicon valley": "CA",
  chicago: "IL", peoria: "IL", houston: "TX", dallas: "TX", austin: "TX", "san antonio": "TX", "el paso": "TX", "fort worth": "TX",
  phoenix: "AZ", tucson: "AZ", philadelphia: "PA", pittsburgh: "PA", erie: "PA", seattle: "WA", spokane: "WA", tacoma: "WA",
  denver: "CO", boulder: "CO", "colorado springs": "CO", pueblo: "CO", boston: "MA", worcester: "MA", detroit: "MI", flint: "MI",
  "grand rapids": "MI", "ann arbor": "MI", minneapolis: "MN", "st. paul": "MN", "saint paul": "MN", duluth: "MN",
  atlanta: "GA", savannah: "GA", macon: "GA", miami: "FL", tampa: "FL", orlando: "FL", jacksonville: "FL", tallahassee: "FL",
  baltimore: "MD", "washington dc": "DC", "washington d.c.": "DC", "d.c.": "DC",
  portland: "OR", eugene: "OR", salem: "OR", boise: "ID", "salt lake city": "UT", ogden: "UT", provo: "UT",
  "las vegas": "NV", reno: "NV", albuquerque: "NM", "santa fe": "NM", "las cruces": "NM", "oklahoma city": "OK", tulsa: "OK",
  "kansas city": "MO", "st. louis": "MO", "saint louis": "MO", omaha: "NE", lincoln: "NE", "des moines": "IA",
  milwaukee: "WI", madison: "WI", "green bay": "WI", indianapolis: "IN", gary: "IN", "fort wayne": "IN",
  columbus: "OH", cleveland: "OH", cincinnati: "OH", toledo: "OH", akron: "OH", dayton: "OH",
  louisville: "KY", lexington: "KY", nashville: "TN", memphis: "TN", knoxville: "TN", chattanooga: "TN",
  "new orleans": "LA", "baton rouge": "LA", shreveport: "LA", birmingham: "AL", montgomery: "AL", huntsville: "AL",
  "little rock": "AR", "fayetteville": "AR", charlotte: "NC", raleigh: "NC", durham: "NC", asheville: "NC", greensboro: "NC",
  "virginia beach": "VA", richmond: "VA", norfolk: "VA", roanoke: "VA", newark: "NJ", "jersey city": "NJ", trenton: "NJ",
  hartford: "CT", "new haven": "CT", providence: "RI", burlington: "VT", manchester: "NH", bangor: "ME",
  anchorage: "AK", fairbanks: "AK", honolulu: "HI", hilo: "HI", billings: "MT", missoula: "MT", bozeman: "MT",
  casper: "WY", cheyenne: "WY", fargo: "ND", bismarck: "ND", "sioux falls": "SD", "rapid city": "SD", wichita: "KS",
  "san juan": "PR", "wilmington": "DE",
};

/** Words that make a short query read as a funder's own name. */
const NAME_WORDS =
  /\b(foundation|foundations|fund|trust|trusts|endowment|endowments|charitable|philanthropies|philanthropy|corporation|corp|inc|incorporated|association|society|institute|united way|giving)\b/i;
/**
 * Words that make it a request for funders instead ("grants for", "who funds").
 * "Grant" right before a funder word is a surname ("William T. Grant Foundation").
 */
const ASKING_WORDS = /\b(grants?(?!\s+(?:family\s+)?(?:foundation|fund|trust|endowment)s?\b)|funding|funders?|funds\b|support for|who fund|looking for|programs?|services?)\b/i;

export type Place = {
  state: string;
  /** The words that named it, as typed. */
  matched: string;
  /** Present when a city named it. */
  city: string | null;
};

export type Understanding = {
  place: Place | null;
  /** The query without the place phrase; the whole query when no place was found. */
  topic: string;
  navigational: boolean;
};

const STATE_BY_NAME: [string, string][] = Object.entries(STATE_NAMES)
  .map(([code, name]) => [name.toLowerCase(), code] as [string, string])
  .concat([["washington state", "WA"], ["district of columbia", "DC"]])
  // Longest first, so "west virginia" wins over "virginia".
  .sort((a, b) => b[0].length - a[0].length);

const CITIES_BY_LENGTH = Object.entries(CITY_STATES).sort((a, b) => b[0].length - a[0].length);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove the matched place (and a leading "in"/"across"/"throughout", and a dangling comma) from the words. */
function stripPlace(q: string, start: number, end: number): string {
  const before = q.slice(0, start).replace(/\b(?:in|across|throughout|around|near|within|serving)\s*$/i, "").replace(/[\s,]+$/, "");
  const after = q.slice(end).replace(/^[\s,.]+/, "");
  return `${before} ${after}`.replace(/\s+/g, " ").trim();
}

export function findPlace(q: string): { place: Place; topic: string } | null {
  const lower = q.toLowerCase();
  // 1. A state's full name ("in Ohio", "West Virginia", "New York").
  for (const [name, code] of STATE_BY_NAME) {
    const m = new RegExp(`\\b${escapeRe(name)}\\b`, "i").exec(q);
    if (m) {
      // "Washington" is the state unless it is the city ("Washington DC" is a city entry below).
      if (code === "WA" && /\bwashington,?\s*d\.?\s*c\.?/i.test(q)) continue;
      // "Kansas City", "Oklahoma City", "New York City": the city entries decide.
      if (/^\s+city\b/i.test(q.slice(m.index + m[0].length))) continue;
      // "New York City" is a city entry; the state code is the same either way.
      return { place: { state: code, matched: m[0], city: null }, topic: stripPlace(q, m.index, m.index + m[0].length) };
    }
  }
  // 2. A city ("Toledo", "in Boise", "Denver, CO").
  for (const [city, code] of CITIES_BY_LENGTH) {
    const m = new RegExp(`\\b${escapeRe(city)}(?:,\\s*${code}\\b)?(?![\\w])`, "i").exec(q);
    if (m && lower.includes(city)) {
      const cityLabel = q.slice(m.index, m.index + city.length);
      return { place: { state: code, matched: m[0], city: cityLabel }, topic: stripPlace(q, m.index, m.index + m[0].length) };
    }
  }
  // 3. A two-letter code, only in capitals and only after "in", "across" or a
  //    comma ("youth mental health in OR"): "or", "in", "me" are English words.
  const code = /(?:\bin|\bacross|,)\s+([A-Z]{2})\b/.exec(q);
  if (code && STATE_NAMES[code[1]]) {
    const at = code.index + code[0].length - 2;
    return { place: { state: code[1], matched: code[1], city: null }, topic: stripPlace(q, at, at + 2) };
  }
  return null;
}

/**
 * A few words with a funder word and no request in them ("Ford Foundation",
 * "Oregon Community Foundation"). A place AFTER the funder word makes it a
 * topic again ("public policy research institute in Virginia").
 */
export function looksLikeFunderName(q: string): boolean {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6 || !NAME_WORDS.test(q) || ASKING_WORDS.test(q)) return false;
  const place = findPlace(q);
  if (!place) return true;
  const last = words[words.length - 1];
  return NAME_WORDS.test(last);
}

export function understand(q: string | null): Understanding {
  const text = (q ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { place: null, topic: "", navigational: false };
  const found = findPlace(text);
  return {
    place: found?.place ?? null,
    topic: found && found.topic.length > 0 ? found.topic : text,
    navigational: looksLikeFunderName(text),
  };
}

/** "OH" → "Ohio"; unknown codes come back as given. */
export function stateName(code: string | null | undefined): string {
  if (!code) return "";
  return STATE_NAMES[code.toUpperCase()] ?? code;
}

/**
 * Words that carry no topic in a grantseeker's query ("support for our
 * programs"); left out of the OR query the in-state leg ranks by.
 */
export const GENERIC_WORDS = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "on", "our", "we", "us", "with", "who", "that", "this", "is", "are",
  "grant", "grants", "funding", "fund", "funds", "funder", "funders", "support", "supporting", "program", "programs",
  "service", "services", "nonprofit", "nonprofits", "organization", "organizations", "general", "operating", "help",
  "helping", "provide", "providing", "need", "needs", "local", "work", "looking", "projects", "project",
]);

/** The topic's meaningful words, for an OR full-text query. Empty when every word is generic. */
export function contentWords(topic: string): string[] {
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  return [...new Set(words)].slice(0, 12);
}
