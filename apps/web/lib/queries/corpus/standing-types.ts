/**
 * IRS standing shapes. Pure types and constants (no database import), so the
 * chip, the copy module and the search filter can use them on either side of
 * the server / client boundary. The reader is lib/queries/corpus/standing.ts.
 *
 * The values and their rules live in one place: the corpus view
 * internal.org_irs_standing (corpus/migrations/0028_irs_standing.sql).
 */
import type { Provenance } from "./types";

export const IRS_STANDINGS = ["listed", "revoked", "revoked_then_relisted", "lists_disagree", "not_listed"] as const;

/**
 *  - listed                 no revocation row; in the IRS master file or on Publication 78
 *  - revoked                automatically revoked, not reinstated, on neither other list
 *  - revoked_then_relisted  automatically revoked once; reinstated or ruled on again, and listed today
 *  - lists_disagree         on the revocation list AND listed elsewhere, with nothing that explains it
 *  - not_listed             on neither list. Never a statement that the organization has shut down.
 */
export type IrsStandingValue = (typeof IRS_STANDINGS)[number];

/** "irs_file_date": the IRS server dated the file. "retrieved": it did not, so this is the day we fetched it. */
export type IrsDateKind = "irs_file_date" | "retrieved";

/** Every date is a plain `YYYY-MM-DD` string (UTC), never a Date. */
export type IrsStanding = {
  orgId: string;
  ein: string;
  standing: IrsStandingValue;

  /** The organization's row was last written by an IRS master file load. */
  inBmf: boolean;
  /** Date of the master file that lists it. Null when it is not in the master file. */
  bmfAsOf: string | null;
  bmfAsOfKind: IrsDateKind | null;
  /** Ruling date the master file carries (month precision). Null when not in the master file. */
  bmfRulingDate: string | null;
  /** Newest copy of the master file the database holds, also when this organization is not in it. */
  masterFileAsOf: string | null;

  onPub78: boolean;
  /** IRS deductibility status codes as filed (PC, PF, POF, ...). Empty when not on Publication 78. */
  pub78Codes: string[];
  pub78AsOf: string;
  pub78AsOfKind: IrsDateKind;

  /** Latest revocation date exactly as the IRS list shows it. */
  revocationDate: string | null;
  /**
   * The date to show. Equal to `revocationDate`, except that a listed date
   * from 2020-04-01 to 2020-07-14 reads 2020-07-15, as the IRS says it should.
   */
  effectiveRevocationDate: string | null;
  /** The day the IRS posted the revocation to its list. */
  postingDate: string | null;
  /** Reinstatement date exactly as filed. It may be older than the revocation; see `reinstated`. */
  reinstatementDate: string | null;
  /** True only when `reinstatementDate` is on or after `revocationDate`. */
  reinstated: boolean;

  revocationListAsOf: string;
  revocationListAsOfKind: IrsDateKind;

  /**
   * The file the answer came from: the revocation list when a revocation row
   * exists, else the master file, else Publication 78. `objectId` is the
   * record locator inside that file; `href` is the file's own URL.
   */
  provenance: Provenance;
};
