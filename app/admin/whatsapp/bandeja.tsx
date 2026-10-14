"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BellOff, MessageSquarePlus, Search } from "lucide-react";
import { haceCuanto, jidCorto } from "./formato-wa";
import { Hilo } from "./hilo";
import { PanelCliente } from "./panel-cliente";
import { NuevaConversacion } from "./nueva-conversacion";
import type { ConversacionListada, DetalleConversacion, FiltroBandeja } from "@/lib/dal/admin/whatsapp";
import type { PlantillaDisponible } from "@/lib/whatsapp/catalogo";
import { useEnVivo } from "@/lib/vivo/use-en-vivo";

export interface Persona {
  id: string;
  nombre: string;
}

const FILTROS: { valor: FiltroBandeja; texto: string; contador?: "sinLeer" | "mias" | "sinAsignar" }[] = [
  { valor: "todas", texto: "Abiertas" },
  { valor: "sin-leer", texto: "Sin leer", contador: "sinLeer" },
  { valor: "mias", texto: "Mías", contador: "mias" },
  { valor: "sin-asignar", texto: "Sin asignar", contador: "sinAsignar" },
  { valor: "resueltas", texto: "Resueltas" },
];

/**
 * Bandeja de WhatsApp: lista, conversación y ficha del cliente.
 *
 * Tres columnas en escritorio porque las tres se miran a la vez mientras se
 * contesta: quién escribió, qué dijo, y qué le debe o qué pidió. En pantallas
 * chicas se muestra una sola —la lista, o la conversación si hay una
 * abierta—, que es como se usa desde el teléfono del mostrador.
 *
 * La conversación abierta va en la URL (`?chat=`): así el enlace a una charla
 * se puede pasar por interno, y el aviso del teléfono abre justo esa.
 */
export function Bandeja({
  conversaciones,
  detalle,
  filtro,
  contadores,
  plantillas,
  personal,
  usuarioId,
  modoDemo,
  pantallaCompleta = false,
}: {
  conversaciones: ConversacionListada[];
  detalle: DetalleConversacion | null;
  filtro: FiltroBandeja;
  contadores: { sinLeer: number; mias: number; sinAsignar: number };
  plantillas: PlantillaDisponible[];
  personal: Persona[];
  usuarioId: string;
  modoDemo: boolean;
  pantallaCompleta?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();

  const [busqueda, setBusqueda] = useState("");
  const [abriendoNueva, setAbriendoNueva] = useState(false);

  /*
   * Los mensajes nuevos y los estados llegan en vivo (ver `lib/vivo`): el
   * webhook escribe, Postgres avisa y esta pantalla se refresca al instante,
   * con el contador del menú incluido. Donde no hay tiempo real —en Vercel—
   * vuelve a consultar cada diez segundos.
   */
  const enVivo = useEnVivo(["whatsapp"], () => router.refresh());
  useEffect(() => {
    if (enVivo) return;
    const reloj = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(reloj);
  }, [router, enVivo]);

  const texto = busqueda.trim().toLowerCase();
  const visibles = texto
    ? conversaciones.filter(
        (c) =>
          c.nombre.toLowerCase().includes(texto) ||
          (texto.replace(/\D/g, "") !== "" && c.waJid.includes(texto.replace(/\D/g, ""))) ||
          (c.ultimoMensajePreview ?? "").toLowerCase().includes(texto),
      )
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

  const alto = pantallaCompleta ? "min-h-0 flex-1" : "max-h-[calc(100vh-16rem)] min-h-[32rem]";

  return (
    <div
      className={`grid gap-3 lg:grid-cols-[21rem_1fr] xl:grid-cols-[21rem_1fr_20rem] ${
        pantallaCompleta ? "min-h-0 flex-1" : "gap-4"
      }`}
    >
      {/* Lista */}
      <section className={`tarjeta flex flex-col overflow-hidden ${alto} ${detalle ? "hidden lg:flex" : "flex"}`}>
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

          <nav className="flex flex-wrap gap-1" aria-label="Filtrar conversaciones">
            {FILTROS.map((f) => {
              const cantidad = f.contador ? contadores[f.contador] : 0;
              return (
                <Link
                  key={f.valor}
                  href={enlaceFiltro(f.valor)}
                  aria-current={filtro === f.valor ? "page" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                    filtro === f.valor
                      ? "bg-brand-orange/12 font-medium text-brand-orange-dark"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {f.texto}
                  {cantidad > 0 && <span className="tabular font-semibold">{cantidad}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        {abriendoNueva && <NuevaConversacion onCerrar={() => setAbriendoNueva(false)} />}

        <ul className="flex-1 divide-y overflow-y-auto">
          {visibles.length === 0 ? (
            <li className="px-4 py-10 text-center text-base text-muted-foreground">
              {busqueda
                ? "No hay conversaciones que coincidan."
                : filtro === "resueltas"
                  ? "No hay conversaciones resueltas."
                  : filtro === "mias"
                    ? "No tenés conversaciones asignadas."
                    : filtro === "sin-leer" || filtro === "sin-asignar"
                      ? "Nada por acá: está todo atendido."
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
                        c.customerId ? "bg-brand-green/15 text-brand-green" : "bg-muted text-muted-foreground"
                      }`}
                      aria-hidden
                    >
                      {inicial(c.nombre)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-base ${c.noLeidos > 0 ? "font-semibold" : "font-medium"}`}>
                          {c.nombre}
                        </span>
                        {/* El «hace cuánto» cambia entre el render del servidor y el del navegador. */}
                        <span className="shrink-0 text-sm text-muted-foreground" suppressHydrationWarning>
                          {haceCuanto(c.ultimoMensajeAt)}
                        </span>
                      </span>

                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-base text-muted-foreground">
                          {c.ultimoMensajePreview || jidCorto(c.waJid)}
                        </span>
                        {c.noLeidos > 0 && (
                          <span
                            className="tabular flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-brand-green px-1.5 text-sm font-semibold text-white"
                            aria-label={`${c.noLeidos} sin leer`}
                          >
                            {c.noLeidos}
                          </span>
                        )}
                      </span>

                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {!c.customerId && <Pildora>Sin ficha</Pildora>}
                        {c.asignadoAUserId && (
                          <Pildora>{c.asignadoAUserId === usuarioId ? "La atendés vos" : c.asignadoNombre}</Pildora>
                        )}
                        {c.ventanaAbierta && <Pildora verde>Ventana abierta</Pildora>}
                        {c.baja && (
                          <Pildora>
                            <BellOff className="h-3.5 w-3.5" /> Sin avisos
                          </Pildora>
                        )}
                      </span>
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
          personal={personal}
          usuarioId={usuarioId}
          modoDemo={modoDemo}
          alto={alto}
        />
      ) : (
        <section className={`tarjeta hidden items-center justify-center p-10 text-center lg:flex ${alto}`}>
          <p className="text-base text-muted-foreground">Elegí una conversación de la lista para leerla y contestar.</p>
        </section>
      )}

      {/* Ficha del cliente */}
      {detalle && (
        <div className={`hidden xl:block ${pantallaCompleta ? "min-h-0 overflow-y-auto" : ""}`}>
          <PanelCliente detalle={detalle} />
        </div>
      )}
    </div>
  );
}

function Pildora({ children, verde = false }: { children: React.ReactNode; verde?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm ring-1 ring-inset ${
        verde ? "text-green-800 ring-green-700/30" : "text-muted-foreground ring-border"
      }`}
    >
      {children}
    </span>
  );
}

function inicial(nombre: string): string {
  const limpio = nombre.trim();
  if (!limpio || limpio === "Sin identificar") return "?";
  return limpio[0].toUpperCase();
}
