// Va lo primero en main.tsx: Zod, sin compilar validadores con Function(), porque la CSP
// (public/_headers) no deja evaluar código.
import { config } from "zod";

config({ jitless: true });
