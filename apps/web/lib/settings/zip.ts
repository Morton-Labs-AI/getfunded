/**
 * A minimal ZIP writer for the workspace export (PKZIP APPNOTE 4.4.x):
 * local file headers, DEFLATE entries through node:zlib, a central directory
 * and the end-of-central-directory record. No external dependency, no
 * streaming, no ZIP64 (the export is a few megabytes at most; callers cap it).
 *
 * Pure: bytes in, bytes out. tests/unit/settings/export.test.ts reads the
 * central directory back and inflates every entry.
 */
import { deflateRawSync } from "node:zlib";

export type ZipEntry = {
  /** Forward-slash path inside the archive, e.g. "saved_funders.json". */
  name: string;
  data: Uint8Array | string;
  /** Defaults to `now`. */
  mtime?: Date;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time fields, as ZIP stores them (local time, 2 s resolution). */
export function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}
function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function sanitiseName(name: string): string {
  const cleaned = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== "." && part !== "..")
    .join("/");
  if (cleaned.length === 0) throw new Error("zip: entry name is empty");
  return cleaned;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const VERSION = 20; // 2.0: DEFLATE
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;
const METHOD_STORE = 0;

/** Build a ZIP archive. Entries are DEFLATEd unless storing is smaller. */
export function createZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    const name = sanitiseName(entry.name);
    if (seen.has(name)) throw new Error(`zip: duplicate entry ${name}`);
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const raw = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const deflated = new Uint8Array(deflateRawSync(raw, { level: 6 }));
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const crc = crc32(raw);
    const { date, time } = dosDateTime(entry.mtime ?? now);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, SIG_LOCAL);
    u16(lv, 4, VERSION);
    u16(lv, 6, FLAG_UTF8);
    u16(lv, 8, method);
    u16(lv, 10, time);
    u16(lv, 12, date);
    u32(lv, 14, crc);
    u32(lv, 18, body.length);
    u32(lv, 22, raw.length);
    u16(lv, 26, nameBytes.length);
    u16(lv, 28, 0);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, SIG_CENTRAL);
    u16(cv, 4, VERSION);
    u16(cv, 6, VERSION);
    u16(cv, 8, FLAG_UTF8);
    u16(cv, 10, method);
    u16(cv, 12, time);
    u16(cv, 14, date);
    u32(cv, 16, crc);
    u32(cv, 20, body.length);
    u32(cv, 24, raw.length);
    u16(cv, 28, nameBytes.length);
    u16(cv, 30, 0); // extra
    u16(cv, 32, 0); // comment
    u16(cv, 34, 0); // disk
    u16(cv, 36, 0); // internal attrs
    u32(cv, 38, 0); // external attrs
    u32(cv, 42, offset);
    central.set(nameBytes, 46);

    localParts.push(local, body);
    centralParts.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centralParts.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, SIG_END);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);
  u16(ev, 20, 0);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

export type ZipDirectoryEntry = {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
};

/** Read the central directory back (used by tests and by nothing in production). */
export function readZipDirectory(zip: Uint8Array): ZipDirectoryEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let endPos = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_END) {
      endPos = i;
      break;
    }
  }
  if (endPos < 0) throw new Error("zip: end of central directory not found");
  const count = view.getUint16(endPos + 10, true);
  let pos = view.getUint32(endPos + 16, true);
  const decoder = new TextDecoder();
  const out: ZipDirectoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== SIG_CENTRAL) throw new Error("zip: bad central directory entry");
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    out.push({
      method: view.getUint16(pos + 10, true),
      crc32: view.getUint32(pos + 16, true),
      compressedSize: view.getUint32(pos + 20, true),
      size: view.getUint32(pos + 24, true),
      localHeaderOffset: view.getUint32(pos + 42, true),
      name: decoder.decode(zip.subarray(pos + 46, pos + 46 + nameLen)),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The compressed bytes of one entry, located through its local header. */
export function readZipEntryBytes(zip: Uint8Array, entry: ZipDirectoryEntry): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const p = entry.localHeaderOffset;
  if (view.getUint32(p, true) !== SIG_LOCAL) throw new Error("zip: bad local header");
  const nameLen = view.getUint16(p + 26, true);
  const extraLen = view.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  return zip.subarray(start, start + entry.compressedSize);
}
