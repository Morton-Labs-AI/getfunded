import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import yauzl from "yauzl";

/**
 * Raw-XML escape hatch: resolve an object_id's member file out of the staged
 * IRS batch zip on the local disk. Read-only end to end — the DB lookup rides
 * the read pool, the filesystem access stays inside FUNDERDB_RAW_DIR (same
 * precedent as the enrichment reader), and nothing is ever written or cached.
 *
 * Primary: yauzl central-directory random access (no full scan of a 3.5GB
 * archive). Fallback: whole IRS batches use Deflate64 (method 9), which no
 * mainstream JS zip library inflates — stream `7zz e -so` stdout instead.
 */

export function rawDirRoot(): string | null {
  return process.env.FUNDERDB_RAW_DIR || null;
}

/** Map raw_files.storage_path ("data/raw/irs_990_xml/<sha12>_<batch>.zip")
    onto the local disk through FUNDERDB_RAW_DIR (which points at data/raw),
    with a containment check even though the path comes from our own DB. */
export function zipPathFor(storagePath: string): string | null {
  const root = rawDirRoot();
  if (!root) return null;
  const rel = storagePath.replace(/^\.?\/?data\/raw\//, "");
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep)) return null;
  return existsSync(abs) ? abs : null;
}

interface FoundEntry {
  fileName: string;
  compressionMethod: number;
}

function findEntry(zipPath: string, baseName: string): Promise<FoundEntry | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error("zip open failed"));
      zf.on("entry", (entry) => {
        const base = entry.fileName.split("/").pop();
        if (base === baseName) {
          const found = {
            fileName: entry.fileName,
            compressionMethod: entry.compressionMethod as number,
          };
          zf.close();
          resolve(found);
        } else {
          zf.readEntry();
        }
      });
      zf.on("end", () => resolve(null));
      zf.on("error", reject);
      zf.readEntry();
    });
  });
}

function readViaYauzl(zipPath: string, fileName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error("zip open failed"));
      zf.on("entry", (entry) => {
        if (entry.fileName !== fileName) return zf.readEntry();
        zf.openReadStream(entry, (serr, stream) => {
          if (serr || !stream) {
            zf.close();
            return reject(serr ?? new Error("stream open failed"));
          }
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c as Buffer));
          stream.on("end", () => {
            zf.close();
            resolve(Buffer.concat(chunks));
          });
          stream.on("error", (e) => {
            zf.close();
            reject(e);
          });
        });
      });
      zf.on("end", () => {
        zf.close();
        reject(new Error(`member not found: ${fileName}`));
      });
      zf.on("error", reject);
      zf.readEntry();
    });
  });
}

const SEVENZ_CANDIDATES = ["7zz", "/opt/homebrew/bin/7zz", "/usr/local/bin/7zz"];

function readVia7zz(zipPath: string, fileName: string): Promise<Buffer> {
  const tryOne = (bin: string) =>
    new Promise<Buffer>((resolve, reject) => {
      const proc = spawn(bin, ["e", "-so", zipPath, fileName], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      proc.stdout.on("data", (c) => chunks.push(c as Buffer));
      proc.on("error", reject); // ENOENT -> next candidate
      proc.on("close", (code) => {
        if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
        else reject(new Error(`7zz exited ${code}`));
      });
    });
  return SEVENZ_CANDIDATES.reduce<Promise<Buffer>>(
    (p, bin) => p.catch(() => tryOne(bin)),
    Promise.reject(new Error("start"))
  );
}

export type XmlResult =
  | { ok: true; data: Buffer; fileName: string }
  | { ok: false; status: number; message: string };

export async function extractFilingXml(
  storagePath: string,
  objectId: string
): Promise<XmlResult> {
  if (!rawDirRoot()) {
    return {
      ok: false,
      status: 404,
      message:
        "Raw XML is not staged on this machine (FUNDERDB_RAW_DIR is not set).",
    };
  }
  const zipPath = zipPathFor(storagePath);
  if (!zipPath) {
    return {
      ok: false,
      status: 404,
      message: `Staged archive not found under FUNDERDB_RAW_DIR: ${storagePath}`,
    };
  }
  const baseName = `${objectId}_public.xml`;
  let entry: FoundEntry | null;
  try {
    entry = await findEntry(zipPath, baseName);
  } catch (err) {
    return { ok: false, status: 500, message: `Could not read archive: ${err}` };
  }
  if (!entry) {
    return {
      ok: false,
      status: 404,
      message: `${baseName} is not a member of ${path.basename(zipPath)}.`,
    };
  }
  // Method 8 (deflate) / 0 (stored): yauzl streams it. Method 9 (Deflate64,
  // whole IRS batches like 2026_TEOS_XML_05A): shell out to 7zz.
  if (entry.compressionMethod === 8 || entry.compressionMethod === 0) {
    try {
      const data = await readViaYauzl(zipPath, entry.fileName);
      return { ok: true, data, fileName: baseName };
    } catch (err) {
      return { ok: false, status: 500, message: `Extraction failed: ${err}` };
    }
  }
  try {
    const data = await readVia7zz(zipPath, entry.fileName);
    return { ok: true, data, fileName: baseName };
  } catch {
    return {
      ok: false,
      status: 501,
      message:
        "This IRS batch uses Deflate64 compression; install 7-Zip " +
        "(`brew install sevenzip`) to view raw XML.",
    };
  }
}
