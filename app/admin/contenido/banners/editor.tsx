"use client";

import { useActionState, useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
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
import { Confirmar } from "@/components/admin/confirmar";
import { ElegirImagen } from "@/components/admin/elegir-imagen";
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
}

export function EditorDeBanner({
  banner,
  alCrear,
}: {
  banner: BannerEditable | null;
  /** El alta avisa que salió bien: quien la abrió la vacía y la pliega (M4-010). */
  alCrear?: () => void;
}) {
  const [estado, guardar, guardando] = useActionState(guardarBanner, inicial);

  useEffect(() => {
    if (!banner && estado.ok && alCrear) {
      toast.success(estado.ok);
      alCrear();
    }
  }, [estado, banner, alCrear]);
  const [ubicacion, setUbicacion] = useState(banner?.ubicacion ?? "portada");
  const [borrando, empezarBorrado] = useTransition();
  const [avisoBorrado, setAvisoBorrado] = useState<string | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  // El aviso de bienvenida era una franja de una línea y no admitía ni bajada
  // ni imagen. Como diálogo sí las muestra, así que los tres lugares llevan los
  // mismos campos y no hay nada que esconder según dónde vaya.

  return (
    <form {...sinReiniciar(guardar)} className="space-y-5">
      {banner && <input type="hidden" name="id" value={banner.id} />}

      <Hoja plana>
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
          <ElegirImagen
            nombre="imagen"
            etiqueta="Imagen de fondo"
            actual={banner?.imagenUrl ?? null}
          />
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
            onClick={() => setConfirmarBorrado(true)}
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
        {banner && confirmarBorrado && (
          <Confirmar
            abierto
            alCerrar={() => setConfirmarBorrado(false)}
            titulo="Borrar este banner"
            detalle="Sale de la portada. No se puede recuperar."
            confirmar="Borrar el banner"
            peligro
            alConfirmar={() => {
              setConfirmarBorrado(false);
              empezarBorrado(async () => {
                const r = await borrarBanner(banner.id);
                setAvisoBorrado(r.error ?? r.ok ?? null);
              });
            }}
          />
        )}

        {estado.error && (
          <p className="text-base text-destructive">{estado.error}</p>
        )}
        {estado.ok && banner && (
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

/**
 * «Crear un aviso», plegado. Al crear, el formulario vuelve vacío y se cierra:
 * quedaba lleno con la imagen, listo para un duplicado (M4-010).
 */
export function CrearAviso({ titulo, children }: { titulo: string; children?: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const [vuelta, setVuelta] = useState(0);
  return (
    <details
      open={abierto}
      onToggle={(e) => setAbierto(e.currentTarget.open)}
      className="tarjeta group overflow-hidden"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-base font-semibold hover:bg-muted/40">
        {children}
        {titulo}
      </summary>
      <div className="px-5 pb-5 sm:px-8">
        <EditorDeBanner
          key={vuelta}
          banner={null}
          alCrear={() => {
            setAbierto(false);
            setVuelta((v) => v + 1);
          }}
        />
      </div>
    </details>
  );
}
