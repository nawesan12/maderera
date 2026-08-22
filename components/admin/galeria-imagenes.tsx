"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Loader2, Star, Trash2, Upload } from "lucide-react";
import {
  eliminarImagen,
  hacerPrincipal,
  subirImagen,
} from "@/app/admin/productos/imagenes-actions";

export interface ImagenProducto {
  id: string;
  url: string;
  alt: string | null;
}

/**
 * Galería de fotos del producto.
 *
 * Acepta arrastrar y soltar porque cargar veinte productos eligiendo archivo por
 * archivo en un diálogo es la parte que hace que nadie mantenga las fotos al
 * día. La primera imagen es la que se ve en el catálogo, y eso se dice en
 * pantalla en vez de dejarlo librado a que se descubra.
 */
export function GaleriaImagenes({
  productId,
  imagenes,
}: {
  productId: string;
  imagenes: ImagenProducto[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, startSubida] = useTransition();
  const [arrastrando, setArrastrando] = useState(false);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(
    null,
  );

  function subir(archivos: FileList | File[]) {
    const lista = Array.from(archivos).filter((a) => a.type.startsWith("image/"));
    if (lista.length === 0) {
      toast.error("Arrastrá imágenes, no otro tipo de archivo.");
      return;
    }

    startSubida(async () => {
      let hechas = 0;
      setProgreso({ hechas: 0, total: lista.length });

      for (const archivo of lista) {
        const datos = new FormData();
        datos.set("archivo", archivo);
        datos.set("productId", productId);

        const resultado = await subirImagen(datos);

        if (resultado.error) {
          toast.error(`${archivo.name}: ${resultado.error}`);
        } else {
          hechas++;
          setProgreso({ hechas, total: lista.length });
        }
      }

      setProgreso(null);
      if (hechas > 0) {
        toast.success(
          hechas === 1 ? "Foto subida." : `${hechas} fotos subidas.`,
        );
        router.refresh();
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function accion(fn: () => Promise<{ error?: string }>, exito: string) {
    startSubida(async () => {
      const resultado = await fn();
      if (resultado.error) toast.error(resultado.error);
      else {
        toast.success(exito);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {imagenes.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {imagenes.map((imagen, i) => (
            <li key={imagen.id} className="group relative">
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                <Image
                  src={imagen.url}
                  alt={imagen.alt ?? ""}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, 200px"
                />
              </div>

              {i === 0 && (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-orange px-2 py-0.5 text-sm font-medium text-white">
                  <Star className="h-3.5 w-3.5" fill="currentColor" />
                  Principal
                </span>
              )}

              {/* Los controles aparecen al pasar por encima, pero siguen siendo
                  alcanzables con el teclado. */}
              <div className="absolute inset-x-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {i !== 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      accion(
                        () => hacerPrincipal(imagen.id),
                        "Ahora es la foto principal.",
                      )
                    }
                    disabled={subiendo}
                    className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-card/95 text-sm font-medium shadow-sm backdrop-blur transition-colors hover:bg-card"
                  >
                    <Star className="h-4 w-4" />
                    Principal
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    accion(() => eliminarImagen(imagen.id), "Foto eliminada.")
                  }
                  disabled={subiendo}
                  className="flex h-9 items-center justify-center rounded-md bg-card/95 px-3 text-destructive shadow-sm backdrop-blur transition-colors hover:bg-card"
                  aria-label="Eliminar esta foto"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          subir(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          arrastrando
            ? "border-brand-orange bg-brand-orange/5"
            : "hover:border-brand-orange/50 hover:bg-muted/40"
        }`}
      >
        {subiendo ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-brand-orange" />
            <span className="text-base font-medium">
              {progreso
                ? `Subiendo ${progreso.hechas + 1} de ${progreso.total}…`
                : "Subiendo…"}
            </span>
          </>
        ) : (
          <>
            {imagenes.length === 0 ? (
              <ImagePlus className="h-7 w-7 text-muted-foreground" />
            ) : (
              <Upload className="h-6 w-6 text-muted-foreground" />
            )}
            <span className="text-base font-medium">
              {imagenes.length === 0
                ? "Arrastrá las fotos del producto acá"
                : "Agregar más fotos"}
            </span>
            <span className="text-sm text-muted-foreground">
              JPG, PNG o WebP · hasta 8 MB cada una · se pueden subir varias
              juntas
            </span>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="sr-only"
          onChange={(e) => e.target.files && subir(e.target.files)}
        />
      </label>

      {imagenes.length > 0 && (
        <p className="text-sm text-muted-foreground">
          La foto marcada como principal es la que se ve en el catálogo.
        </p>
      )}
    </div>
  );
}
