"use client";

import { useActionState, useId, useState, useTransition } from "react";
import Image from "next/image";
import { Loader2, Trash2 } from "lucide-react";
import { borrarBanner, guardarBanner, type EstadoBanner } from "./actions";
import { UBICACIONES } from "./ubicaciones";

const inicial: EstadoBanner = {};

export interface BannerEditable {
  id: string;
  ubicacion: string;
  etiqueta: string;
  titulo: string;
  bajada: string;
  enlace: string | null;
  textoEnlace: string;
  imagenUrl: string | null;
  desde: string;
  hasta: string;
  orden: number;
  activo: boolean;
  /** Si hoy está efectivamente al aire, contando las fechas. */
  alAire: boolean;
}

export function EditorDeBanner({ banner }: { banner: BannerEditable | null }) {
  const [estado, guardar, guardando] = useActionState(guardarBanner, inicial);
  const [ubicacion, setUbicacion] = useState(banner?.ubicacion ?? "portada");
  const [borrando, empezarBorrado] = useTransition();
  const [avisoBorrado, setAvisoBorrado] = useState<string | null>(null);
  const id = useId();

  // La franja de arriba es una línea de texto: no lleva imagen ni bajada, y
  // ofrecerlas invitaría a cargar una foto que no se va a ver.
  const esFranja = ubicacion === "franja";

  return (
    <form action={guardar} className="space-y-4 rounded-xl border bg-card p-5">
      {banner && <input type="hidden" name="id" value={banner.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-ubi`} className="block text-base font-medium">
            Dónde se muestra
          </label>
          <select
            id={`${id}-ubi`}
            name="ubicacion"
            value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border bg-background px-2.5 text-base"
          >
            {UBICACIONES.map((u) => (
              <option key={u.valor} value={u.valor}>
                {u.etiqueta}
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-muted-foreground">
            {UBICACIONES.find((u) => u.valor === ubicacion)?.ayuda}
          </p>
        </div>

        <Campo
          nombre="etiqueta"
          etiqueta="Etiqueta"
          valorInicial={banner?.etiqueta ?? ""}
          placeholder="Promoción"
          ayuda="El chip de arriba del título. Dos o tres palabras: «Promoción», «Nuevo», «-15%»."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          nombre="titulo"
          etiqueta={esFranja ? "El aviso" : "Título"}
          valorInicial={banner?.titulo ?? ""}
          placeholder={
            esFranja
              ? "30% de descuento con MODO los martes"
              : "Semana de la construcción en seco"
          }
          requerido
        />
      </div>

      {!esFranja && (
        <Campo
          nombre="bajada"
          etiqueta="Bajada"
          valorInicial={banner?.bajada ?? ""}
          placeholder="Placas de yeso, perfilería y aislantes con 15% off"
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          nombre="enlace"
          etiqueta="A dónde lleva"
          valorInicial={banner?.enlace ?? ""}
          placeholder="/catalogo?cat=construccion-en-seco"
          ayuda="Vacío lo deja sin enlace."
        />
        <Campo
          nombre="textoEnlace"
          etiqueta="Texto del botón"
          valorInicial={banner?.textoEnlace ?? ""}
          placeholder="Ver la promo"
        />
      </div>

      {!esFranja && (
        <div>
          <label htmlFor={`${id}-img`} className="block text-base font-medium">
            Imagen de fondo
          </label>
          <input
            id={`${id}-img`}
            type="file"
            name="imagen"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="mt-1 block w-full text-base"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            Opcional. Sin imagen el banner sale sobre el color de marca, que se
            ve mejor que una foto mal recortada. Apaisada, mínimo 1200 px de
            ancho.
          </p>

          {banner?.imagenUrl && (
            <Image
              src={banner.imagenUrl}
              alt=""
              width={280}
              height={90}
              className="mt-2 h-[90px] w-[280px] rounded-lg object-cover"
            />
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          nombre="desde"
          etiqueta="Desde"
          tipo="date"
          valorInicial={banner?.desde ?? ""}
          ayuda="Vacío es «ya»."
        />
        <Campo
          nombre="hasta"
          etiqueta="Hasta"
          tipo="date"
          valorInicial={banner?.hasta ?? ""}
          ayuda="Vacío es «hasta que lo apagues»."
        />
        <Campo
          nombre="orden"
          etiqueta="Orden"
          valorInicial={String(banner?.orden ?? 0)}
        />
      </div>

      <label className="flex items-center gap-2.5 text-base">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={banner?.activo ?? true}
          className="h-4 w-4 accent-brand-orange"
        />
        Encendido
        {banner && !banner.alAire && banner.activo && (
          <span className="text-sm text-muted-foreground">
            · hoy no se ve: está fuera de las fechas
          </span>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {banner ? "Guardar" : "Crear banner"}
        </button>

        {banner && (
          <button
            type="button"
            disabled={borrando}
            onClick={() =>
              empezarBorrado(async () => {
                const r = await borrarBanner(banner.id);
                setAvisoBorrado(r.error ?? r.ok ?? null);
              })
            }
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium text-destructive transition-colors hover:bg-muted disabled:opacity-60"
          >
            {borrando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Borrar
          </button>
        )}

        {estado.error && <p className="text-base text-destructive">{estado.error}</p>}
        {estado.ok && <p className="text-base text-muted-foreground">{estado.ok}</p>}
        {avisoBorrado && (
          <p className="text-base text-muted-foreground">{avisoBorrado}</p>
        )}
      </div>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  valorInicial,
  placeholder,
  ayuda,
  tipo = "text",
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
  ayuda?: string;
  tipo?: string;
  requerido?: boolean;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        name={nombre}
        type={tipo}
        required={requerido}
        defaultValue={valorInicial}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
      {ayuda && <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>}
    </div>
  );
}
