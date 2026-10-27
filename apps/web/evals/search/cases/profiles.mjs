/**
 * 100 synthetic nonprofits, generated the same way on every run (seeded), so
 * "do 100 organizations doing the same search get different, better results"
 * can be measured and compared across runs.
 *
 *   state twins   10 pairs: same cause, budget and mission; different states
 *   cause twins   10 pairs: same state and budget; different causes
 *   budget twins  10 pairs: same cause, state and mission; $85k vs $12M budget
 *   mixed         40 single profiles across causes, states and budgets
 *
 * Every profile runs the SHARED_QUERIES (the same words for everyone) and its
 * own mission sentence, each with and without its profile attached.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { causes } = JSON.parse(readFileSync(path.join(here, "causes.json"), "utf8"));

/** One city per state, a mix of metro and small-town settings. */
export const CITIES = {
  AL: "Birmingham", AK: "Anchorage", AZ: "Tucson", AR: "Little Rock", CA: "Fresno", CO: "Pueblo", CT: "Hartford",
  DE: "Wilmington", DC: "Washington", FL: "Tampa", GA: "Macon", HI: "Hilo", ID: "Boise", IL: "Peoria", IN: "Gary",
  IA: "Des Moines", KS: "Wichita", KY: "Hazard", LA: "Baton Rouge", ME: "Bangor", MD: "Baltimore", MA: "Springfield",
  MI: "Flint", MN: "Duluth", MS: "Jackson", MO: "St. Louis", MT: "Billings", NE: "Omaha", NV: "Reno", NH: "Manchester",
  NJ: "Newark", NM: "Las Cruces", NY: "Buffalo", NC: "Asheville", ND: "Fargo", OH: "Toledo", OK: "Tulsa", OR: "Eugene",
  PA: "Erie", RI: "Providence", SC: "Columbia", SD: "Rapid City", TN: "Memphis", TX: "El Paso", UT: "Ogden",
  VT: "Burlington", VA: "Roanoke", WA: "Spokane", WV: "Charleston", WI: "Green Bay", WY: "Casper",
};

export const BUDGETS = [85_000, 420_000, 2_300_000, 12_000_000];

export const SHARED_QUERIES = ["general operating support grants", "funders for our community programs"];

/** mulberry32: a tiny seeded PRNG, so the profiles never change between runs. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildProfiles(seed = 20261026) {
  const rand = prng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const causeKeys = Object.keys(causes);
  const states = Object.keys(CITIES);
  const profiles = [];
  const make = (id, cause, state, budget, missionIdx, twin) => {
    const mission = causes[cause].missions[missionIdx % causes[cause].missions.length];
    profiles.push({
      id,
      name: `${CITIES[state]} ${causes[cause].label.split(/[ ,]/)[0]} Project`,
      cause,
      state,
      city: CITIES[state],
      budget,
      mission,
      ...(twin ? { twin } : {}),
    });
  };

  const stateTwinPairs = [["OH", "OR"], ["GA", "WA"], ["TX", "VT"], ["CA", "KY"], ["NY", "NM"], ["FL", "MN"], ["IL", "MS"], ["PA", "AZ"], ["MA", "MT"], ["NC", "NE"]];
  stateTwinPairs.forEach(([a, b], i) => {
    const cause = causeKeys[(i * 5) % causeKeys.length];
    make(`st-${i}-a`, cause, a, 420_000, i, { kind: "state", group: `st-${i}` });
    make(`st-${i}-b`, cause, b, 420_000, i, { kind: "state", group: `st-${i}` });
  });

  const causeTwinPairs = [["B", "L"], ["A", "K"], ["E", "C"], ["F", "N"], ["D", "J"], ["O", "R"], ["P", "U"], ["G", "S"], ["I", "Q"], ["X", "W"]];
  causeTwinPairs.forEach(([a, b], i) => {
    const state = states[(i * 7 + 3) % states.length];
    make(`ct-${i}-a`, a, state, 420_000, i, { kind: "cause", group: `ct-${i}` });
    make(`ct-${i}-b`, b, state, 420_000, i, { kind: "cause", group: `ct-${i}` });
  });

  for (let i = 0; i < 10; i++) {
    const cause = causeKeys[(i * 3 + 1) % causeKeys.length];
    const state = states[(i * 11 + 5) % states.length];
    make(`bt-${i}-a`, cause, state, 85_000, i, { kind: "budget", group: `bt-${i}` });
    make(`bt-${i}-b`, cause, state, 12_000_000, i, { kind: "budget", group: `bt-${i}` });
  }

  for (let i = 0; i < 40; i++) make(`mx-${i}`, pick(causeKeys), pick(states), pick(BUDGETS), Math.floor(rand() * 3), null);
  return profiles;
}
