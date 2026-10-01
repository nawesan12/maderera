import { avisosDeArranque, problemasDeArranque } from "./entorno";

/**
 * El chequeo de arranque del servidor, solo para el runtime de Node.
 *
 * Va en un archivo aparte de `lib/entorno.ts` porque termina el proceso, y eso
 * no puede quedar al alcance del runtime de Edge ni de una página: lo importa
 * únicamente `instrumentation.ts`, y solo cuando corre en Node.
 *
 * **Por qué `process.exit` y no un `throw`.** Se probó con el `throw`: Next
 * registra «Failed to prepare server» y **el proceso sigue vivo**, escuchando
 * en el puerto y contestando con errores. Para Docker eso es un contenedor
 * sano. Saliendo con código 1, el contenedor se cae, `restart: unless-stopped`
 * lo reintenta, el chequeo de salud nunca da bien y `scripts/desplegar.sh`
 * corta diciendo que la aplicación nueva no arrancó.
 */
export function verificarArranque(): void {
  for (const aviso of avisosDeArranque()) {
    console.warn(`[arranque] ${aviso}`);
  }

  const problemas = problemasDeArranque();
  if (problemas.length === 0) return;

  for (const problema of problemas) console.error(`[arranque] ${problema}`);
  console.error(
    "[arranque] El servidor no arranca hasta que se corrija lo de arriba en .env.produccion.",
  );
  process.exit(1);
}
