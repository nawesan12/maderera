"use client";

import { MessageCircle } from "lucide-react";

/**
 * El enlace baja por prop porque el número es editable desde el panel y esto
 * es un componente de cliente: leerlo acá significaría volver a escribirlo a
 * mano, que es exactamente lo que lo dejaba desactualizado.
 *
 * Entra con un segundo de retraso, para no competir con el contenido mientras
 * la página termina de cargar. La animación es de CSS —`tw-animate-css`, que
 * ya está en el proyecto— y `fill-mode-backwards` es lo que lo mantiene
 * invisible durante esa espera; sin eso aparece, desaparece y vuelve a
 * aparecer. Con `prefers-reduced-motion` no se anima nada.
 */
export function WhatsAppButton({ enlace }: { enlace: string }) {
  return (
    <a
      href={enlace}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 animate-in items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-all zoom-in fill-mode-backwards duration-300 [animation-delay:1s] hover:scale-110 hover:shadow-xl active:scale-95 motion-reduce:animate-none"
    >
      <MessageCircle className="h-7 w-7" />
    </a>
  );
}
