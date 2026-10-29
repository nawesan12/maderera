import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { Vacio } from "@/components/admin/vacio";
import { estadoDeCampanas, listarCampanas } from "@/lib/dal/admin/campanas";
import { fechaCorta } from "@/lib/formato";

export const metadata: Metadata = { title: "Campañas" };

/**
 * Las campañas de correo a la cartera.
 *
 * Tarjetas y no tabla: de cada campaña importa una sola cosa a la vista —cómo
 * le fue— y eso se lee mejor como una barra que como cuatro columnas de
 * números.
 */
export default async function CampanasPage() {
  const [lista, estado] = await Promise.all([listarCampanas(), estadoDeCampanas()]);
  const { bajas } = estado;

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Campañas"
        detalle={`Novedades y promociones por correo a los clientes.${bajas > 0 ? ` ${bajas} ${bajas === 1 ? "dirección se dio" : "direcciones se dieron"} de baja y no reciben.` : ""}`}
      >
        <Link
          href="/admin/campanas/nueva"
          className="boton-accion inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-base font-medium"
        >
          <Plus className="h-5 w-5" />
          Nueva campaña
        </Link>
      </EncabezadoPanel>

      {!estado.real && (
        <p className="estado-espera rounded-xl bg-[var(--estado-fondo)] px-4 py-3 text-base">
          El envío de correos todavía no está conectado. Se pueden armar campañas y ver cómo
          quedan, pero no salen hasta que se conecte el servidor de correo.
        </p>
      )}

      {lista.length === 0 ? (
        <Vacio
          icono={Megaphone}
          titulo="Todavía no hay campañas"
          detalle="Una lista de precios nueva, un evento, las cuotas del mes: a quién y con qué palabras, y sale en tandas."
          accion={{ texto: "Armar la primera", href: "/admin/campanas/nueva" }}
        />
      ) : (
        <ul className="grid gap-3">
          {lista.map((c) => {
            const salieron = c.enviados + c.fallidos + c.omitidos;
            const avance = c.total > 0 ? Math.round((salieron / c.total) * 100) : 0;
            return (
              <li key={c.id}>
                <Link
                  href={`/admin/campanas/${c.id}`}
                  className="tarjeta block px-5 py-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-lg font-medium">{c.asunto}</h2>
                      <p className="mt-0.5 text-base text-muted-foreground">
                        {c.descripcion}
                      </p>
                    </div>
                    <EtiquetaEstado estado={c.estado === "enviada" ? "campana_enviada" : c.estado} />
                  </div>

                  {c.total > 0 ? (
                    <div className="mt-3">
                      <div className="h-2 overflow-hidden rounded-full bg-hundida" aria-hidden="true">
                        <div className="h-full rounded-full bg-brand-orange" style={{ width: `${avance}%` }} />
                      </div>
                      <p className="mt-1.5 text-sm text-muted-foreground tabular">
                        {c.enviados} de {c.total} enviados
                        {c.fallidos > 0 && ` · ${c.fallidos} no salieron`}
                        {c.omitidos > 0 && ` · ${c.omitidos} omitidos`}
                        {c.iniciadaAt && ` · ${fechaCorta.format(c.iniciadaAt)}`}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {c.estado === "programada" && c.programadaPara
                        ? `Sale el ${c.programadaPara.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" })}`
                        : `Creada el ${fechaCorta.format(c.createdAt)}${c.creadaPorNombre ? ` por ${c.creadaPorNombre}` : ""}`}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
