/**
 * Quedadas: moderación anuncia un día y una hora para verse en un sitio del mundo (la plaza o un
 * distrito, y si quiere un sitio de su guía), con su texto en ES y EN y, si va con una, la jam. El
 * panel las enseña con cuenta atrás, en la hora de quien mira, con un botón para ir cuando empiezan
 * y otro para añadirla a su calendario. Son anuncios: no guardan nada de nadie, ni quién va.
 */
import { DISTRICTS } from "./districts";
import { jamText, jamTime, validJamSlug, type JamText } from "./jam";

export interface Meetup {
  id: number;
  starts_at: number;
  ends_at: number;
  /** `plaza` o el id de un distrito abierto. */
  place: string;
  /** Un sitio de su guía («Qué hacer aquí»), si se quiere llevar a la gente a uno. */
  spot: string | null;
  title: JamText;
  about: JamText;
  /** La jam que va con ella (su slug), si va con una. */
  jam: string | null;
}

export const MEETUP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meetups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    place TEXT NOT NULL,
    spot TEXT,
    title TEXT NOT NULL,
    about TEXT NOT NULL,
    jam TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

/** Si no se dice cuándo acaba, dura esto. Y como mucho, esto otro. */
export const MEETUP_DEFAULT_MS = 2 * 3_600_000;
export const MEETUP_MAX_MS = 12 * 3_600_000;
/** Hasta cuánto antes se puede anunciar. */
export const MEETUP_AHEAD_MS = 120 * 86_400_000;
/** Cuántas quedadas por venir puede haber a la vez (el panel enseña la primera). */
export const MEETUP_MAX_OPEN = 6;

/** Sitios donde se puede quedar: la plaza o un distrito del sistema abierto. */
export const meetupPlaces = (): string[] => ["plaza", ...DISTRICTS.filter((d) => !d.soon).map((d) => d.id)];

const SPOT = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type MeetupInput = Omit<Meetup, "id">;

/** Comprueba lo que manda moderación. Devuelve la quedada o el motivo. */
export function readMeetup(b: Record<string, unknown>, now = Date.now()): MeetupInput | string {
  const starts = jamTime(b.starts_at);
  if (starts === null) return "starts_at: la fecha y hora de inicio (ISO 8601 con zona horaria, o milisegundos)";
  if (starts < now - 60_000) return "la quedada tiene que ser en el futuro";
  if (starts > now + MEETUP_AHEAD_MS) return "como mucho, con 120 días de antelación";
  const ends = b.ends_at === undefined ? starts + MEETUP_DEFAULT_MS : jamTime(b.ends_at);
  if (ends === null || ends <= starts || ends - starts > MEETUP_MAX_MS) return "ends_at: después del inicio y como mucho 12 horas más tarde";
  if (typeof b.place !== "string" || !meetupPlaces().includes(b.place)) return `place: ${meetupPlaces().join(", ")}`;
  const spot = b.spot === undefined || b.spot === null || b.spot === "" ? null : typeof b.spot === "string" && SPOT.test(b.spot) ? b.spot : undefined;
  if (spot === undefined) return "spot: el id de un sitio de la guía de ese lugar";
  const title = jamText(b.title, 3, 80);
  const about = b.about === undefined ? { es: "", en: "" } : jamText(b.about, 0, 500);
  if (!title || !about) return "título (3-80) y texto (hasta 500), en ES y EN";
  const jam = b.jam === undefined || b.jam === null || b.jam === "" ? null : validJamSlug(b.jam) ? b.jam : undefined;
  if (jam === undefined) return "jam: el slug de una jam";
  return { starts_at: starts, ends_at: ends, place: b.place, spot, title, about, jam };
}
