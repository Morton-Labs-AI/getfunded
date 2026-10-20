import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EvidenceComparison } from "@/components/demo/evidence-comparison";

export const metadata: Metadata = {
  title: "Before & after · Evidence preview · Greenbook",
  robots: { index: false, follow: false },
};

export default function EvidenceDemoPage() {
  // Staged interpretations must never become a production funder profile.
  if (process.env.NODE_ENV !== "development") notFound();
  return <EvidenceComparison />;
}
