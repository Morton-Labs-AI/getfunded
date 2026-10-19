"use client";

import { useState } from "react";
import { Section } from "@/components/page-primitives";
import { CategoryRule, TrichotomyBadge } from "@/components/trichotomy-badge";
import { evidenceExamples, type EvidenceExample } from "@/lib/demo/evidence-examples";
import styles from "./evidence-comparison.module.css";

type View = "compare" | "before" | "after";

function Arrow() {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SourceRef({ record, source }: { record: EvidenceExample; source: string }) {
  const index = record.sources.findIndex((item) => item.id === source);
  return <a className={styles.sourceRef} href={`#evidence-${record.id}-${source}`} aria-label={`See evidence ${index + 1}: ${record.sources[index].title}`}>E{index + 1}<Arrow /></a>;
}

/** Uses the original profile's header anatomy, badges, category rule and
 * Section primitive. The live org route and its queries are left untouched.
 * Missing financials here mean "not loaded in this demo", not missing in DB.
 */
function BaselineProfile({ record }: { record: EvidenceExample }) {
  return (
    <section className={styles.baselinePanel} aria-labelledby="before-title">
      <div className={styles.panelLabel}><span>01 / BEFORE</span><span>Existing Greenbook</span></div>
      <div className={styles.baselineBody}>
        <header className="pt-2">
          <span className="mono-label">{record.location}</span>
          <h2 id="before-title" className="mt-2 text-[26px] font-[650] leading-8 tracking-[-0.02em] text-ink-1">{record.name}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TrichotomyBadge orgType="public_charity" />
            <span className="rounded-[5px] border border-border-1 bg-inset px-2 py-[3px] font-mono text-[10.5px] text-ink-2">EIN {record.ein}</span>
            <a href={record.website} target="_blank" rel="noreferrer" className="text-[12.5px] text-accent hover:text-accent-hover">website ↗</a>
          </div>
          <div className="mt-5"><CategoryRule orgType="public_charity" /></div>
        </header>

        <section className="border-b border-border-1 py-6" aria-label="Financial baseline">
          <div className="grid grid-cols-3 gap-4">
            {["assets", "income", "revenue"].map((label) => <div key={label} className="flex flex-col gap-1"><span className="mono-label">{label}</span><span className="text-[30px] font-[620] leading-9 text-ink-3" aria-label={`${label}: not loaded`}>—</span></div>)}
          </div>
          <p className={styles.baselineNote}>Financial figures are not loaded in this local preview.</p>
        </section>

        <Section title="Organization">
          <dl className={styles.baselineFacts}>
            <div><dt>Registry record</dt><dd>501(c)(3) public charity</dd></div>
            <div><dt>Location</dt><dd>{record.location}</dd></div>
            <div><dt>Identifier</dt><dd className="font-mono">{record.ein}</dd></div>
            <div><dt>Candidate website</dt><dd><a href={record.website} target="_blank" rel="noreferrer">{new URL(record.website).hostname}<Arrow /></a></dd></div>
          </dl>
        </Section>

        <Section title="Program guidance">
          <p className="text-[13.5px] leading-relaxed text-ink-3">Current program terms are not included in this baseline snapshot. Follow the website to research eligibility, timing and how to inquire.</p>
          <a href={record.website} target="_blank" rel="noreferrer" className={styles.legacyLink}>Visit website <Arrow /></a>
        </Section>

        <div className={styles.baselineFoot}>
          <span className="mono-label">The starting point</span>
          <p>A record and a source to investigate.</p>
          <details>
            <summary>About this baseline</summary>
            <p>This is the existing profile layout with locally available registry fields, not a complete historical database read. Greenbook already supports filing provenance and human-confirmed website facts. Live financials, grant history and contacts are not loaded here.</p>
          </details>
        </div>
      </div>
    </section>
  );
}

function EnhancedProfile({ record }: { record: EvidenceExample }) {
  return (
    <section className={styles.enhancedPanel} data-tone={record.tone} aria-labelledby="after-title">
      <div className={styles.panelLabel}><span>02 / AFTER</span><span>Evidence-led preview</span></div>
      <div className={styles.enhancedBody}>
        <header className={styles.recordHeader}>
          <div className={styles.recordTop}><span className={styles.eyebrow}>{record.program}</span><span className={styles.draftBadge}>Local draft</span></div>
          <h2 id="after-title">{record.name}</h2>
          <div className={styles.identity}><span>{record.location}</span><span>EIN {record.ein}</span></div>
        </header>

        <div className={styles.takeaway}>
          <span className={styles.posture}><span aria-hidden="true" />{record.posture}</span>
          <h3>{record.takeaway}</h3>
          <p>{record.summary}</p>
          <span className={styles.aiLabel}>✧ AI-assisted interpretation · human review pending</span>
        </div>

        <div className={styles.checks}>
          <div><span className={styles.microLabel}>Website check</span><strong><span className={styles.checkDot} aria-hidden="true" />Reachable</strong><small>Saved check · 19 Oct 2026</small></div>
          <div><span className={styles.microLabel}>Dated content</span><strong>{record.update}</strong><small>Whole-site update: unknown</small></div>
          <div><span className={styles.microLabel}>Evidence</span><strong>{record.sources.length} source {record.sources.length === 1 ? "view" : "views"}</strong><a href={`#sources-${record.id}`}>Inspect the evidence ↓</a></div>
        </div>

        <section className={styles.fitSection} aria-labelledby={`fit-${record.id}`}>
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>01 / FIT</span><h3 id={`fit-${record.id}`}>Are we a fit?</h3></div><SourceRef record={record} source={record.fitSource} /></div>
          <p className={styles.sectionIntro}>Start with the program’s published criteria.</p>
          <dl className={styles.fitFacts}>
            <div><dt>Where the work happens</dt><dd>{record.scope}</dd></div>
            <div><dt>Who can apply</dt><dd>{record.eligibility}</dd></div>
          </dl>
          <div className={styles.focusList} aria-label="Funding focus">{record.focus.map((item) => <span key={item}>{item}</span>)}</div>
          <p className={styles.fitDisclaimer}>This describes program fit. It is not a claim that the funder is interested in your organization.</p>
        </section>

        <section className={styles.inquirySection} aria-labelledby={`inquire-${record.id}`}>
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>02 / NEXT STEP</span><h3 id={`inquire-${record.id}`}>How do we inquire?</h3></div><span className={styles.readOnly}>Guidance, not outreach</span></div>
          <ol className={styles.steps}>{record.steps.map((step, index) => <li key={step.title}>
            <span className={styles.stepNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <div><div className={styles.stepTitle}><h4>{step.title}</h4><SourceRef record={record} source={step.source} /></div><p>{step.detail}</p></div>
          </li>)}</ol>
          <a className={styles.primaryLink} href={record.sources.find((item) => item.id === record.fitSource)!.url} target="_blank" rel="noreferrer">View official program guidance <Arrow /></a>
        </section>

        <aside className={styles.cautionBox}>
          <span className={styles.cautionIcon} aria-hidden="true">!</span>
          <div><h3>Before you invest time</h3><p>{record.caution}</p></div>
        </aside>

        <section className={styles.evidenceSection} id={`sources-${record.id}`} aria-labelledby={`evidence-title-${record.id}`}>
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>03 / THE RECEIPTS</span><h3 id={`evidence-title-${record.id}`}>Evidence you can inspect.</h3></div></div>
          <p className={styles.sectionIntro}>Original research paraphrases, tied to specific sources.</p>
          <div className={styles.sourceCards}>{record.sources.map((source, index) => <article className={styles.sourceCard} id={`evidence-${record.id}-${source.id}`} key={source.id}>
            <span className={styles.evidenceNumber}>E{index + 1}</span>
            <div><a className={styles.sourceTitle} href={source.url} target="_blank" rel="noreferrer">{source.title}<Arrow /></a><p className={styles.sourceHost}>{new URL(source.url).hostname} · publisher website</p>
              <details><summary>Check date & provenance</summary><dl className={styles.provenance}><div><dt>Observed</dt><dd>{source.observed}</dd></div><div><dt>Snapshot SHA-256 prefix</dt><dd>{source.fingerprint ? <code>{source.fingerprint}</code> : "Not available for this view"}</dd></div><div><dt>Review status</dt><dd>Agent-reviewed · not human-approved</dd></div></dl><p className={styles.sourceNote}>{source.note}</p></details>
            </div>
          </article>)}</div>
          <details className={styles.unknowns}><summary>Still to verify <span>{record.unknowns.length} open questions</span></summary><ul>{record.unknowns.map((item) => <li key={item}>{item}</li>)}</ul><p>{record.dateNote}</p></details>
        </section>
        <footer className={styles.enhancedFoot}><span className={styles.draftDot} aria-hidden="true" />Staged locally · not applied to the database · not a verified profile</footer>
      </div>
    </section>
  );
}

export function EvidenceComparison() {
  const [selectedId, setSelectedId] = useState(evidenceExamples[0].id);
  const [view, setView] = useState<View>("compare");
  const record = evidenceExamples.find((item) => item.id === selectedId)!;
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div><div className={styles.heroEyebrow}><span />GREENBOOK / ENHANCEMENT PREVIEW</div><h1>From a record<br />to a <em>next step.</em></h1></div>
        <div className={styles.heroAside}><span className={styles.snapshotLabel}>RESEARCH SNAPSHOT / 19 OCT 2026</span><p>The same organization, with a clearer picture of fit, timing and how to inquire.</p><span className={styles.previewBadge}>Preview only · review pending</span></div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.examplePicker}><label htmlFor="evidence-example">Explore an example</label><select id="evidence-example" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{evidenceExamples.map((item) => <option key={item.id} value={item.id}>{item.shortName}</option>)}</select></div>
        <div className={styles.viewSwitch} role="group" aria-label="Comparison view">{([['compare', 'Compare'], ['before', 'Before'], ['after', 'After']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</div>
      </div>

      <div className={styles.comparison} data-view={view}>
        {view !== "after" ? <BaselineProfile record={record} /> : null}
        {view !== "before" ? <EnhancedProfile key={record.id} record={record} /> : null}
      </div>
      <footer className={styles.pageFoot}><strong>What changed?</strong><span>Filing history remains the foundation. This adds current program guidance, visible uncertainty and a supported next step.</span><span className={styles.pageFootNote}>Local baseline + staged research. No live database read, model call or application submission.</span></footer>
    </div>
  );
}
