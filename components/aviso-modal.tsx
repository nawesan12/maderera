"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { BannerPublicado } from "@/lib/dal/banners";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/** Dónde se recuerda que esta persona ya lo vio. */
const CLAVE = "mjbj-aviso-visto";

/**
 * Cuánto espera antes de aparecer.
 *
 * Un diálogo que salta con la página a medio pintar se cierra por reflejo,
 * antes de leerlo. Un segundo alcanza para que la portada esté armada y la
 * persona esté mirando.
 */
const ESPERA_MS = 1000;

/**
 * El aviso de promoción, como diálogo.
 *
 * **Antes era una franja de una línea sobre el encabezado** y la clienta pidió
 * cambiarla: una línea de texto arriba de todo se lee como parte del marco de
 * la página y nadie la mira, sobre todo en el teléfono, donde compite con la
 * barra del navegador. Una promoción que nadie ve no es una promoción.
 *
 * Tres decisiones que lo hacen soportable:
 *
 * 1. **Una vez por visita, no por página.** La marca va en `sessionStorage`,
 *    así que quien recorre diez fichas del catálogo lo ve una sola vez. Al
 *    volver otro día, vuelve a verlo: una promoción de quince días tiene que
 *    poder alcanzar a quien entró el primer día.
 * 2. **La clave incluye qué aviso es.** Si el equipo carga otra promoción, o
 *    edita la que está, la clave cambia y el diálogo vuelve a aparecer. Con una
 *    marca fija de «ya lo vio», la promoción nueva no la vería nadie.
 * 3. **Se cierra con Escape, con la X y haciendo clic afuera**, que es lo que
 *    hace el diálogo de base. Nada de esperar cinco segundos para habilitar el
 *    cierre.
 */
export function AvisoModal({
  banner,
  clave,
}: {
  banner: BannerPublicado;
  /** Identifica esta versión de este aviso. Cambia, y vuelve a mostrarse. */
  clave: string;
}) {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    // `sessionStorage` no existe en el render del servidor y puede fallar en
    // navegación privada de algunos navegadores: si no se puede leer, se
    // muestra igual. El costo de mostrarlo de más es mucho menor que el de no
    // mostrarlo nunca.
    let visto: string | null = null;
    try {
      visto = window.sessionStorage.getItem(CLAVE);
    } catch {
      visto = null;
    }

    if (visto === clave) return;

    const t = window.setTimeout(() => setAbierto(true), ESPERA_MS);
    return () => window.clearTimeout(t);
  }, [clave]);

  function cerrar(abriendo: boolean) {
    setAbierto(abriendo);

    if (!abriendo) {
      try {
        window.sessionStorage.setItem(CLAVE, clave);
      } catch {
        // Sin almacenamiento se vuelve a ver en la próxima página. No es
        // motivo para romper nada.
      }
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={cerrar}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        {banner.imagenUrl && (
          <div className="relative aspect-[16/9] w-full">
            <Image
              src={banner.imagenUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 512px"
              className="object-cover"
            />
          </div>
        )}

        <div className="flex flex-col gap-3 p-6">
          {banner.etiqueta && (
            <span className="w-fit rounded-full bg-naranja-claro px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-acento-sobre-claro">
              {banner.etiqueta}
            </span>
          )}

          <DialogTitle className="text-[22px]">{banner.titulo}</DialogTitle>

          {banner.bajada && (
            <DialogDescription className="text-base leading-relaxed">
              {banner.bajada}
            </DialogDescription>
          )}

          <div className="mt-1 flex flex-wrap gap-2.5">
            {banner.enlace && (
              <DialogClose
                render={
                  <Link href={banner.enlace}>
                    <Button className="h-11 rounded-[10px] bg-accion px-5 font-semibold text-white hover:bg-accion-hover">
                      {banner.textoEnlace || "Ver"}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                }
              />
            )}
            <DialogClose
              render={
                <Button variant="ghost" className="h-11 rounded-[10px] px-4">
                  Ahora no
                </Button>
              }
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
