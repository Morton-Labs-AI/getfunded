import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sealing for Gmail refresh tokens: AES-256-GCM with `SECRETS_KEY`, node:crypto
 * only. The three parts (ciphertext, iv, auth tag) are stored in their own
 * columns of `getfunded.secrets`, and the app role can read them only through
 * the `getfunded.read_secret()` door.
 *
 * Why encrypt data that already sits in our own database: a refresh token is
 * standing send-as-you authority over a real person's mailbox. A routine
 * database dump or backup must be inert without the key, which lives only in
 * the environment. GCM (authenticated) rather than CBC so a tampered row is
 * refused outright instead of decrypting to plausible garbage.
 *
 * This module is pure: it takes the key as an argument (or reads it from an
 * env object) and never touches the database.
 */

export const IV_BYTES = 12;
export const TAG_BYTES = 16;
/** Bump when the key derivation or layout changes; stored on every row. */
export const KEY_VERSION = 1;

export type Env = Record<string, string | undefined>;

export type SealedSecret = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
};

export class SecretsKeyError extends Error {
  readonly code = "secrets_key" as const;
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = "SecretsKeyError";
  }
}

/** True when `SECRETS_KEY` is set and decodes to 32 bytes. */
export function isSecretsConfigured(env: Env = process.env): boolean {
  try {
    secretsKey(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * The 32-byte key from `SECRETS_KEY` (base64). A missing key is a hard
 * failure, never a silent downgrade to plaintext; the connect flow checks this
 * before sending anyone to Google so the failure lands at setup time.
 */
export function secretsKey(env: Env = process.env): Buffer {
  const raw = env.SECRETS_KEY?.trim();
  if (!raw) {
    throw new SecretsKeyError(
      "SECRETS_KEY is not set. Generate one with `openssl rand -base64 32` and add it to the environment before connecting Gmail.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new SecretsKeyError(`SECRETS_KEY must decode to exactly 32 bytes; it decodes to ${key.length}.`);
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): SealedSecret {
  if (key.length !== 32) throw new SecretsKeyError("The encryption key must be 32 bytes.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: KEY_VERSION };
}

/** Throws `SecretsKeyError` on a wrong key, a tampered row, or a malformed one. */
export function decryptSecret(sealed: Omit<SealedSecret, "keyVersion"> & { keyVersion?: number }, key: Buffer): string {
  if (key.length !== 32) throw new SecretsKeyError("The encryption key must be 32 bytes.");
  const iv = Buffer.from(sealed.iv);
  const tag = Buffer.from(sealed.tag);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretsKeyError("The stored secret is malformed and cannot be decrypted.");
  }
  if (sealed.keyVersion !== undefined && sealed.keyVersion !== KEY_VERSION) {
    throw new SecretsKeyError(`The stored secret uses key version ${sealed.keyVersion}; this build reads version ${KEY_VERSION}.`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext)), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretsKeyError("The stored secret could not be decrypted. Check SECRETS_KEY, then reconnect Gmail.");
  }
}
