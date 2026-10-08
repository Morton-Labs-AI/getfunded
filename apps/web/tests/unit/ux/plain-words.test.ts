import { describe, expect, it } from "vitest";

import { creditsLabel } from "@/components/ai/fit-actions";
import { hostOf, newsDate } from "@/components/ai/research-panel";
import { CSV_HOW_TO } from "@/components/workspace/import-wizard";
import { gmailNotice } from "@/app/(app)/app/outreach/helpers";
import { OUTREACH_COPY } from "@/lib/outreach/copy";

describe("plain words on the AI and outreach surfaces", () => {
  it("credits are spelled out, never abbreviated", () => {
    expect(creditsLabel(5)).toBe("Uses 5 credits.");
    expect(creditsLabel(1)).toBe("Uses 1 credit.");
  });

  it("the send timing names the button, not a 'send run'", () => {
    expect(OUTREACH_COPY.tabHelp.approved).toContain("when you press Send approved email now");
    expect(OUTREACH_COPY.sending.approvedToast).toBe("It goes out when you press Send approved email now.");
    expect(JSON.stringify(OUTREACH_COPY)).not.toMatch(/send run/i);
  });

  it("Gmail setup notices never show environment variable names", () => {
    for (const code of ["unconfigured", "secrets_key", "scope"]) {
      const text = gmailNotice("error", code)!.text;
      expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
      expect(text).not.toMatch(/metadata/);
    }
    expect(OUTREACH_COPY.gmail.notSetUp).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    expect(OUTREACH_COPY.gmail.noSecretsKey).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
  });

  it("the import how-to names Excel and Google Sheets", () => {
    expect(CSV_HOW_TO).toMatch(/Excel/);
    expect(CSV_HOW_TO).toMatch(/Google Sheets/);
    expect(CSV_HOW_TO).toMatch(/CSV/);
  });

  it("research panel helpers", () => {
    expect(hostOf("https://www.example.org/grants/2026")).toBe("example.org");
    expect(hostOf("not a url")).toBe("not a url");
    expect(newsDate("2026-03-01")).toBe("Mar 1, 2026");
    expect(newsDate("2026-03")).toBe("Mar 2026");
    expect(newsDate("spring 2026")).toBe("spring 2026");
  });
});
