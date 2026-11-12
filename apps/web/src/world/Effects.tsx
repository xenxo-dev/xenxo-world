/**
 * Post-proceso para equipos con gráfica de sobra: resplandor de neones (bloom),
 * oclusión ambiental (N8AO), tono ACES y antialias SMAA.
 * Este módulo se descarga aparte: Quest, móviles y PCs modestos nunca lo cargan.
 * En VR no se monta (los efectos de pantalla completa no son compatibles con WebXR).
 */
import type { ReactElement } from "react";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { Ambience, Features } from "./graphics";

/** `enabled`: dibuja (mientras se prepara un lugar recién llegado no se dibuja nada: World.tsx). */
export default function Effects({ features, ambience, enabled = true }: { features: Features; ambience: Ambience; enabled?: boolean }) {
  const night = ambience === "night";
  const effects = [
    features.ao && <N8AO key="ao" halfRes aoRadius={1.6} distanceFalloff={1} intensity={night ? 1.5 : 2.4} />,
    features.bloom && (
      <Bloom
        key="bloom"
        mipmapBlur
        luminanceThreshold={1}
        luminanceSmoothing={0.15}
        intensity={night ? 0.8 : 0.45}
        radius={0.6}
      />
    ),
    <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />,
    !features.antialias && <SMAA key="smaa" />,
  ].filter(Boolean) as ReactElement[];

  return (
    <EffectComposer enabled={enabled} multisampling={features.antialias ? 4 : 0} enableNormalPass={false}>
      {effects}
    </EffectComposer>
  );
}
