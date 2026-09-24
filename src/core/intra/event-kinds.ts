/**
 * The Intra's event types (data/event_types.json, `display`) in the current
 * language. The display names arrive as data, so t() cannot see them: the
 * known ones are marked here with msg(), and an unknown type (a new one the
 * Intra adds) shows as the data wrote it.
 *
 * Used by the hub's Event visibility setting and the Agenda card's filter.
 */
import { msg, t } from "../i18n/i18n.ts";

const KNOWN: Readonly<Record<string, string>> = {
  exam: msg("Exam"),
  conference: msg("Conference"),
  workshop: msg("Workshop"),
  hackathon: msg("Hackathon"),
  event: msg("Event"),
  meet_up: msg("Meet up"),
};

/** The label of event type `kind`, whose display name in the data is `display`. */
export function eventKindLabel(kind: string, display?: string): string {
  // own keys only: a type named "constructor" is data, not Object's
  return Object.hasOwn(KNOWN, kind) ? t(KNOWN[kind]) : (display ?? kind);
}
