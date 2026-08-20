import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { GscEncryptedTokenBlob, GscEncryptedTokens, GscTokenPair } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Parses GSC_TOKEN_ENCRYPTION_KEY into a 32-byte AES-256 key. Accepts 64 hex
 * characters or a base64 string that decodes to 32 bytes. Returns null when the
 * value is missing or unusable, which disables GSC storage entirely.
 */
export function gscEncryptionKeyFromString(value: string | undefined): Buffer | null {
  const trimmed = (value ?? '').trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32 && trimmed.length > 0) {
      return decoded;
    }
  } catch {
    // fall through
  }
  return null;
}

function encryptBlob(secret: Buffer, value: string): GscEncryptedTokenBlob {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, secret, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    cipher: encrypted.toString('base64'),
  };
}

function decryptBlob(secret: Buffer, blob: GscEncryptedTokenBlob): string {
  const decipher = createDecipheriv(ALGORITHM, secret, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(blob.cipher, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function encryptTokenPair(secret: Buffer, tokens: GscTokenPair): GscEncryptedTokens {
  return { accessToken: encryptBlob(secret, tokens.accessToken), refreshToken: encryptBlob(secret, tokens.refreshToken) };
}

export function decryptTokenPair(secret: Buffer, encrypted: GscEncryptedTokens): GscTokenPair {
  return {
    accessToken: decryptBlob(secret, encrypted.accessToken),
    refreshToken: decryptBlob(secret, encrypted.refreshToken),
  };
}