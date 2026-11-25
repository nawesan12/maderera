"use client";

import { MessageCircle } from "lucide-react";

/**
 * El único botón flotante del sitio (hallazgo 27, 18/11/2026): el asistente
 * dejó de flotar a su lado —ver `lib/asistente/abrir.ts`—. Es del mismo verde
 * que todo botón de WhatsApp (`--whatsapp-boton`); el #25D366 de antes daba
 * 1,9:1 con el ícono blanco.
 *
 * El enlace baja por prop porque el número es editable desde el panel y esto
 * es un componente de cliente: leerlo acá significaría volver a escribirlo a
 * mano, que es exactamente lo que lo dejaba desactualizado.
 *
 * Entra con un segundo de retraso, para no competir con el contenido mientras
 * la página termina de cargar. La animación es de CSS —`tw-animate-css`, que
 * ya está en el proyecto— y `fill-mode-backwards` es lo que lo mantiene
 * invisible durante esa espera; sin eso aparece, desaparece y vuelve a
 * aparecer. Con `prefers-reduced-motion` no se anima nada.
 *
 * Las páginas que ya tienen su propio WhatsApp —/corte y la ficha— se marcan
 * con `data-sin-flotantes` y este no se dibuja (globals.css).
 */
export function WhatsAppButton({ enlace }: { enlace: string }) {
  return (
    <a
      href={enlace}
      aria-label="Escribinos por WhatsApp"
      target="_blank"
      rel="noopener noreferrer"
      className="flotante-whatsapp fixed bottom-4 right-4 z-50 flex h-12 w-12 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14 animate-in items-center justify-center rounded-full bg-whatsapp-boton text-white shadow-lg transition-all zoom-in fill-mode-backwards duration-300 [animation-delay:1s] hover:scale-110 hover:bg-whatsapp-boton-hover hover:shadow-xl active:scale-95 motion-reduce:animate-none"
    >
      <MessageCircle className="h-7 w-7" />
    </a>
  );
}
