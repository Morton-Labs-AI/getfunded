// @vitest-environment node
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  EXPORT_FILES,
  EXPORT_SCHEMA_VERSION,
  buildWorkspaceExport,
  exportEntries,
  exportFilename,
  exportZip,
  type WorkspaceExportInput,
} from "@/lib/settings/export";
import { crc32, createZip, dosDateTime, readZipDirectory, readZipEntryBytes } from "@/lib/settings/zip";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORG = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-07T15:04:05.000Z");

function input(): WorkspaceExportInput {
  return {
    workspace: {
      id: WS,
      slug: "demo-food-bank",
      name: "Demo Food Bank",
      plan: "free",
      profile: { mission: "Placeholder mission", state: "OR" },
      settings: {},
      created_at: new Date("2026-01-02T03:04:05Z"),
    },
    members: [{ user_id: USER, role: "owner", email: "owner@example.org", display_name: "Owner", joined_at: new Date("2026-01-02T03:04:05Z") }],
    saved_funders: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        org_id: ORG,
        snapshot: { name: "Placeholder Foundation", ein: "000000000", orgType: "private_foundation", city: "Portland", state: "OR" },
        stage: "researching",
        tier: 2,
        owner_id: USER,
        ask_amount: "25000",
        next_action: "Call program officer",
        next_action_due: "2026-11-01",
        source_detail: "Found via search",
        tags: ["food", "regional"],
        archived_at: null,
        created_at: new Date("2026-02-01T00:00:00Z"),
        updated_at: new Date("2026-02-02T00:00:00Z"),
      },
    ],
    tasks: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        saved_funder_id: "55555555-5555-4555-8555-555555555555",
        title: "Draft LOI",
        details: null,
        due_date: new Date("2026-10-20T00:00:00Z"),
        assignee_id: USER,
        status: "open",
        completed_at: null,
        created_by: USER,
        created_at: new Date("2026-02-03T00:00:00Z"),
        updated_at: new Date("2026-02-03T00:00:00Z"),
      },
    ],
    activities: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        saved_funder_id: "55555555-5555-4555-8555-555555555555",
        kind: "note",
        body: "Spoke with the program officer.",
        occurred_at: new Date("2026-02-04T10:00:00Z"),
        created_by: USER,
        meta: {},
        created_at: new Date("2026-02-04T10:00:00Z"),
      },
    ],
    stage_history: [
      {
        id: "1",
        saved_funder_id: "55555555-5555-4555-8555-555555555555",
        from_stage: "identified",
        to_stage: "researching",
        changed_by: USER,
        note: null,
        created_at: new Date("2026-02-02T00:00:00Z"),
      },
    ],
    exported_by: { user_id: USER, email: "owner@example.org" },
    exported_at: NOW,
  };
}

describe("buildWorkspaceExport", () => {
  it("produces the documented shape with ISO dates and numbers", () => {
    const data = buildWorkspaceExport(input());
    expect(data.schema_version).toBe(EXPORT_SCHEMA_VERSION);
    expect(data.generator).toBe("getfunded");
    expect(data.exported_at).toBe("2026-10-07T15:04:05.000Z");
    expect(data.exported_by).toEqual({ user_id: USER, email: "owner@example.org" });
    expect(Object.keys(data.data_classes)).toEqual(["yours", "source", "ai"]);
    expect(data.truncated).toEqual([]);
    expect(data.workspace).toEqual({
      id: WS,
      slug: "demo-food-bank",
      name: "Demo Food Bank",
      plan: "free",
      profile: { mission: "Placeholder mission", state: "OR" },
      settings: {},
      created_at: "2026-01-02T03:04:05.000Z",
    });
    expect(data.members).toEqual([
      { user_id: USER, role: "owner", email: "owner@example.org", display_name: "Owner", joined_at: "2026-01-02T03:04:05.000Z" },
    ]);
    expect(data.counts).toEqual({ saved_funders: 1, tasks: 1, activities: 1, stage_history: 1 });

    const funder = data.saved_funders[0];
    expect(funder.ask_amount).toBe(25_000);
    expect(funder.next_action_due).toBe("2026-11-01");
    expect(funder.archived_at).toBeNull();
    expect(funder.created_at).toBe("2026-02-01T00:00:00.000Z");
    expect(funder.snapshot).toMatchObject({ name: "Placeholder Foundation", ein: "000000000" });

    expect(data.tasks[0].due_date).toBe("2026-10-20");
    expect(data.tasks[0].completed_at).toBeNull();
    expect(data.activities[0].occurred_at).toBe("2026-02-04T10:00:00.000Z");
    expect(data.stage_history[0].id).toBe(1);
  });

  it("never invents values: missing fields are null or empty, not zero", () => {
    const i = input();
    i.saved_funders[0].ask_amount = null;
    i.saved_funders[0].tags = null;
    i.workspace.profile = undefined;
    const data = buildWorkspaceExport(i);
    expect(data.saved_funders[0].ask_amount).toBeNull();
    expect(data.saved_funders[0].tags).toEqual([]);
    expect(data.workspace.profile).toEqual({});
    expect(JSON.stringify(data)).not.toContain('"ask_amount":0');
  });

  it("carries the truncation note through to the README", () => {
    const data = buildWorkspaceExport({ ...input(), truncated: ["activities"] });
    const readme = exportEntries(data).find((e) => e.name === "README.txt");
    expect(String(readme?.data)).toMatch(/activities were cut at 20,000 rows/);
  });
});

describe("exportEntries / exportZip", () => {
  it("writes one JSON file per table plus a README, in order", () => {
    const entries = exportEntries(buildWorkspaceExport(input()));
    expect(entries.map((e) => e.name)).toEqual([...EXPORT_FILES]);
    const workspaceJson = JSON.parse(String(entries[1].data));
    expect(workspaceJson.workspace.name).toBe("Demo Food Bank");
    expect(workspaceJson.saved_funders).toBeUndefined();
    const funders = JSON.parse(String(entries[3].data));
    expect(Array.isArray(funders)).toBe(true);
    expect(funders[0].org_id).toBe(ORG);
  });

  it("produces a ZIP whose entries inflate back to the JSON", () => {
    const data = buildWorkspaceExport(input());
    const zip = exportZip(data);
    const dir = readZipDirectory(zip);
    expect(dir.map((d) => d.name)).toEqual([...EXPORT_FILES]);
    for (const entry of dir) {
      const raw = readZipEntryBytes(zip, entry);
      const bytes = entry.method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
      expect(bytes.length).toBe(entry.size);
      expect(crc32(bytes)).toBe(entry.crc32);
    }
    const funders = dir.find((d) => d.name === "saved_funders.json")!;
    const text = new TextDecoder().decode(new Uint8Array(inflateRawSync(readZipEntryBytes(zip, funders))));
    expect(JSON.parse(text)[0].stage).toBe("researching");
  });

  it("names the file after the slug and the export day", () => {
    expect(exportFilename("demo-food-bank", NOW)).toBe("getfunded-demo-food-bank-2026-10-07.zip");
    expect(exportFilename("Weird Slug!!", NOW)).toBe("getfunded-weird-slug-2026-10-07.zip");
    expect(exportFilename("", NOW)).toBe("getfunded-workspace-2026-10-07.zip");
  });
});

describe("zip writer", () => {
  it("stores incompressible data and deflates compressible data", () => {
    const random = new Uint8Array(512);
    for (let i = 0; i < random.length; i++) random[i] = (i * 7919 + 13) % 256;
    const zip = createZip([
      { name: "a.txt", data: "x".repeat(10_000) },
      { name: "r.bin", data: random },
    ]);
    const dir = readZipDirectory(zip);
    expect(dir[0].method).toBe(8);
    expect(dir[0].compressedSize).toBeLessThan(dir[0].size);
    expect(dir[1].size).toBe(512);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });
  it("refuses empty and duplicate names and strips path tricks", () => {
    expect(() => createZip([{ name: "", data: "" }])).toThrow();
    expect(() => createZip([{ name: "a", data: "" }, { name: "a", data: "" }])).toThrow();
    const zip = createZip([{ name: "../../etc/passwd", data: "nope" }]);
    expect(readZipDirectory(zip)[0].name).toBe("etc/passwd");
  });
  it("crc32 matches the reference value for 'The quick brown fox...'", () => {
    const bytes = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    expect(crc32(bytes)).toBe(0x414fa339);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it("encodes DOS dates and clamps before 1980", () => {
    const { date, time } = dosDateTime(new Date(2026, 9, 7, 15, 4, 6));
    expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 7);
    expect(time).toBe((15 << 11) | (4 << 5) | 3);
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });
});
