import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { api, datos } from "@/lib/api/servidor";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { fechaHora, plural } from "@/lib/formato";
import { Reintentar } from "./reintentar";

export const metadata: Metadata = { title: "Sistema" };

/**
 * Lo automático que falló: los trabajos de la cola que agotaron los intentos
 * (o siguen reintentando con error) y la última corrida de cada tarea del
 * worker. Es a donde lleva el aviso «Un trabajo automático no se pudo
 * hacer», que antes terminaba en un 404 (mes simulado, M2S2-061).
 */
export default async function SistemaPage() {
  const { staffRole } = await requireStaff();
  if (!puedeEntrar("/admin/sistema", staffRole)) notFound();
  const estado = datos(await (await api()).GET("/api/v1/admin/sistema"));
  const fallidos = estado.trabajos.filter((t) => t.estado === "fallido").length;

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Sistema"
        resumen={`${plural(fallidos, "trabajo fallido", "trabajos fallidos")} · ${plural(estado.pendientes, "en cola", "en cola")}`}
      />

      <section>
        <h2 className="mb-3 text-[19px] font-bold tracking-tight">Trabajos con error</h2>
        <div className="tarjeta overflow-hidden">
          {estado.trabajos.length === 0 ? (
            <Vacio icono={CircleCheck} titulo="Nada falló en los últimos 30 días" />
          ) : (
            <ul className="divide-y divide-linea-suave">
              {estado.trabajos.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="codigo break-all text-base font-semibold">{t.tipo}</span>
                      <span
                        className={`${t.estado === "fallido" ? "estado-problema" : "estado-espera"} rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-medium text-[var(--estado-tinta)]`}
                      >
                        {t.estado === "fallido" ? "Falló" : `Reintentando · ${t.intentos} de ${t.maxIntentos}`}
                      </span>
                    </p>
                    {t.ultimoError && (
                      <p className="mt-1 break-words text-sm text-texto-2 [overflow-wrap:anywhere]">{t.ultimoError}</p>
                    )}
                    <p className="tabular mt-1 text-sm text-texto-3">{fechaHora.format(new Date(t.terminadoAt ?? t.createdAt))}</p>
                  </div>
                  {t.estado === "fallido" && <Reintentar id={t.id} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[19px] font-bold tracking-tight">Tareas</h2>
        <ul className="tarjeta divide-y divide-linea-suave overflow-hidden">
          {estado.tareas.map((t) => (
            <li key={t.tarea} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <span className="codigo min-w-0 break-all text-base font-semibold">{t.tarea}</span>
              <span
                className={`tabular text-sm ${t.estado === "error" ? "estado-problema font-semibold text-[var(--estado-tinta)]" : "text-texto-2"}`}
              >
                {t.estado === "error" ? "Error" : t.estado === "corriendo" ? "Corriendo" : "Bien"} · {t.periodo}
              </span>
              {t.error && <p className="w-full break-words text-sm text-texto-2 [overflow-wrap:anywhere]">{t.error}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
