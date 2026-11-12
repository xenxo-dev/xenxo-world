/**
 * Quedadas (apps/realtime/src/meetups.ts): las anuncia moderación y llegan con el arranque (/boot).
 * Aquí, cuál toca enseñar, si ya ha empezado y el archivo para añadirla al calendario (.ics), que se
 * hace en el navegador: nada va a ningún sitio.
 */
import { authedApi } from "./account";
import { loadBoot, useBoot } from "./boot";

export type MeetupText = { es: string; en: string };

export interface Meetup {
  id: number;
  starts_at: number;
  ends_at: number;
  /** `plaza` o el id de un distrito. */
  place: string;
  spot: string | null;
  title: MeetupText;
  about: MeetupText;
  jam: string | null;
}

/** Se puede entrar un rato antes de la hora. */
export const MEETUP_EARLY_MS = 15 * 60_000;

/** La quedada que se enseña: la que está en marcha o, si no, la más próxima. */
export function nextMeetup(list: readonly Meetup[], now = Date.now()): Meetup | null {
  const open = list.filter((m) => m.ends_at > now).sort((a, b) => a.starts_at - b.starts_at);
  return open[0] ?? null;
}

/** ¿Ya se puede ir? (Desde un poco antes de la hora hasta que acaba.) */
export const meetupOn = (m: Meetup, now = Date.now()) => now >= m.starts_at - MEETUP_EARLY_MS && now < m.ends_at;

export function useMeetups(): Meetup[] {
  return useBoot()?.meetups ?? [];
}

/** Fecha del .ics (UTC, sin separadores). */
const icsDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Texto del .ics: sin saltos de línea sueltos ni los caracteres que lo romperían. */
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** El archivo de calendario de una quedada, en el idioma de quien lo baja. */
export function meetupIcs(m: Meetup, lang: "es" | "en", where: string, link: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//xenxo//quedadas//ES",
    "BEGIN:VEVENT",
    `UID:meetup-${m.id}@xenxo.io`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(m.starts_at)}`,
    `DTEND:${icsDate(m.ends_at)}`,
    `SUMMARY:${icsText(`${m.title[lang]} · xenxo`)}`,
    `DESCRIPTION:${icsText(`${m.about[lang] ? `${m.about[lang]}\n\n` : ""}${link}`)}`,
    `LOCATION:${icsText(`xenxo.io · ${where}`)}`,
    `URL:${link}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export interface MeetupInput {
  starts_at: number;
  ends_at?: number;
  place: string;
  spot?: string | null;
  title: MeetupText;
  about?: MeetupText;
  jam?: string | null;
}

export async function modCreateMeetup(m: MeetupInput) {
  const r = await authedApi<{ meetup: Meetup }>("POST", "/mod/meetups", m);
  await loadBoot(0);
  return r;
}

export async function modCancelMeetup(id: number) {
  const r = await authedApi<{ cancelled: number }>("DELETE", `/mod/meetups/${id}`);
  await loadBoot(0);
  return r;
}
