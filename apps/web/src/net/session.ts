import { msg, type ClientMessage } from "@xenxo/protocol";
import { REALTIME_URL } from "../config";
import { WebSocketAdapter, type NetworkAdapter } from "./NetworkAdapter";
import { world } from "./world-store";

export const net: NetworkAdapter = new WebSocketAdapter(REALTIME_URL);

net.onMessage((m) => world.apply(m));
net.onStatus((s) => world.setStatus(s));

let started = false;
let retry = 0;

export function detectClientType(): "browser_desktop" | "browser_mobile" {
  return matchMedia("(pointer: coarse)").matches ? "browser_mobile" : "browser_desktop";
}

export async function startSession(displayName: string | undefined, chunkId = "c_0_0") {
  if (started) return;
  started = true;

  const connect = async () => {
    try {
      const r = await fetch(new URL("/auth/guest", REALTIME_URL), { method: "POST" });
      if (!r.ok) throw new Error(`auth ${r.status}`);
      const { token } = (await r.json()) as { token: string };
      net.connect(chunkId, token);
    } catch (e) {
      console.warn("[xenxo] sin conexión con el servidor de tiempo real", e);
      world.setStatus("closed");
      scheduleRetry();
    }
  };

  const scheduleRetry = () => {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 1000 * 2 ** retry);
  };

  net.onStatus((s) => {
    if (s === "open") {
      retry = 0;
      net.send(
        msg("HELLO", {
          client_type: detectClientType(),
          capabilities: { xr: false, hand_tracking: false, haptics: false, lod: "medium" },
          display_name: displayName,
        }) as ClientMessage,
      );
    }
    if (s === "closed" && started) scheduleRetry();
  });

  await connect();
}
