import dotenv from 'dotenv';
import { gscEncryptionKeyFromString } from './encryption.js';

export interface GscConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
}

/**
 * Resolves GSC configuration from the environment. GSC is only enabled when
 * every value is present (including a usable AES-256 token-encryption key), so
 * the product can honestly report a disconnected state instead of fabricating
 * data. Reads process.env directly (re-running dotenv) so credentials set after
 * startup are picked up, mirroring the Reddit provider pattern.
 */
export function gscConfig(): GscConfig | null {
  dotenv.config();
  const clientId = process.env.GSC_CLIENT_ID?.trim();
  const clientSecret = process.env.GSC_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GSC_REDIRECT_URI?.trim();
  const encryptionKey = gscEncryptionKeyFromString(process.env.GSC_TOKEN_ENCRYPTION_KEY);
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
    return null;
  }
  return { clientId, clientSecret, redirectUri, encryptionKey };
}