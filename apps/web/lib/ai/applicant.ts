/**
 * The applicant side of every evidence package: the workspace profile
 * (`workspaces.profile`) and approved knowledge rows, rendered as "yours"
 * evidence items. Pure module so the fit engine, the draft polisher and
 * tests share one reader.
 */
import { EvidenceBuilder, clip, moneyForModel } from "./evidence";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

/** The applicant profile as stored in `workspaces.profile`, read defensively (the schema is loose). */
export type ApplicantProfile = {
  mission: string | null;
  ein: string | null;
  website: string | null;
  state: string | null;
  counties: string[];
  programAreas: string[];
  annualBudget: number | null;
  populationsServed: string[];
  keywords: string[];
};

export function readProfile(raw: unknown): ApplicantProfile {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const budget = num(p.annual_budget);
  return {
    mission: str(p.mission),
    ein: str(p.ein),
    website: str(p.website),
    state: str(p.state)?.toUpperCase() ?? null,
    counties: strList(p.counties),
    programAreas: strList(p.program_areas),
    annualBudget: budget !== null && budget >= 0 ? Math.round(budget) : null,
    populationsServed: strList(p.populations_served),
    keywords: strList(p.keywords),
  };
}

export type KnowledgeItem = { id: string; kind: string; title: string; body: string };

export type Applicant = {
  name: string;
  profile: ApplicantProfile;
  /** Only rows with approved = true may ever be passed here. */
  knowledge: KnowledgeItem[];
};

/** Add the applicant items to a builder. Returns whether the profile is effectively empty. */
export function addApplicantEvidence(b: EvidenceBuilder, applicant: Applicant): { empty: boolean } {
  const p = applicant.profile;
  const yours = { label: "Your profile" };
  const profileBits = [`Applicant: ${applicant.name}.`];
  if (p.mission) profileBits.push(`Mission: ${clip(p.mission, 1200)}`);
  b.add("applicant", "yours", "applicant_profile", profileBits.join(" "), yours);

  if (p.state || p.counties.length > 0) {
    b.add(
      "applicant",
      "yours",
      "applicant_place",
      `Applicant location: state ${p.state ?? "not stated"}` + (p.counties.length ? `; counties ${p.counties.slice(0, 20).join(", ")}` : "") + ".",
      yours,
    );
  }
  if (p.programAreas.length || p.populationsServed.length || p.keywords.length) {
    const parts: string[] = [];
    if (p.programAreas.length) parts.push(`program areas: ${p.programAreas.slice(0, 20).join(", ")}`);
    if (p.populationsServed.length) parts.push(`populations served: ${p.populationsServed.slice(0, 20).join(", ")}`);
    if (p.keywords.length) parts.push(`keywords: ${p.keywords.slice(0, 30).join(", ")}`);
    b.add("applicant", "yours", "applicant_programs", `Applicant work: ${parts.join("; ")}.`, yours);
  }
  if (p.annualBudget !== null || p.ein || p.website) {
    const parts: string[] = [];
    if (p.annualBudget !== null) parts.push(`annual budget ${moneyForModel(p.annualBudget)}`);
    if (p.ein) parts.push(`EIN ${p.ein}`);
    if (p.website) parts.push(`website ${p.website}`);
    b.add("applicant", "yours", "applicant_budget", `Applicant facts: ${parts.join("; ")}.`, yours);
  }
  for (const k of applicant.knowledge.slice(0, 30)) {
    b.add("knowledge", "yours", "knowledge_", `Approved fact (${k.kind}) "${clip(k.title, 120)}": ${clip(k.body, 600)}`, {
      label: "Approved knowledge",
    });
  }
  return { empty: !p.mission && p.programAreas.length === 0 };
}
