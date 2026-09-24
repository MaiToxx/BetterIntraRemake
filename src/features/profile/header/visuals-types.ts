/**
 * The shape of a user's profile visuals, as stored locally, cached per login
 * and published through the cloud API.
 *
 * WHY a module of its own: account.ts fetches these, visuals-sanitize.ts
 * cleans them, visuals.ts and the editor apply them. When the type lived in
 * visuals.ts, every one of those modules pointed back at the module that
 * imports them, and the header was one big import cycle. This file depends
 * on nothing at run time, so every edge towards it points one way.
 */
import type { PublicLook } from "../../customize/public-look.ts";

export interface VisualUrls {
  avatar: string;
  banner: string;
  bannerMode: string;
  bannerColor?: string;
  background: string;
  backgroundMode: string;
  backgroundColor?: string;
  avatarBg?: string;
  decoration?: string;
  avatarPosX?: number;
  avatarPosY?: number;
  avatarScale?: number;
  badgeBg?: string;
  theme?: { profileColor?: string } | null;
  logtime?: {
    calendarColor?: string;
    labelsColor?: string;
    emoji?: string;
    emojiDivisor?: string | number;
    rainbowPalette?: string;
  } | null;
  /** Look (accent, palette, background, cards) published by this user. */
  look?: PublicLook | null;
  /** Raw PROFILE_PUB_* settings published by this user (validated when applied). */
  extras?: Record<string, unknown> | null;
}
