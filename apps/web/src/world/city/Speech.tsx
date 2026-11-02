/**
 * Lo que dice la gente de las ciudades (ciudadanos y residentes): un bocadillo como el del chat sobre
 * su cabeza, unos segundos. El texto sale de i18n.ts (es decorado del cliente, como la gente) y se
 * cambia sin volver a pintar React: se mira cada frame si ha dicho algo nuevo (`said`).
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import type * as THREE from "three";
import { FONT_URL } from "../font";
import { BUBBLE_STYLE } from "../Avatars";
import { t, type Key } from "../../i18n";

/** Quien habla: qué dice (clave de i18n o null), un contador que cambia con cada frase y a cuánto está de ti (m). */
export interface Speaker {
  speech: string | null;
  said: number;
  dist: number;
}

/** Más lejos no se lee (y no se dibuja). */
const READ_AT = 16;

type TroikaText = THREE.Mesh & { text: string; sync: () => void };

export function Speech({ who, y = 2.15 }: { who: Speaker; y?: number }) {
  const group = useRef<THREE.Group>(null);
  const text = useRef<TroikaText>(null);
  const seen = useRef(-1);
  useFrame(() => {
    const g = group.current, tx = text.current;
    if (!g || !tx) return;
    if (who.said !== seen.current && who.speech) {
      seen.current = who.said;
      tx.text = t(who.speech as Key);
      tx.sync();
    }
    g.visible = !!who.speech && who.dist < READ_AT;
  });
  return (
    <Billboard ref={group} position={[0, y, 0]} visible={false}>
      <Text ref={text} font={FONT_URL} {...BUBBLE_STYLE} textAlign="center" anchorY="bottom">
        {" "}
      </Text>
    </Billboard>
  );
}
