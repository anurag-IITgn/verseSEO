import { hashSessionToken, generateSessionToken, SESSION_TTL_MS } from '../auth/session.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { findUserByEmail, findUserById, insertUser, type User } from '../repositories/userRepo.js';
import { deleteSessionByTokenHash, findSessionByTokenHash, insertSession } from '../repositories/sessionRepo.js';
import { AppError } from '../utils/errors.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PublicUser {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  sessionToken: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertEmailValid(email: string): void {
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw new AppError(400, 'A valid email address is required', 'INVALID_EMAIL');
  }
}

function assertPasswordValid(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new AppError(400, 'Password must be between 8 and 200 characters', 'INVALID_PASSWORD');
  }
}

async function createSession(userId: string): Promise<string> {
  const sessionToken = generateSessionToken();
  await insertSession({
    userId,
    tokenHash: hashSessionToken(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sessionToken;
}

export async function register(email: string, password: string): Promise<AuthResult> {
  const normalizedEmail = normalizeEmail(email);
  assertEmailValid(normalizedEmail);
  assertPasswordValid(password);

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new AppError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
  }

  const user = await insertUser({
    email: normalizedEmail,
    passwordHash: hashPassword(password),
  });

  const sessionToken = await createSession(user.id);
  return { user: toPublicUser(user), sessionToken };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const normalizedEmail = normalizeEmail(email);

  const user = await findUserByEmail(normalizedEmail);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const sessionToken = await createSession(user.id);
  return { user: toPublicUser(user), sessionToken };
}

export async function logout(sessionToken: string | undefined): Promise<void> {
  if (!sessionToken) return;
  await deleteSessionByTokenHash(hashSessionToken(sessionToken));
}

export async function authenticateSessionToken(sessionToken: string | undefined): Promise<string | null> {
  if (!sessionToken) return null;
  const tokenHash = hashSessionToken(sessionToken);
  const session = await findSessionByTokenHash(tokenHash);
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await deleteSessionByTokenHash(tokenHash);
    return null;
  }
  return session.userId;
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await findUserById(userId);
  if (!user) {
    throw new AppError(401, 'Not authenticated', 'UNAUTHENTICATED');
  }
  return toPublicUser(user);
}