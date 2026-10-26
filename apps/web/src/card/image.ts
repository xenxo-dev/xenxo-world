/**
 * El carné como imagen (1200 × 630, el tamaño de las vistas previas de las redes): se dibuja en
 * el navegador con la foto del personaje y las fuentes empaquetadas. Sin servidor ni servicios.
 */
import type { PlayerCard } from "../net/card";

const W = 1200;
const H = 630;
const DISPLAY = '"Archivo Variable", "Inter Variable", system-ui, sans-serif';
const SANS = '"Inter Variable", system-ui, sans-serif';

export interface CardTexts {
  title: string;
  since: string;
  projects: string;
  link: string;
}

/** Recorta el texto con «…» para que quepa en `max` píxeles. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** Texto con resplandor de neón (sombra en dos pasadas). */
function neon(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, glow: string) {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 28;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 8;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export async function renderCardImage(card: PlayerCard, texts: CardTexts, avatar: HTMLCanvasElement | null): Promise<Blob> {
  await Promise.all([
    document.fonts.load(`700 120px ${DISPLAY}`),
    document.fonts.load(`600 40px ${SANS}`),
  ]).catch(() => {});

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // Fondo: la noche de la plaza con dos halos de neón.
  ctx.fillStyle = "#12142b";
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(18,20,43,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(250, 520, 420, "rgba(62,230,255,0.22)");
  glow(1050, 80, 520, "rgba(255,79,216,0.18)");

  // Marco del carné.
  ctx.strokeStyle = "rgba(246,241,231,0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(28, 28, W - 56, H - 56, 28);
  ctx.stroke();

  // Foto del personaje (la vista previa 3D en ese momento).
  if (avatar && avatar.width > 0 && avatar.height > 0) {
    const boxW = 430;
    const boxH = H - 80;
    const s = Math.min(boxW / avatar.width, boxH / avatar.height);
    const w = avatar.width * s;
    const h = avatar.height * s;
    ctx.drawImage(avatar, 50 + (boxW - w) / 2, 40 + (boxH - h) / 2, w, h);
  }

  const x = 520;
  const maxW = W - x - 70;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#f4fbff";
  ctx.font = `700 34px ${DISPLAY}`;
  neon(ctx, "xenxo.io", x, 104, "#4fa3ff");

  ctx.fillStyle = "rgba(246,241,231,0.55)";
  ctx.font = `600 22px ${SANS}`;
  ctx.fillText(texts.title.toUpperCase(), x, 160);

  ctx.fillStyle = "#9cc9ff";
  ctx.font = `700 150px ${DISPLAY}`;
  neon(ctx, `#${card.player_no}`, x - 6, 300, "#4fa3ff");

  ctx.fillStyle = "#f6f1e7";
  ctx.font = `700 60px ${DISPLAY}`;
  ctx.fillText(fit(ctx, card.name, maxW), x, 380);

  ctx.fillStyle = "rgba(246,241,231,0.7)";
  ctx.font = `500 26px ${SANS}`;
  ctx.fillText(fit(ctx, texts.since, maxW), x, 432);
  if (texts.projects) ctx.fillText(fit(ctx, texts.projects, maxW), x, 472);

  ctx.fillStyle = "#ff8fe6";
  ctx.font = `600 26px ${SANS}`;
  ctx.fillText(texts.link, x, H - 72);

  return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}
