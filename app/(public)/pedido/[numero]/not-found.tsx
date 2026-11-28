import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { BotonWhatsapp } from "@/components/whatsapp/boton";

/**
 * El seguimiento que no se puede abrir: el número no existe, el enlace no
 * trae el token o lo trae mal escrito. La página del sitio hablaba de un
 * producto que ya no está publicado (mes simulado, M2S1-198, M2S1-202).
 *
 * Los tres casos dicen lo mismo y dan 404 (lo decide `proxy.ts` antes de
 * dibujar): distinguirlos diría qué números de pedido existen (M3S2-046).
 */
export default async function PedidoNoEncontrado() {
  const whatsapp = await enlaceWhatsapp("Hola! No puedo abrir el seguimiento de mi pedido.");
  return (
    <>
      <EncabezadoPublico titulo="No encontramos ese pedido" bajada="Abrilo desde el enlace del correo." />
      <div className="contenedor flex justify-center py-12">
        <BotonWhatsapp enlace={whatsapp}>Escribirnos por WhatsApp</BotonWhatsapp>
      </div>
    </>
  );
}
