/**
 * Navegadores integrados de las apps (el que abre Instagram, TikTok o Facebook al tocar un enlace).
 * En ellos se puede jugar, pero crear cuenta suele fallar: Google no deja usar su inicio de sesión
 * dentro de una vista web incrustada («disallowed_useragent») y las passkeys a menudo no están
 * disponibles. Quien llega desde un vídeo llega así, por eso se avisa y se ofrece abrir xenxo en el
 * navegador de verdad. Solo se mira el identificador del navegador; nada se envía a nadie.
 */

/** El nombre de la app si esto es su navegador integrado ("" si es una app sin identificar); null si no. */
export function inAppBrowser(ua: string = navigator.userAgent): string | null {
  if (/\bBarcelona \d/.test(ua)) return "Threads";
  if (/\bInstagram\b/i.test(ua)) return "Instagram";
  if (/musical_ly|BytedanceWebview|\btrill_|TikTok/i.test(ua)) return "TikTok";
  if (/\bFBAN\/|\bFBAV\/|\bFB_IAB\/|\bFBIOS\b|MessengerForiOS|\bOrca-Android\b/.test(ua)) return "Facebook";
  if (/LinkedInApp/i.test(ua)) return "LinkedIn";
  if (/\bTwitterAndroid\b|Twitter for iPhone/i.test(ua)) return "X";
  if (/Snapchat/i.test(ua)) return "Snapchat";
  if (/MicroMessenger/i.test(ua)) return "WeChat";
  if (/\bLine\/\d/.test(ua)) return "LINE";
  if (/Pinterest/i.test(ua)) return "Pinterest";
  // Una vista web de Android sin nombre (el «; wv)» que añade el sistema).
  if (/Android/.test(ua) && /; wv\)/.test(ua)) return "";
  return null;
}

/**
 * Un enlace que abre esta misma página en el navegador del sistema: en Android, un `intent:` (lo
 * recoge el navegador por defecto); en iPhone y iPad, el esquema `x-safari-https` (Safari). Si la
 * app no lo permite, no pasa nada: queda el menú «Abrir en el navegador» de la propia app.
 */
export function openInBrowserUrl(ua: string = navigator.userAgent, href: string = location.href): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const rest = `${u.host}${u.pathname}${u.search}${u.hash}`;
  if (/Android/.test(ua)) return `intent://${rest}#Intent;scheme=https;action=android.intent.action.VIEW;end`;
  if (/iPhone|iPad|iPod/.test(ua)) return `x-safari-https://${rest}`;
  return null;
}
