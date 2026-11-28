import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, PackagePlus, Plus } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { listarRecepciones, ordenesPorRecibir } from "@/lib/dal/admin/recepciones";
import { fechaCorta, formatearMonto, plural } from "@/lib/formato";
import { PorRecibir } from "./por-recibir";

export const metadata: Metadata = { title: "Recepciones" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  confirmada: { texto: "Confirmada", clase: "estado-ok" },
  anulada: { texto: "Anulada", clase: "estado-problema" },
};

/**
 * La mercadería que entró, y la que se espera.
 *
 * Una recepción en borrador no tocó nada todavía: ni el stock ni el costo.
 * Confirmar es el acto que mueve las dos cosas.
 *
 * La recibe quien baja el camión: también el depósito (mes simulado, H097),
 * que no ve precios. Arriba, las órdenes que se esperan, con el remito a
 * mano; cargar una recepción suelta, con sus costos, queda para el admin.
 */
export default async function RecepcionesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const usuario = await requireStaff();
  // A donde lleva «recepciones sin factura de compra» del inicio (mes
  // simulado, M2S4-011): Facturas de compra no las mostraba.
  const sinFactura = (await searchParams).estado === "sin-factura";
  if (!puedeEntrar("/admin/recepciones", usuario.staffRole)) notFound();
  const veCostos = puedeEntrar("/admin/recepciones/nueva", usuario.staffRole);

  const [recepciones, esperadas] = await Promise.all([listarRecepciones(sinFactura ? 500 : 50), ordenesPorRecibir()]);
  const borradores = recepciones.filter((r) => r.estado === "borrador").length;
  const vivas = recepciones.filter((r) =>
    sinFactura ? r.estado === "confirmada" && !r.facturada : r.estado !== "anulada",
  );
  const anuladas = sinFactura ? [] : recepciones.filter((r) => r.estado === "anulada");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[26px] font-bold tracking-tight">Recepciones</h1>
        {veCostos && (
          <Link
            href="/admin/recepciones/nueva"
            className="boton-accion inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-base font-medium"
          >
            <Plus className="h-4 w-4" />
            Nueva recepción
          </Link>
        )}
      </header>

      {sinFactura && (
        <nav aria-label="Ver recepciones" className="flex gap-2">
          <Link href="/admin/recepciones" className="inline-flex h-10 items-center rounded-lg bg-hundida px-4 text-base font-medium text-muted-foreground hover:text-foreground">
            Todas
          </Link>
          <span aria-current="page" className="inline-flex h-10 items-center rounded-lg bg-foreground px-4 text-base font-medium text-background">
            Sin factura
          </span>
        </nav>
      )}

      {!sinFactura && esperadas.length > 0 && <PorRecibir ordenes={esperadas} />}

      {!sinFactura && borradores > 0 && (
        <p className="estado-espera rounded-xl bg-[var(--estado-fondo)] px-4 py-3 text-base">
          {plural(borradores, "recepción en borrador", "recepciones en borrador")}: todavía no entró al stock.
        </p>
      )}

      {(vivas.length > 0 || anuladas.length === 0) && (
        <section className="tarjeta @container overflow-hidden">
          {vivas.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <PackagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-base text-muted-foreground">
                {sinFactura ? "Todas las recepciones tienen su factura." : "Todavía no se cargó ninguna recepción."}
              </p>
            </div>
          ) : (
            <Lista recepciones={vivas} veCostos={veCostos} />
          )}
        </section>
      )}

      {/* Las anuladas, plegadas al final: a 375 px, 34 anuladas hacían una
          página de 5.400 px entre las que importan (mes simulado, tercera
          prueba). */}
      {anuladas.length > 0 && (
        <details className="tarjeta @container group overflow-hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-base font-medium text-muted-foreground hover:bg-hundida">
            {plural(anuladas.length, "anulada", "anuladas")}
            <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-linea">
            <Lista recepciones={anuladas} veCostos={veCostos} />
          </div>
        </details>
      )}
    </div>
  );
}

type Recepcion = Awaited<ReturnType<typeof listarRecepciones>>[number];

function Lista({ recepciones, veCostos }: { recepciones: Recepcion[]; veCostos: boolean }) {
  return (
    <>
      <table className="hidden w-full text-base @4xl:table" data-tabla="fija">
        <thead>
          <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-2.5 font-semibold">Fecha</th>
            <th className="px-5 py-2.5 font-semibold">Proveedor</th>
            <th className="px-5 py-2.5 font-semibold">Remito</th>
            <th className="px-5 py-2.5 font-semibold">Sucursal</th>
            <th className="px-5 py-2.5 text-right font-semibold">Renglones</th>
            {veCostos && <th className="px-5 py-2.5 text-right font-semibold">Neto</th>}
            <th className="px-5 py-2.5 font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-linea">
          {recepciones.map((r) => (
            <tr key={r.id} className="hover:bg-hundida">
              <td className="px-5 py-3 tabular-nums text-muted-foreground">{fechaCorta.format(r.fecha)}</td>
              <td className="px-5 py-3">
                <Link href={`/admin/recepciones/${r.id}`} className="font-semibold hover:underline">
                  {r.proveedor}
                </Link>
              </td>
              {/* El chip va adentro de la celda: con la clase en la celda
                  quedaba pegado arriba de la fila (M2S1-167). */}
              <td className="px-5 py-3 align-middle text-muted-foreground">
                {r.numeroRemito ? <span className="codigo">{r.numeroRemito}</span> : "—"}
              </td>
              <td className="px-5 py-3 text-muted-foreground">{r.sucursal ?? "—"}</td>
              <td className="tabular px-5 py-3 text-right">{r.lineas}</td>
              {veCostos && <td className="tabular px-5 py-3 text-right font-semibold">{formatearMonto(r.neto)}</td>}
              <td className="px-5 py-3">
                <Estado estado={r.estado} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* En el teléfono, tres renglones: el proveedor con el estado, el
          remito, y la sucursal con la fecha y el neto. */}
      <ul className="divide-y divide-linea @4xl:hidden">
        {recepciones.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/recepciones/${r.id}`} className="block space-y-1 px-4 py-3 hover:bg-hundida">
              {/* El proveedor entero (hasta dos renglones) y la fecha
                  entera: si algo no entra se corta la sucursal (mes
                  simulado, H382). */}
              <span className="flex items-start justify-between gap-3">
                <span className="line-clamp-2 min-w-0 break-words text-[17px] font-semibold">{r.proveedor}</span>
                <Estado estado={r.estado} />
              </span>
              {/* El neto va con el remito y la fecha con la sucursal,
                  enteras: al lado del neto, a 375 px la sucursal
                  quedaba en «Casa Centr…» (mes simulado). */}
              <span className="flex items-baseline justify-between gap-3 text-base">
                {/* «Remito» en la letra del texto y el número en mono,
                    entero: se cortaba en «Remito 0002-0003…» (M2S1-167). */}
                <span className="min-w-0 text-muted-foreground">
                  {r.numeroRemito ? (
                    <>
                      Remito <span className="codigo whitespace-nowrap">{r.numeroRemito}</span>
                    </>
                  ) : (
                    "Sin remito"
                  )}
                </span>
                {veCostos && <span className="tabular shrink-0 font-semibold">{formatearMonto(r.neto)}</span>}
              </span>
              <span className="block text-base tabular-nums text-muted-foreground">
                {fechaCorta.format(r.fecha)}
                {r.sucursal && ` · ${r.sucursal}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function Estado({ estado }: { estado: string }) {
  const e = ESTADOS[estado] ?? ESTADOS.borrador;
  return (
    <span className={`${e.clase} inline-flex shrink-0 items-center rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold`}>
      {e.texto}
    </span>
  );
}
