/**
 * The friend record the widget renders, whichever backend produced it.
 *
 * It lives in its own module so that friends.ts (storage and fetching) and
 * friends-intra.ts (the intrapy-based builder friends.ts delegates to in
 * "intra" auth mode) can both use it without importing each other: the
 * dependency now runs one way only, friends.ts -> friends-intra.ts.
 */
export interface FriendData {
  login: string;
  displayName: string;
  avatar: string | null;
  customAvatar: string | null;
  avatarBg?: string;
  avatarPosX?: number;
  avatarPosY?: number;
  avatarScale?: number;
  level: number;
  grade: string | null;
  isOnline: boolean;
  lastSeen: string | null;
  poolLabel: string | null;
  wallet: number;
  correctionPoints: number;
  lastOnlineTimestamp: number | null;
  /**
   * The end of a running freeze (the Intra's `freeze_until`), from the cursus
   * payload the level already comes from. Optional: older cached rows and the
   * dormant OAuth builder have none.
   */
  freezeUntil?: string | null;
}
