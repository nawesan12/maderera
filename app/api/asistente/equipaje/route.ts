import { NextResponse } from "next/server";
import { equipajeDelAsistente } from "@/app/(public)/asistente-actions";

/**
 * Lo que el asistente sabe sin preguntarle a nadie.
 *
 * **Por qué dejó de ser una acción de servidor.** Rubros, sucursales, zonas de
 * envío y formas de pago son **iguales para todo el mundo**: no dependen de la
 * sesión ni de la lista de precios. Como acción viajaba por POST, y un POST no
 * se cachea nunca: cada persona que abría el panel del asistente pagaba una
 * invocación de función. Como GET, el primero paga y **todos los demás se
 * sirven del CDN por cero**.
 *
 * Es la diferencia práctica entre las dos formas: una acción es para mutar —y
 * ahí paga la pena, porque además refresca la pantalla—; un endpoint de lectura
 * pública puede costar nada.
 *
 * Lo que **no** se movió acá es la búsqueda de productos: el precio depende de
 * la lista de quien mira, así que cachearla en el CDN sería servirle a cualquiera
 * el precio de un profesional. Esa sigue siendo una acción, a propósito.
 */
export const revalidate = 3600;

export async function GET() {
  const equipaje = await equipajeDelAsistente();

  return NextResponse.json(equipaje, {
    headers: {
      /*
       * Una hora en el CDN y un día sirviendo lo viejo mientras se renueva.
       * Que alguien vea por diez minutos un horario recién cambiado no es un
       * problema; pagar una función por cada persona que abre el panel, sí.
       */
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
