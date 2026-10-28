// troika-three-text (lo usa drei <Text>) no publica tipos para su entrada principal: solo lo que toca font.ts.
declare module "troika-three-text" {
  export const Text: { prototype: { text: string; font: unknown; sync(cb?: () => void): void } };
  export function configureTextBuilder(config: { defaultFontURL?: string | null }): void;
}
