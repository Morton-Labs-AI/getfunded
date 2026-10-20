/** Original research paraphrases for the local comparison preview, 2026-10-19.
 * No publisher excerpts, contacts, private paths or before-images are shipped.
 * These are staged interpretations, not applied or human-approved web facts.
 * Baseline fields come from the campaign's local registry/search-pool record;
 * this is deliberately not a complete historical database snapshot.
 */
export interface DemoSource {
  id: string;
  title: string;
  url: string;
  observed: string;
  fingerprint: string | null;
  note: string;
}

export interface EvidenceExample {
  id: string;
  name: string;
  shortName: string;
  location: string;
  ein: string;
  website: string;
  program: string;
  posture: string;
  tone: "positive" | "caution" | "neutral";
  takeaway: string;
  summary: string;
  scope: string;
  eligibility: string;
  focus: string[];
  fitSource: string;
  steps: { title: string; detail: string; source: string }[];
  update: string;
  dateNote: string;
  caution: string;
  unknowns: string[];
  sources: DemoSource[];
}

export const evidenceExamples: EvidenceExample[] = [
  {
    id: "south-dakota",
    name: "South Dakota Community Foundation",
    shortName: "South Dakota Fund",
    location: "Pierre, South Dakota",
    ein: "46-0398115",
    website: "https://www.sdcommunityfoundation.org",
    program: "South Dakota Fund",
    posture: "Year-round letters of inquiry",
    tone: "positive",
    takeaway: "Start with an inquiry, not a full proposal.",
    summary: "The program describes year-round letters of inquiry. A full application follows an invitation after the initial review.",
    scope: "Charitable work across South Dakota",
    eligibility: "Public nonprofit organizations; a verified fiscal sponsor can receive funds on an applicant’s behalf.",
    focus: ["Child well-being", "Housing", "Workforce development", "Education", "Health & human services", "Culture", "Economic development", "Financial literacy"],
    fitSource: "sdf-guidelines",
    steps: [
      { title: "Discuss your fit", detail: "Use the program page’s grants-team question route to clarify the project and the right funding track.", source: "sdf-guidelines" },
      { title: "Submit a letter of inquiry", detail: "The guidelines accept LOIs throughout the year. The team screens for mission and eligibility.", source: "sdf-guidelines" },
      { title: "Wait for a full-application invitation", detail: "LOI review comes first. A visible application portal does not guarantee an invitation or an award.", source: "sdf-guidelines" },
    ],
    update: "2026 program changes",
    dateNote: "The page identifies added 2026 priorities. It does not establish the month the whole website was updated.",
    caution: "These terms belong to the South Dakota Fund. Other foundation funds and partnerships have separate rules.",
    unknowns: ["Whole-site last-update month", "Current IRS standing", "A payment made within the past 12 months", "Whether this particular project will be invited"],
    sources: [{
      id: "sdf-guidelines", title: "South Dakota Fund · program & grant guidelines",
      url: "https://www.sdcommunityfoundation.org/grants/south-dakota-fund-grant",
      observed: "19 Oct 2026 · 13:53 UTC", fingerprint: "a2bbe47272c0",
      note: "Saved publisher-page snapshot. Original research paraphrase; human review and application are pending.",
    }],
  },
  {
    id: "minneapolis",
    name: "Minneapolis Foundation",
    shortName: "Minneapolis · conflicting notices",
    location: "Minneapolis, Minnesota",
    ein: "41-6029402",
    website: "https://www.minneapolisfoundation.org",
    program: "Climate Action and Racial Equity Fund",
    posture: "Conflicting notices · deadline passed",
    tone: "caution",
    takeaway: "An “OPEN” label is not enough.",
    summary: "The overview retains an OPEN label, but the dated 2026 call gives a July 23 deadline, already past at this review. Both observations are preserved.",
    scope: "Place-based work in Minneapolis communities",
    eligibility: "The named call includes nonprofits, government entities, schools, religious institutions and organizations with a fiscal sponsor.",
    focus: ["Climate action", "Racial equity", "Local emissions reduction", "Community-led projects"],
    fitSource: "mpls-call",
    steps: [
      { title: "Read the dated call", detail: "The 2026 application deadline was July 23 at 1 p.m. The page does not state a timezone.", source: "mpls-call" },
      { title: "Check for the next guidelines", detail: "The call plans updated guidelines in 2027. That is not a confirmed opening date or an extension.", source: "mpls-call" },
      { title: "Use the program question route", detail: "The call distinguishes program-fit questions from technical portal support. Check current guidance before preparing a proposal.", source: "mpls-call" },
    ],
    update: "25 Jun 2026 call",
    dateNote: "This is the call’s publication date, not the last-update date for the entire website.",
    caution: "The overview says no opportunities are open while also labeling this fund OPEN. Its generic requirements link points to the 2025 call. Do not silently resolve these conflicts.",
    unknowns: ["A confirmed next application opening", "The deadline timezone", "Whole-site last-update month", "A recent paid award to a specific recipient"],
    sources: [
      { id: "mpls-overview", title: "Funding opportunities · conflicting overview", url: "https://www.minneapolisfoundation.org/funding-opportunities/", observed: "19 Oct 2026 · 12:11 UTC", fingerprint: "3031dda7dbc2", note: "Saved publisher-page snapshot. The conflicting overview remains part of the evidence." },
      { id: "mpls-call", title: "2026 Climate Action and Racial Equity Grants", url: "https://www.minneapolisfoundation.org/stories/climate/2026-climate-action-and-racial-equity-grants/", observed: "19 Oct 2026 · source review", fingerprint: null, note: "Published 25 Jun 2026; reviewed through the web tool. No publisher-byte fingerprint is included for this call in the demo." },
    ],
  },
  {
    id: "hopewell",
    name: "Hopewell Valley Education Foundation",
    shortName: "Hopewell Valley · educator grants",
    location: "Pennington, New Jersey",
    ein: "22-3235943",
    website: "https://www.hvef.org",
    program: "Fall 2026 educator grants",
    posture: "District educators only",
    tone: "neutral",
    takeaway: "A current call can still be the wrong fit.",
    summary: "The fall round has a November 18, 2026 application deadline. Applicants must be teachers or staff in the Hopewell Valley Regional School District.",
    scope: "Hopewell Valley Regional School District",
    eligibility: "District teachers and staff apply for projects in district schools. Outside organizations, parents and PTOs cannot apply under these terms.",
    focus: ["Teaching & learning", "Student enrichment", "Educator-led projects", "School equipment"],
    fitSource: "hvef-guidelines",
    steps: [
      { title: "Discuss an idea, if helpful", detail: "The optional pre-grant inquiry route is encouraged before November 6 for this fall round.", source: "hvef-guidelines" },
      { title: "Get the required school approvals", detail: "The application needs the appropriate administrator’s signature, plus technology approval when applicable.", source: "hvef-guidelines" },
      { title: "Submit by November 18, 2026", detail: "Follow the program’s stated application route. A deadline time and timezone are not established here.", source: "hvef-guidelines" },
    ],
    update: "Fall 2026 cycle",
    dateNote: "A named current cycle supplies program timing, not the date the whole website was edited.",
    caution: "This is an internal district-educator program, not a general nonprofit grant opportunity. Grants go to district schools.",
    unknowns: ["Deadline time and timezone", "Whole-site last-update month", "Current IRS standing", "Approval of any individual proposal"],
    sources: [{ id: "hvef-guidelines", title: "HVEF grant application guidelines", url: "https://www.hvef.org/grant-information/guidelines.html", observed: "19 Oct 2026 · 12:16 UTC", fingerprint: "8fb0214ff84f", note: "Saved publisher-page snapshot. Original paraphrase only; publisher excerpts and contacts remain private." }],
  },
];
