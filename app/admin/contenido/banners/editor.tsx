"use client";

import { useActionState, useId, useState, useTransition } from "react";
import Image from "next/image";
import {
  AppWindow,
  CalendarDays,
  ImageIcon,
  LayoutGrid,
  Loader2,
  MapPin,
  Megaphone,
  PanelTop,
  Power,
  Trash2,
} from "lucide-react";
import { borrarBanner, guardarBanner, type EstadoBanner } from "./actions";
import { UBICACIONES } from "./ubicaciones";
import {
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
  sinReiniciar,
} from "@/components/admin/formulario";

const inicial: EstadoBanner = {};

const ICONO_UBICACION = {
  franja: AppWindow,
  portada: PanelTop,
  catalogo: LayoutGrid,
} as const;

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

  // El aviso de bienvenida era una franja de una línea y no admitía ni bajada
  // ni imagen. Como diálogo sí las muestra, así que los tres lugares llevan los
  // mismos campos y no hay nada que esconder según dónde vaya.

  return (
    <form {...sinReiniciar(guardar)} className="space-y-4">
      {banner && <input type="hidden" name="id" value={banner.id} />}

      <Hoja>
        <Seccion titulo="Qué dice" icono={Megaphone}>
          <Campo
            nombre="titulo"
            etiqueta="Título"
            valorInicial={banner?.titulo ?? ""}
            placeholder="30% de descuento con MODO los martes"
            requerido
          />
          <Campo
            nombre="bajada"
            etiqueta="Bajada"
            valorInicial={banner?.bajada ?? ""}
            placeholder="Placas de yeso, perfilería y aislantes con 15% de descuento"
          />
          <Campo
            nombre="etiqueta"
            etiqueta="Etiqueta"
            valorInicial={banner?.etiqueta ?? ""}
            placeholder="Promoción"
          />
        </Seccion>
        <Seccion titulo="Dónde va" icono={MapPin}>
          <div className="md:col-span-2">
            <p className="block text-base font-medium">Dónde se muestra</p>
            <div className="mt-1">
              <Opciones
                nombre="ubicacion"
                columnas={3}
                valor={ubicacion}
                alCambiar={setUbicacion}
                opciones={UBICACIONES.map((u) => ({
                  valor: u.valor,
                  texto: u.etiqueta,
                  icono: ICONO_UBICACION[u.valor],
                }))}
              />
            </div>
          </div>
          <Campo
            nombre="enlace"
            etiqueta="A dónde lleva"
            valorInicial={banner?.enlace ?? ""}
            placeholder="/catalogo?cat=construccion-en-seco"
          />
          <Campo
            nombre="textoEnlace"
            etiqueta="Texto del botón"
            valorInicial={banner?.textoEnlace ?? ""}
            placeholder="Ver la promo"
          />
        </Seccion>
        <Seccion titulo="Imagen" icono={ImageIcon} columnas={1}>
          <div>
            <label
              htmlFor={`${id}-img`}
              className="block text-base font-medium"
            >
              Imagen de fondo
            </label>
            <input
              id={`${id}-img`}
              type="file"
              name="imagen"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="mt-1 block w-full text-base"
            />
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
        </Seccion>
        <Seccion titulo="Cuándo" icono={CalendarDays} columnas={3}>
          <Campo
            nombre="desde"
            etiqueta="Desde"
            tipo="date"
            valorInicial={banner?.desde ?? ""}
          />
          <Campo
            nombre="hasta"
            etiqueta="Hasta"
            tipo="date"
            valorInicial={banner?.hasta ?? ""}
          />
          <Campo
            nombre="orden"
            etiqueta="Orden"
            valorInicial={String(banner?.orden ?? 0)}
          />
          <div className="md:col-span-3">
            <Interruptor
              nombre="activo"
              etiqueta="Encendido"
              icono={Power}
              defecto={banner?.activo ?? true}
            />
            {banner && !banner.alAire && banner.activo && (
              <p className="mt-2 text-sm text-muted-foreground">
                Hoy no se ve: está fuera de las fechas.
              </p>
            )}
          </div>
        </Seccion>
      </Hoja>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
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

        {estado.error && (
          <p className="text-base text-destructive">{estado.error}</p>
        )}
        {estado.ok && (
          <p className="text-base text-muted-foreground">{estado.ok}</p>
        )}
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
  tipo = "text",
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
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
    </div>
  );
}
