/**
 * El rival de la casa (net/house-rival.ts): un coche fantasma, medio transparente y de otro color,
 * que corre contigo cuando estás solo en la parrilla del Gran Premio o de Vértigo. Va con la hora de
 * salida del servidor, desde el segundo cajón, y no choca con nada (no entra en la física: es solo
 * un dibujo). Se monta escondido al llegar a un lugar con coches, como el propio, para que sus
 * shaders se compilen con el lugar (world/warm.ts). Nunca en las gafas (allí no hay coches).
 */
import { useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { activity } from "../../net/activity-store";
import { ghostPose, loadRivals, soloRival, type GhostPose } from "../../net/house-rival";
import { world } from "../../net/world-store";
import { applyCarPose, CarModel, createCarHandle, createCarPose } from "./CarModel";
import { CAR } from "./car";

/** El color del rival de la casa (el magenta de Arcade). */
export const RIVAL_PAINT = "#ff4fd8";

const handle = createCarHandle();
const pose = createCarPose();
const g: GhostPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0 };
let spin = 0;

export function HouseRival() {
  useEffect(() => {
    void loadRivals();
  }, []);
  useFrame((_, dt) => {
    const lap = soloRival(activity.round);
    const r = activity.round;
    pose.visible = !!lap && !!r;
    if (lap && r) {
      ghostPose(lap, world.serverNow() - r.go_at, g);
      pose.p.set(g.x, g.y, g.z);
      pose.q.set(g.qx, g.qy, g.qz, g.qw);
      spin += (g.speed * Math.min(dt, 0.1)) / CAR.wheelRadius;
      pose.spin = spin;
    }
    applyCarPose(handle, pose);
  });
  return <CarModel handle={handle} paint={RIVAL_PAINT} ghost />;
}
