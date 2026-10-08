/**
 * Every string a user reads about IRS standing, stated once. Plain language
 * for a nonprofit audience. Pure (no database, no React), so the chip, the
 * profile, the search filter and an export can all import it.
 *
 * Rules these strings keep (the same ones lib/content/copy.ts keeps):
 *  - a revocation is always "automatically revoked": the IRS list holds only
 *    organizations that filed no return or notice for three years in a row,
 *    and no other kind of revocation;
 *  - every statement names the IRS list it comes from and that list's date.
 *    "dated" is used only when the IRS dated the file; otherwise "retrieved";
 *  - "not on the lists" is never a statement that an organization has shut
 *    down, and absence from Publication 78 alone is never a negative;
 *  - where two IRS lists disagree we show both and do not choose;
 *  - no number that drifts (a count, a percentage) is written here.
 *
 * Nothing here is written by a model. Every sentence is built from dates and
 * list names in the IRS files.
 */
import { formatDate } from "@/lib/format";
import type { IrsDateKind, IrsStanding, IrsStandingValue } from "@/lib/queries/corpus/standing-types";

/* ------------------------------------------------------------------ names */

export const IRS_STANDING_TITLE = "IRS standing";

export const IRS_REVOCATION_LIST_NAME = "IRS automatic revocation list";
export const IRS_REVOCATION_LIST_FULL_NAME = "IRS Automatic Revocation of Exemption List";
export const IRS_PUB78_NAME = "IRS Publication 78 data";
export const IRS_MASTER_FILE_NAME = "IRS master file";

export const IRS_REVOCATION_LIST_EXPLAINER =
  "The IRS Automatic Revocation of Exemption List names organizations that lost tax-exempt status by law " +
  "because they filed no annual return or notice for three years in a row. It holds no other kind of revocation.";

export const IRS_PUB78_EXPLAINER =
  "IRS Publication 78 data lists organizations that can receive tax-deductible contributions. " +
  "Many eligible organizations are not on it, so its silence alone means nothing.";

/** Dataset names as the corpus records them, in the words the UI uses. */
export const IRS_SOURCE_LABELS: Record<string, string> = {
  irs_auto_revocation: IRS_REVOCATION_LIST_FULL_NAME,
  irs_pub78: IRS_PUB78_NAME,
  irs_eo_bmf: "IRS master file (Exempt Organizations BMF)",
};

export function irsSourceLabel(dataset: string | null | undefined): string {
  if (!dataset) return "IRS public list";
  return IRS_SOURCE_LABELS[dataset] ?? dataset.replace(/_/g, " ");
}

/* ------------------------------------------------------------------ links */

export const IRS_TEOS_URL = "https://apps.irs.gov/app/eos/";
export const IRS_TEOS_LINK_LABEL = "Check this organization on the IRS Tax Exempt Organization Search";
export const IRS_TEOS_LINK_NOTE = "The IRS search is the current record. Our copy of each list has the date shown here.";

export const IRS_REVOCATION_DATE_NOTE_URL =
  "https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads#revocationdate";
export const IRS_REVOCATION_DATE_NOTE_LINK_LABEL = "Read the IRS note on these dates";

export const IRS_REINSTATEMENT_URL =
  "https://www.irs.gov/charities-non-profits/charitable-organizations/automatic-revocation-how-to-have-your-tax-exempt-status-reinstated";
export const IRS_REINSTATEMENT_LINK_LABEL = "How the IRS reinstates tax-exempt status";

export const IRS_DEDUCTIBILITY_CODES_URL =
  "https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-deductibility-status-codes";
export const IRS_DEDUCTIBILITY_CODES_LINK_LABEL = "IRS list of deductibility codes";

/* ------------------------------------------------------------------ dates */

/** "dated Sep 30, 2026" when the IRS dated the file, "retrieved Jul 25, 2026" when it did not. */
export function irsListDate(asOf: string | null, kind: IrsDateKind | null): string {
  if (!asOf) return "with no date on record";
  return `${kind === "irs_file_date" ? "dated" : "retrieved"} ${formatDate(asOf)}`;
}

function monthYear(asOf: string, kind: IrsDateKind | null): string {
  return `${kind === "irs_file_date" ? "dated" : "retrieved"} ${formatDate(asOf, "month")}`;
}

function revocationListRef(s: IrsStanding): string {
  return `${IRS_REVOCATION_LIST_NAME} ${irsListDate(s.revocationListAsOf, s.revocationListAsOfKind)}`;
}

function pub78Ref(s: IrsStanding): string {
  return `${IRS_PUB78_NAME} ${irsListDate(s.pub78AsOf, s.pub78AsOfKind)}`;
}

function masterFileRef(s: IrsStanding): string {
  return `${IRS_MASTER_FILE_NAME} ${irsListDate(s.bmfAsOf, s.bmfAsOfKind)}`;
}

/** For an organization that is NOT in the master file: the copy that was searched. */
function masterFileCopyRef(s: IrsStanding): string {
  return s.masterFileAsOf
    ? `the copy of the ${IRS_MASTER_FILE_NAME} we hold (from ${formatDate(s.masterFileAsOf)})`
    : `the copy of the ${IRS_MASTER_FILE_NAME} we hold`;
}

/**
 * The date of the file the answer came from, for the seal: "dated Sep 30, 2026"
 * or "retrieved Jul 25, 2026". The deciding file is the revocation list when
 * a revocation row exists, else the master file, else Publication 78.
 */
export function irsDecidingFileDate(s: IrsStanding): string {
  if (s.revocationDate) return irsListDate(s.revocationListAsOf, s.revocationListAsOfKind);
  if (s.inBmf) return irsListDate(s.bmfAsOf, s.bmfAsOfKind);
  return irsListDate(s.pub78AsOf, s.pub78AsOfKind);
}

/** True when the IRS says the listed revocation date is wrong and gives the right one. */
export function hasCorrectedRevocationDate(s: IrsStanding): boolean {
  return Boolean(s.revocationDate && s.effectiveRevocationDate && s.revocationDate !== s.effectiveRevocationDate);
}

export const IRS_CORRECTED_DATE_NOTE = (s: IrsStanding) =>
  `The IRS list shows ${formatDate(s.revocationDate)}. The IRS says that revocation dates it lists from April 1 to July 14, 2020 ` +
  `should read July 15, 2020, because it extended the filing dates that year. We show the corrected date.`;

/* ------------------------------------------------------------------ chips */

/** Short state names: table cells, filters, the compact chip. */
export const IRS_STANDING_LABELS: Record<IrsStandingValue, string> = {
  listed: "On the IRS list",
  revoked: "Automatically revoked by the IRS",
  revoked_then_relisted: "Automatically revoked, recognized again",
  lists_disagree: "IRS lists disagree",
  not_listed: "Not on the current IRS lists",
};

/** The chip text: the state plus its date, where the state has one. */
export function irsStandingChipLabel(s: IrsStanding): string {
  switch (s.standing) {
    case "listed": {
      // The list that lists it: the master file, else Publication 78.
      const asOf = s.inBmf ? s.bmfAsOf : s.pub78AsOf;
      const kind = s.inBmf ? s.bmfAsOfKind : s.pub78AsOfKind;
      return asOf ? `On the IRS list (IRS file ${monthYear(asOf, kind)})` : IRS_STANDING_LABELS.listed;
    }
    case "revoked":
      return s.effectiveRevocationDate
        ? `Automatically revoked by the IRS on ${formatDate(s.effectiveRevocationDate)}`
        : IRS_STANDING_LABELS.revoked;
    case "revoked_then_relisted":
      return s.effectiveRevocationDate
        ? `Automatically revoked in ${formatDate(s.effectiveRevocationDate, "year")}, recognized again`
        : IRS_STANDING_LABELS.revoked_then_relisted;
    default:
      return IRS_STANDING_LABELS[s.standing];
  }
}

/** What a screen reader hears on the chip button. */
export const IRS_STANDING_CHIP_ARIA = (label: string) => `${label}. Show what the IRS lists say`;

/* ------------------------------------------------------------- statements */

export const IRS_NOT_LISTED_DISCLAIMER = "This is not a statement that the organization has shut down.";

export const IRS_NOT_LISTED_WHY =
  "Some organizations are on none of these lists. For example, a charitable trust that is not tax-exempt still files " +
  "Form 990-PF, and a church does not have to apply to the IRS.";

export const IRS_LISTS_DISAGREE_CLOSING = "We show both and do not choose.";

export const IRS_REVOKED_SCOPE_NOTE =
  "This list covers automatic revocation only, and the IRS updates it about once a month. " +
  "An organization can ask the IRS to reinstate it.";

/**
 * For "lists_disagree": one dated fact that often explains the disagreement.
 * When the IRS posted the revocation AFTER the date of every file that still
 * names the organization, our copy of that file is simply older than the
 * revocation. We say so with the dates and still do not choose. Empty when
 * the posting date is not on record or a naming file is as new as the posting.
 */
export function irsOlderCopyNote(s: IrsStanding): string {
  if (s.standing !== "lists_disagree" || !s.postingDate) return "";
  const namedIn: Array<[name: string, asOf: string | null]> = [];
  if (s.inBmf) namedIn.push([IRS_MASTER_FILE_NAME, s.bmfAsOf]);
  if (s.onPub78) namedIn.push([IRS_PUB78_NAME, s.pub78AsOf]);
  if (namedIn.length === 0) return "";
  // Dates are `YYYY-MM-DD` strings, so they compare as text.
  if (!namedIn.every(([, asOf]) => asOf !== null && asOf < (s.postingDate as string))) return "";
  const files =
    namedIn.length === 1
      ? `The copy of ${namedIn[0][0] === IRS_MASTER_FILE_NAME ? "the " : ""}${namedIn[0][0]} we hold is`
      : `The copies of the ${IRS_MASTER_FILE_NAME} and ${IRS_PUB78_NAME} we hold are`;
  return `The IRS posted this revocation to its list on ${formatDate(s.postingDate)}. ${files} older than that.`;
}

function revokedSentence(s: IrsStanding): string {
  return (
    `The IRS automatically revoked this organization's tax-exempt status on ${formatDate(s.effectiveRevocationDate)}, ` +
    `because it filed no annual return or notice for three years in a row (${revocationListRef(s)}).`
  );
}

function listedToday(s: IrsStanding): string {
  if (s.inBmf && s.onPub78) return `Today it is in the ${masterFileRef(s)} and on ${pub78Ref(s)}.`;
  if (s.inBmf) return `Today it is in the ${masterFileRef(s)}.`;
  return `Today it is on ${pub78Ref(s)}.`;
}

/**
 * The IRS's own dated statement, as short paragraphs for the popover. Every
 * sentence names its list and that list's date.
 */
export function irsStandingStatement(s: IrsStanding): string[] {
  switch (s.standing) {
    case "listed": {
      const out: string[] = [];
      if (s.inBmf) out.push(`The ${masterFileRef(s)} lists this organization.`);
      if (s.onPub78) {
        out.push(
          s.inBmf
            ? `${pub78Ref(s)} lists it as eligible to receive tax-deductible contributions.`
            : `${pub78Ref(s)} lists this organization as eligible to receive tax-deductible contributions.`,
        );
      }
      out.push(`The ${revocationListRef(s)} has no entry for it.`);
      return out;
    }

    case "revoked": {
      const out = [revokedSentence(s)];
      out.push(
        s.reinstatementDate && !s.reinstated
          ? `The list carries a reinstatement date of ${formatDate(s.reinstatementDate)}. That is before this revocation, so it belongs to an earlier one.`
          : "The list shows no reinstatement.",
      );
      out.push(`The organization is not in ${masterFileCopyRef(s)} and not on ${pub78Ref(s)}.`);
      out.push(IRS_REVOKED_SCOPE_NOTE);
      return out;
    }

    case "revoked_then_relisted": {
      const out = [revokedSentence(s)];
      if (s.reinstated && s.reinstatementDate) {
        out.push(`The same list shows the exemption reinstated, effective ${formatDate(s.reinstatementDate)}.`);
      } else if (s.inBmf && s.bmfRulingDate) {
        out.push(
          `The ${masterFileRef(s)} lists it with an IRS ruling dated ${formatDate(s.bmfRulingDate, "month")}, after the revocation.`,
        );
      }
      out.push(listedToday(s));
      return out;
    }

    case "lists_disagree": {
      const out: string[] = [];
      if (s.inBmf) out.push(`The ${masterFileRef(s)} lists this organization.`);
      if (s.onPub78) {
        out.push(
          s.inBmf
            ? `${pub78Ref(s)} lists it as eligible to receive tax-deductible contributions.`
            : `${pub78Ref(s)} lists this organization as eligible to receive tax-deductible contributions.`,
        );
      }
      out.push(
        `The ${revocationListRef(s)} shows an automatic revocation on ${formatDate(s.effectiveRevocationDate)} and no reinstatement after it.`,
      );
      const older = irsOlderCopyNote(s);
      if (older) out.push(older);
      out.push(IRS_LISTS_DISAGREE_CLOSING);
      return out;
    }

    case "not_listed": {
      const out = [`This organization is not in ${masterFileCopyRef(s)} and not on ${pub78Ref(s)}.`];
      out.push(
        s.revocationDate
          ? `The ${revocationListRef(s)} shows an automatic revocation on ${formatDate(s.effectiveRevocationDate)}` +
              (s.reinstated && s.reinstatementDate
                ? ` and a reinstatement effective ${formatDate(s.reinstatementDate)}.`
                : ".")
          : `The ${revocationListRef(s)} has no entry for it.`,
      );
      out.push(IRS_NOT_LISTED_DISCLAIMER);
      out.push(IRS_NOT_LISTED_WHY);
      return out;
    }
  }
}

/**
 * One sentence for places with no popover: an export row, a table title, or
 * the evidence line of a fit analysis (add that line only when the standing
 * is not "listed", so saved analyses of ordinary funders keep their fingerprint).
 */
export function irsStandingSummary(s: IrsStanding): string {
  switch (s.standing) {
    case "listed":
      return s.inBmf
        ? `In the ${masterFileRef(s)}; no entry on the ${revocationListRef(s)}.`
        : `On ${pub78Ref(s)}; no entry on the ${revocationListRef(s)}.`;
    case "revoked":
      return (
        `Automatically revoked by the IRS on ${formatDate(s.effectiveRevocationDate)} for filing no return for three years ` +
        `(${revocationListRef(s)}); no reinstatement, and on no other IRS list we hold.`
      );
    case "revoked_then_relisted":
      return (
        `Automatically revoked by the IRS on ${formatDate(s.effectiveRevocationDate)} (${revocationListRef(s)}), then recognized again` +
        (s.reinstated && s.reinstatementDate ? `, effective ${formatDate(s.reinstatementDate)}.` : ".")
      );
    case "lists_disagree":
      return (
        `IRS lists disagree: ${s.inBmf ? `in the ${masterFileRef(s)}` : `on ${pub78Ref(s)}`}, and the ${revocationListRef(s)} ` +
        `shows an automatic revocation on ${formatDate(s.effectiveRevocationDate)}.`
      );
    case "not_listed":
      return `Not in ${masterFileCopyRef(s)}, not on ${pub78Ref(s)}. ${IRS_NOT_LISTED_DISCLAIMER}`;
  }
}

/** Label for the evidence item or export column that carries `irsStandingSummary`. */
export const IRS_STANDING_EVIDENCE_LABEL = "IRS automatic revocation list / Publication 78";

/* ---------------------------------------------------------- apply section */

/**
 * Which return the application details in the section come from. `fy` is the
 * fiscal year of that return (funder.application.fy). Empty when the section
 * shows no application details at all, so the note never points at nothing.
 */
function applicationDetailsFrom(fy: number | null | undefined, hasDetails: boolean): string {
  if (!hasDetails) return "";
  return fy ? ` The application details below come from its FY${fy} return.` : " The application details below come from its latest return on file.";
}

/**
 * The sentence above the posture explainer in "Can I apply?" when the standing
 * is "revoked". It states the IRS record and its date, and nothing else: it
 * does not say what the reader should do. Pass `hasDetails = false` when the
 * section has no application details to point at.
 */
export function irsRevokedApplyNote(s: IrsStanding, fy: number | null | undefined, hasDetails = true): string {
  const first =
    `The IRS automatically revoked this organization's tax-exempt status on ${formatDate(s.effectiveRevocationDate)} ` +
    `(${revocationListRef(s)}).`;
  return `${first}${applicationDetailsFrom(fy, hasDetails)}`;
}

/**
 * The same place, when the IRS lists disagree: one list shows an automatic
 * revocation with no reinstatement after it, and another list still names the
 * organization. Both facts, each with its list and that list's date. We do
 * not choose between them.
 */
export function irsListsDisagreeApplyNote(s: IrsStanding, fy: number | null | undefined, hasDetails = true): string {
  const listedOn =
    s.inBmf && s.onPub78
      ? `The ${masterFileRef(s)} and ${pub78Ref(s)} list this organization.`
      : s.inBmf
        ? `The ${masterFileRef(s)} lists this organization.`
        : `${pub78Ref(s)} lists this organization.`;
  const older = irsOlderCopyNote(s);
  const first =
    `The IRS lists disagree about this organization. The ${revocationListRef(s)} shows an automatic revocation on ` +
    `${formatDate(s.effectiveRevocationDate)} and no reinstatement after it. ${listedOn} ${older ? `${older} ` : ""}${IRS_LISTS_DISAGREE_CLOSING}`;
  return `${first}${applicationDetailsFrom(fy, hasDetails)}`;
}

/* ------------------------------------------------------------- the basics */

export const IRS_STANDING_BASICS_LABEL = "IRS standing";
export const PUB78_CLASS_LABEL = "Deductibility class (Pub 78)";

/**
 * IRS deductibility status codes, in the IRS's own words (the table on
 * IRS_DEDUCTIBILITY_CODES_URL, read 2026-10-08). The percentage limits in
 * that table are left out on purpose: they are tax rules that change, and
 * they are not what a fundraiser needs from this row.
 */
export const PUB78_CODE_LABELS: Record<string, string> = {
  PC: "A public charity",
  POF: "A private operating foundation",
  PF: "A private foundation",
  GROUP:
    "Generally, a central organization holding a group exemption letter, whose subordinate units covered by the group " +
    "exemption are also eligible to receive tax-deductible contributions, even though they are not separately listed",
  LODGE:
    "A domestic fraternal society, operating under the lodge system, but only if the contribution is to be used " +
    "exclusively for charitable purposes",
  UNKWN: "A charitable organization whose public charity status has not been determined",
  EO: "An organization described in section 170(c) of the Internal Revenue Code other than a public charity or a private foundation",
  FED: "An organization to which contributions are deductible if made for the use of a federal governmental unit",
  FORGN:
    "A foreign-addressed organization. These are generally organizations formed in the United States that conduct " +
    "activities in foreign countries. Certain foreign organizations that receive charitable contributions deductible " +
    "pursuant to treaty are also included, as are organizations created in U.S. possessions.",
  SO: "A type 1, type 2 or functionally integrated type 3 supporting organization",
  SONFI: "A non-functionally integrated type 3 supporting organization",
  SOUNK: "A supporting organization, unspecified type",
};

/** "A public charity (PC)". A code the table does not know is shown as the raw code. */
export function pub78CodeLabel(code: string): string {
  const key = code.trim().toUpperCase();
  const label = PUB78_CODE_LABELS[key];
  return label ? `${label} (${key})` : key;
}

/** Every code on the row, in file order. Empty array when the organization is not on Publication 78. */
export function pub78ClassLabels(s: IrsStanding): string[] {
  return s.onPub78 ? s.pub78Codes.map(pub78CodeLabel) : [];
}

/** Text for the "Deductibility class (Pub 78)" row. */
export function pub78ClassText(s: IrsStanding): string {
  const labels = pub78ClassLabels(s);
  if (labels.length > 0) return `${labels.join("; ")}. ${IRS_PUB78_NAME} ${irsListDate(s.pub78AsOf, s.pub78AsOfKind)}.`;
  return `Not on ${pub78Ref(s)}. Many eligible organizations are not on it.`;
}

/* ----------------------------------------------------------- search filter */

/** The visible label over the control. */
export const STANDING_FILTER_FIELD_LABEL = IRS_STANDING_TITLE;

/** The two choices. "Any" is the default: nothing is hidden unless the reader asks. */
export const STANDING_FILTER_OPTION_ANY = "Any";
export const STANDING_FILTER_OPTION_HIDE_REVOKED = "Hide automatically revoked";

/** The long form of the second choice, for a screen reader or a tooltip. */
export const STANDING_FILTER_LABEL = "Hide organizations the IRS automatically revoked";

/** The removable chip a search shows while the filter is on. */
export const STANDING_FILTER_CHIP = "Automatically revoked: hidden";

/** Shown above the results while the filter is on: what was left out, and what was kept. */
export const STANDING_FILTER_NOTE =
  "This hides organizations that the IRS automatically revoked for filing no return for three years, that the IRS list " +
  "does not show as reinstated, and that are on no other IRS list we hold. Organizations where the IRS lists disagree " +
  "stay in the results, with both facts shown.";

/** Shown when the reader asked for the filter and the IRS lists cannot be read. Nothing was hidden, and we say so. */
export const STANDING_FILTER_UNAVAILABLE_NOTE =
  "The IRS standing filter is not available right now, so no organization was hidden.";

/* ------------------------------------------------------------- popover ui */

export const IRS_STANDING_FACT_LABELS = {
  revocationDate: "Revocation date",
  revocationDateAsListed: "Date on the IRS list",
  postingDate: "Posted to the IRS list",
  reinstatementDate: "Reinstatement date",
  reinstatementNotCounted: "Reinstatement date on the list (before this revocation)",
  pub78Class: "Deductibility class",
  record: "Record",
} as const;
