import { LOGO_DOCUMENTOS } from "@/lib/empresa";

/**
 * El logo en los papeles que se imprimen desde el navegador: factura, remito
 * y resumen de cuenta. Los PDF lo dibujan aparte, desde `lib/pdf/hoja.ts`.
 *
 * Es un `<img>` y no `next/image` a propósito: la hoja se imprime, y lo que
 * importa es que el archivo esté entero y a escala en el papel, no servir un
 * tamaño por pantalla.
 */
export function LogoEmisor() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_DOCUMENTOS.ruta}
      alt={LOGO_DOCUMENTOS.texto}
      width={LOGO_DOCUMENTOS.ancho}
      height={LOGO_DOCUMENTOS.alto}
      className="logo-emisor"
    />
  );
}
