"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquarePlus, Search } from "lucide-react";
import { haceCuanto, jidCorto } from "./formato-wa";
import { Hilo } from "./hilo";
import { PanelCliente } from "./panel-cliente";
import { NuevaConversacion } from "./nueva-conversacion";
import type { ConversacionListada } from "@/lib/dal/admin/whatsapp";
import type { PlantillaAprobada } from "@/lib/whatsapp/tipos";

type Detalle = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/dal/admin/whatsapp").obtenerConversacion>>
>;

const FILTROS = [
  { valor: "todas", texto: "Abiertas" },
  { valor: "sin-leer", texto: "Sin leer" },
  { valor: "cerradas", texto: "Archivadas" },
] as const;

/**
 * Bandeja de WhatsApp: lista, conversación y ficha del cliente.
 *
 * Tres columnas en escritorio porque las tres se miran a la vez mientras se
 * contesta: quién escribió, qué dijo, y qué le debe o qué pidió. En pantallas
 * chicas se muestra una sola —la lista, o la conversación si hay una abierta—,
 * que es como se usa desde el teléfono del mostrador.
 *
 * La conversación abierta va en la URL (`?chat=`) y no en el estado del
 * componente: así el enlace a una charla se puede pasar por interno y
 * recargar la página no vuelve a la primera.
 */
export function Bandeja({
  conversaciones,
  detalle,
  filtro,
  plantillas,
  modoDemo,
  pantallaCompleta = false,
}: {
  conversaciones: ConversacionListada[];
  detalle: Detalle | null;
  filtro: "todas" | "sin-leer" | "cerradas";
  plantillas: PlantillaAprobada[];
  modoDemo: boolean;
  pantallaCompleta?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();

  const [busqueda, setBusqueda] = useState("");
  const [abriendoNueva, setAbriendoNueva] = useState(false);

  /**
   * Refresco periódico.
   *
   * No hay conexión abierta con el servidor: los mensajes entran por el webhook
   * y esta pantalla se entera al volver a consultar. Diez segundos es el
   * intervalo que hace que una respuesta se note enseguida sin castigar a la
   * base con una consulta por segundo.
   */
  useEffect(() => {
    const reloj = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(reloj);
  }, [router]);

  const visibles = busqueda.trim()
    ? conversaciones.filter((c) => {
        const texto = busqueda.trim().toLowerCase();
        return (
          c.nombre.toLowerCase().includes(texto) ||
          c.waJid.includes(texto.replace(/\D/g, "")) ||
          (c.ultimoMensajePreview ?? "").toLowerCase().includes(texto)
        );
      })
    : conversaciones;

  function enlaceFiltro(valor: string) {
    const nuevos = new URLSearchParams(parametros.toString());
    nuevos.set("filtro", valor);
    nuevos.delete("chat");
    return `${pathname}?${nuevos.toString()}`;
  }

  function enlaceChat(id: string) {
    const nuevos = new URLSearchParams(parametros.toString());
    nuevos.set("chat", id);
    return `${pathname}?${nuevos.toString()}`;
  }

  // En el puesto de atención la bandeja ocupa lo que queda de pantalla; dentro
  // del panel se le descuenta lo que ocupan el menú, el encabezado y el cartel
  // de estado.
  const alto = pantallaCompleta
    ? "min-h-0 flex-1"
    : "max-h-[calc(100vh-16rem)] min-h-[32rem]";

  return (
    <div
      className={`grid gap-3 lg:grid-cols-[20rem_1fr] xl:grid-cols-[20rem_1fr_19rem] ${
        pantallaCompleta ? "min-h-0 flex-1" : "gap-4"
      }`}
    >
      {/* Lista */}
      <section
        className={`tarjeta flex flex-col overflow-hidden ${alto} ${
          detalle ? "hidden lg:flex" : "flex"
        }`}
      >
        <div className="space-y-2.5 border-b p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o número"
                className="h-10 w-full rounded-lg border bg-background pl-8 pr-2.5 text-base"
                aria-label="Buscar conversaciones"
              />
            </div>
            <button
              type="button"
              onClick={() => setAbriendoNueva(true)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-muted"
              aria-label="Escribirle a un número nuevo"
              title="Escribirle a un número nuevo"
            >
              <MessageSquarePlus className="h-5 w-5" />
            </button>
          </div>

          <div className="flex gap-1">
            {FILTROS.map((f) => (
              <Link
                key={f.valor}
                href={enlaceFiltro(f.valor)}
                className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  filtro === f.valor
                    ? "bg-brand-orange/12 font-medium text-brand-orange-dark"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.texto}
              </Link>
            ))}
          </div>
        </div>

        {abriendoNueva && (
          <NuevaConversacion onCerrar={() => setAbriendoNueva(false)} />
        )}

        <ul className="flex-1 divide-y overflow-y-auto">
          {visibles.length === 0 ? (
            <li className="px-4 py-10 text-center text-base text-muted-foreground">
              {busqueda
                ? "No hay conversaciones que coincidan."
                : filtro === "cerradas"
                  ? "No hay conversaciones archivadas."
                  : "Todavía no entró ningún mensaje."}
            </li>
          ) : (
            visibles.map((c) => {
              const activa = detalle?.id === c.id;

              return (
                <li key={c.id}>
                  <Link
                    href={enlaceChat(c.id)}
                    className={`flex gap-3 px-3.5 py-3 transition-colors ${
                      activa ? "bg-brand-orange/[0.08]" : "hover:bg-muted/60"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
                        c.customerId
                          ? "bg-brand-green/15 text-brand-green"
                          : "bg-muted text-muted-foreground"
                      }`}
                      aria-hidden
                    >
                      {inicial(c.nombre)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-base font-medium">
                          {c.nombre}
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {haceCuanto(c.ultimoMensajeAt)}
                        </span>
                      </span>

                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-base text-muted-foreground">
                          {c.ultimoMensajePreview || jidCorto(c.waJid)}
                        </span>
                        {c.noLeidos > 0 && (
                          <span className="tabular flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-green px-1.5 text-sm font-semibold text-white">
                            {c.noLeidos}
                          </span>
                        )}
                      </span>

                      {!c.customerId && (
                        <span className="mt-1 inline-block rounded px-1.5 py-0.5 text-sm text-muted-foreground ring-1 ring-inset ring-border">
                          Sin ficha de cliente
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </section>

      {/* Conversación */}
      {detalle ? (
        <Hilo
          key={detalle.id}
          detalle={detalle}
          plantillas={plantillas}
          modoDemo={modoDemo}
          alto={alto}
        />
      ) : (
        <section
          className={`tarjeta hidden items-center justify-center p-10 text-center lg:flex ${alto}`}
        >
          <p className="text-base text-muted-foreground">
            Elegí una conversación de la lista para leerla y contestar.
          </p>
        </section>
      )}

      {/* Ficha del cliente */}
      {detalle && (
        <div
          className={`hidden xl:block ${
            pantallaCompleta ? "min-h-0 overflow-y-auto" : ""
          }`}
        >
          <PanelCliente detalle={detalle} />
        </div>
      )}
    </div>
  );
}

function inicial(nombre: string): string {
  const limpio = nombre.trim();
  if (!limpio || limpio === "Sin identificar") return "?";
  return limpio[0].toUpperCase();
}
