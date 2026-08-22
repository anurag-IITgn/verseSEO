import { getCurrentUser, type PublicUser } from './authService.js';
import { getRedditUsage, type RedditUsageInfo } from './redditService.js';
import { getUserScanStatus, type UserScanStatus } from './crawlService.js';
import { deleteUserById } from '../repositories/userRepo.js';
import { deleteSessionByTokenHash } from '../repositories/sessionRepo.js';
import { hashSessionToken } from '../auth/session.js';

export interface AccountResponse {
  user: PublicUser;
  plan: string;
  projectCount: number;
  totalScans: number;
  scanStatus: UserScanStatus;
  redditUsage: RedditUsageInfo;
}

export async function getAccountInfo(userId: string): Promise<AccountResponse> {
  const user = await getCurrentUser(userId);
  const scanStatus = await getUserScanStatus(userId);
  const redditUsage = await getRedditUsage(userId);

  return {
    user,
    plan: user.plan,
    projectCount: scanStatus.projectCount,
    totalScans: scanStatus.scanCount,
    scanStatus,
    redditUsage,
  };
}

export async function deleteAccount(userId: string, sessionToken: string | undefined): Promise<void> {
  if (sessionToken) {
    await deleteSessionByTokenHash(hashSessionToken(sessionToken));
  }
  await deleteUserById(userId);
}
