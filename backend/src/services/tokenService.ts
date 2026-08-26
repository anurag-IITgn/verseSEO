import { createHash, randomBytes } from 'node:crypto';
import { insertToken, findValidToken, consumeToken, deleteTokensByUserAndType } from '../repositories/tokenRepo.js';
import { AppError } from '../utils/errors.js';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export type TokenType = 'email_verification' | 'password_reset';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createToken(userId: string, type: TokenType): Promise<string> {
  await deleteTokensByUserAndType(userId, type);
  const plainToken = generateToken();
  const ttl = type === 'email_verification' ? EMAIL_VERIFICATION_TTL_MS : PASSWORD_RESET_TTL_MS;
  await insertToken({
    userId,
    tokenHash: hashToken(plainToken),
    type,
    expiresAt: new Date(Date.now() + ttl),
  });
  return plainToken;
}

export async function validateAndConsumeToken(plainToken: string, type: TokenType): Promise<string> {
  const tokenHash = hashToken(plainToken);
  const token = await findValidToken(tokenHash, type);
  if (!token) {
    throw new AppError(400, 'Invalid or expired token', 'INVALID_TOKEN');
  }
  if (token.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, 'Token has expired', 'TOKEN_EXPIRED');
  }
  await consumeToken(token.id);
  return token.userId;
}
