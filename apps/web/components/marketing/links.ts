import { site } from "@/lib/site";

/**
 * Marketing-site links and addresses, in one place. Every address here is a
 * role inbox, never a person. The public steward name comes from lib/site.ts.
 */

/** A file in the repository at the default branch. */
export function repoFile(path: string): string {
  return `${site.github}/blob/main/${path.replace(/^\/+/, "")}`;
}

export const LINKS = {
  github: site.github,
  discussions: `${site.github}/discussions`,
  issues: `${site.github}/issues`,
  newBug: `${site.github}/issues/new?template=bug_report.yml`,
  dataCorrection: `${site.github}/issues/new?template=data_correction.yml`,
  security: `${site.github}/security/advisories/new`,
  roadmap: "https://github.com/orgs/Morton-Labs-AI/projects",
  releases: `${site.github}/releases`,
  changelogFile: repoFile("CHANGELOG.md"),
  license: repoFile("LICENSE"),
  dataLicense: repoFile("DATA-LICENSE.md"),
  trademark: repoFile("TRADEMARK.md"),
  governance: repoFile("GOVERNANCE.md"),
  contributing: repoFile("CONTRIBUTING.md"),
  codeOfConduct: repoFile("CODE_OF_CONDUCT.md"),
  securityPolicy: repoFile("SECURITY.md"),
  maintainers: repoFile("MAINTAINERS.md"),
  roadmapProcess: repoFile("docs/governance/ROADMAP-PROCESS.md"),
  rfcTemplate: repoFile("docs/rfcs/0000-template.md"),
  architecture: repoFile("docs/ARCHITECTURE.md"),
  plansDoc: repoFile("docs/PLANS.md"),
  corpusSelfInstall: repoFile("corpus/docs/SELF-INSTALL.md"),
  corpusDataSources: repoFile("corpus/docs/DATA-SOURCES.md"),
  corpusProvenance: repoFile("corpus/docs/PROVENANCE.md"),
  webReadme: repoFile("apps/web/README.md"),
  webAgents: repoFile("apps/web/AGENTS.md"),
  ccBy: "https://creativecommons.org/licenses/by/4.0/",
} as const;

/**
 * Role inboxes. The general address is a role mailbox on the product domain;
 * security and conduct addresses are the ones published in SECURITY.md and
 * GOVERNANCE.md.
 */
export const CONTACT = {
  general: "support@getfunded.ai",
  security: "security@mortonlabs.ai",
  conduct: "conduct@mortonlabs.ai",
} as const;

export function mailto(address: string, subject?: string): string {
  return subject ? `mailto:${address}?subject=${encodeURIComponent(subject)}` : `mailto:${address}`;
}
