"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellOff, BellRing, ClipboardList, Link2, Loader2, Lock, Scissors, Search, UserPlus, Wallet } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaCorta, formatearMonto, moneda, telefonoLegible } from "@/lib/formato";
import {
  buscarClientesParaVincular,
  cambiarBaja,
  crearFichaDesdeConversacion,
  vincularCliente,
  type EstadoWhatsapp,
} from "./actions";
import type { DetalleConversacion } from "@/lib/dal/admin/whatsapp";
import { jidCorto } from "./formato-wa";

const estadoInicial: EstadoWhatsapp = {};

/**
 * Contexto del cliente, al costado de la conversación.
 *
 * Las dos preguntas que llegan por WhatsApp a una maderera son «¿ya está listo
 * lo mío?» y «¿cuánto debo?». Tenerlas contestadas antes de leer el mensaje es
 * la diferencia entre responder en diez segundos o abrir tres pantallas.
 */
export function PanelCliente({ detalle, enDialogo = false }: { detalle: DetalleConversacion; enDialogo?: boolean }) {
  // El corte que se toma desde el chat vuelve al chat, con el número de la
  // conversación por si la ficha no tiene teléfono (mes simulado, H046).
  const ruta = usePathname();
  const volver = encodeURIComponent(`${ruta}?chat=${detalle.id}`);
  const telefono = detalle.sinNumero ? "" : `&telefono=${encodeURIComponent(detalle.waJid.split("@")[0])}`;
  // En la columna queda pegado arriba al bajar; en el diálogo, no.
  const pegado = enDialogo ? "" : "lg:sticky lg:top-24";
  if (!detalle.customerId) {
    return (
      <div className={`min-w-0 space-y-4 ${pegado}`}>
        <SinFicha detalle={detalle} />
        <Avisos detalle={detalle} />
      </div>
    );
  }

  const excedido = detalle.limiteCredito > 0 && detalle.saldo > detalle.limiteCredito;
  const enCurso = detalle.documentos.filter((d) => d.tipo === "presupuesto" || d.tipo === "corte").slice(0, 4);

  return (
    // `min-w-0`: en el diálogo (que vive fuera del panel) el nombre sin
    // cortar empujaba las tarjetas más allá del borde («Activ», «Pendien»).
    <div className={`min-w-0 space-y-4 ${pegado}`}>
      <section className="tarjeta p-4">
        <div className="flex items-start justify-between gap-2">
          {/* En el diálogo el nombre ya es el título: dos renglones seguidos
              con el mismo nombre (mes simulado). El correo, entero. */}
          <div className="min-w-0">
            {!enDialogo && <h2 className="break-words text-base font-medium">{detalle.clienteNombre}</h2>}
            {detalle.clienteEmail && <p className="break-all text-sm text-muted-foreground">{detalle.clienteEmail}</p>}
          </div>
          {detalle.clienteEstado && <EtiquetaEstado estado={detalle.clienteEstado} />}
        </div>

        <Link
          href={`/admin/clientes/${detalle.customerId}`}
          className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg border text-base font-medium transition-colors hover:bg-muted"
        >
          Abrir ficha completa
        </Link>
        {/* Lo que se pide por WhatsApp se arma desde acá, con el cliente
            ya puesto. */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Link
            href={`/admin/presupuestos/nuevo?cliente=${detalle.customerId}${detalle.sinNumero ? "" : `&telefono=${encodeURIComponent(jidCorto(detalle.waJid))}`}`}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-hundida text-base font-medium hover:bg-muted"
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Presupuesto
          </Link>
          <Link
            href={`/admin/cortes/nuevo?cliente=${detalle.customerId}&volver=${volver}${telefono}`}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-hundida text-base font-medium hover:bg-muted"
          >
            <Scissors className="h-4 w-4" aria-hidden="true" />
            Corte
          </Link>
        </div>
      </section>

      <section className="tarjeta p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Wallet className="h-4 w-4" />
          Cuenta corriente
        </h3>
        <p
          className={`tabular mt-1.5 text-2xl font-semibold ${
            excedido ? "text-saldo-debe" : detalle.saldo > 0 ? "text-brand-orange-dark" : "text-saldo-favor"
          }`}
        >
          {formatearMonto(Math.abs(detalle.saldo))}
        </p>
        <p className="mt-0.5 text-base text-muted-foreground">
          {detalle.saldo > 0 ? "Debe" : detalle.saldo < 0 ? "A favor" : "Sin deuda"}
          {detalle.limiteCredito > 0 && !detalle.clienteBloqueado && <> · límite {moneda.format(detalle.limiteCredito)}</>}
        </p>
        {/* Bloqueada, lo que importa es eso, no el límite (M3S1-017). */}
        {detalle.clienteBloqueado ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-base font-medium text-destructive">
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            Cuenta bloqueada
          </p>
        ) : (
          excedido && <p className="mt-1.5 text-base text-saldo-debe">Supera el límite. No debería llevarse más a cuenta.</p>
        )}

      </section>

      {/* Lo que está en curso además de los pedidos: el presupuesto y el
          corte que salieron de la charla (M2S3-072). */}
      {enCurso.length > 0 && (
        <section className="tarjeta overflow-hidden">
          <h3 className="px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Presupuestos y cortes
          </h3>
          <ul className="divide-y border-t">
            {enCurso.map((d) => (
              <li key={`${d.tipo}-${d.id}`}>
                <Link
                  href={d.tipo === "corte" ? `/admin/cortes/${d.id}` : `/admin/presupuestos/${d.id}`}
                  className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/60"
                >
                  {d.tipo === "corte" ? (
                    <Scissors className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="codigo block text-base">{d.titulo.replace(/^(Presupuesto|Corte) /, "")}</span>
                    <span className="block text-sm text-muted-foreground">
                      {d.fecha ? fechaCorta.format(new Date(d.fecha)) : ""}
                      {d.tipo === "presupuesto" ? ` · ${d.detalle}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tarjeta overflow-hidden">
        <h3 className="px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Últimos pedidos</h3>
        {detalle.pedidos.length === 0 ? (
          <p className="border-t px-4 py-5 text-center text-base text-muted-foreground">Sin pedidos todavía.</p>
        ) : (
          <ul className="divide-y border-t">
            {detalle.pedidos.map((pedido) => (
              <li key={pedido.id}>
                <Link
                  href={`/admin/pedidos/${pedido.id}`}
                  className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="tabular block text-base">{pedido.numero}</span>
                    <span className="block text-sm text-muted-foreground">
                      {fechaCorta.format(new Date(pedido.createdAt))}
                      {pedido.sucursal ? ` · ${pedido.sucursal}` : ""}
                    </span>
                  </span>
                  <EtiquetaEstado estado={pedido.estado} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Avisos detalle={detalle} />
    </div>
  );
}

/** Si este número recibe los avisos automáticos, y el botón para cambiarlo. */
function Avisos({ detalle }: { detalle: DetalleConversacion }) {
  const [estado, accion, pendiente] = useActionState(cambiarBaja, estadoInicial);
  const baja = Boolean(detalle.bajaAt);

  return (
    <section className="tarjeta-hundida p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {baja ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
        Avisos automáticos
      </h3>
      <p className="mt-1.5 text-base">
        {baja ? "No los recibe: pidió la baja." : "Los recibe, si están prendidos en la configuración."}
      </p>
      <form action={accion} className="mt-2">
        <input type="hidden" name="conversacionId" value={detalle.id} />
        <input type="hidden" name="baja" value={baja ? "no" : "si"} />
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-background px-3 text-base transition-colors hover:bg-muted disabled:opacity-60"
        >
          {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
          {baja ? "Volver a mandarle avisos" : "No mandarle más avisos"}
        </button>
      </form>
      {estado.ok && (
        <p role="status" className="mt-1.5 text-sm text-saldo-favor">
          {estado.ok}
        </p>
      )}
      {/* Si escribe BAJA se registra solo; con ALTA vuelve. */}
    </section>
  );
}

/**
 * Conversación de un número que no está en la base.
 *
 * Pasa seguido: alguien pregunta por un precio antes de ser cliente. Se ofrece
 * buscar la ficha —puede estar con otro teléfono— o crearla en el momento, con
 * el número ya puesto.
 */
function SinFicha({ detalle }: { detalle: DetalleConversacion }) {
  const [vinculo, accionVincular, vinculando] = useActionState(vincularCliente, estadoInicial);
  const [alta, accionAlta, creando] = useActionState(crearFichaDesdeConversacion, estadoInicial);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Awaited<ReturnType<typeof buscarClientesParaVincular>>>([]);
  const [buscando, iniciar] = useTransition();
  const [creandoFicha, setCreandoFicha] = useState(false);

  function buscar(valor: string) {
    setTexto(valor);
    if (valor.trim().length < 2) {
      setResultados([]);
      return;
    }
    iniciar(async () => setResultados(await buscarClientesParaVincular(valor)));
  }

  return (
    <section className="tarjeta p-4">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <UserPlus className="h-5 w-5 text-muted-foreground" />
        Sin ficha de cliente
      </h2>
      {/* El número no coincide con ningún cliente: si ya es cliente se lo busca; si no, se le crea la ficha. */}

      <label className="mt-3 block">
        <span className="sr-only">Buscar cliente</span>
        <span className="relative block">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={texto}
            onChange={(e) => buscar(e.target.value)}
            placeholder="Nombre, CUIT o teléfono"
            className="h-10 w-full rounded-lg border bg-background pl-8 pr-2.5 text-base"
          />
        </span>
      </label>

      {buscando && <p className="mt-2 text-sm text-muted-foreground">Buscando…</p>}
      {resultados.length > 0 && (
        <ul className="mt-2 divide-y rounded-lg border">
          {resultados.map((c) => (
            <li key={c.id}>
              <form action={accionVincular} className="flex items-center gap-2 px-3 py-2">
                <input type="hidden" name="conversacionId" value={detalle.id} />
                <input type="hidden" name="customerId" value={c.id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base">{c.nombre}</span>
                  <span className="tabular block truncate text-sm text-muted-foreground">{c.telefono ? telefonoLegible(c.telefono) : (c.cuit ?? "")}</span>
                </span>
                <button
                  type="submit"
                  disabled={vinculando}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
                >
                  <Link2 className="h-4 w-4" />
                  Vincular
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {texto.trim().length >= 2 && !buscando && resultados.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">No hay clientes con eso.</p>
      )}
      {vinculo.error && <p role="alert" className="mt-2 text-base text-saldo-debe">{vinculo.error}</p>}

      {!creandoFicha ? (
        <button
          type="button"
          onClick={() => setCreandoFicha(true)}
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border text-base font-medium transition-colors hover:bg-muted"
        >
          <UserPlus className="h-5 w-5" />
          Crear la ficha
        </button>
      ) : (
        <form action={accionAlta} className="mt-3 space-y-2 border-t pt-3">
          <input type="hidden" name="conversacionId" value={detalle.id} />
          <label className="block">
            <span className="text-sm text-muted-foreground">Nombre o razón social</span>
            <input
              name="nombre"
              required
              defaultValue={detalle.displayName ?? ""}
              className="mt-0.5 h-10 w-full rounded-lg border bg-background px-2.5 text-base"
            />
          </label>
          <label className="block">
            <span className="text-sm text-muted-foreground">CUIT o DNI (opcional)</span>
            <input name="documento" inputMode="numeric" className="tabular mt-0.5 h-10 w-full rounded-lg border bg-background px-2.5 text-base" />
          </label>
          <label className="block">
            <span className="text-sm text-muted-foreground">Correo (opcional)</span>
            <input name="email" type="email" className="mt-0.5 h-10 w-full rounded-lg border bg-background px-2.5 text-base" />
          </label>
          <p className="tabular text-sm text-muted-foreground">
            Teléfono: {detalle.sinNumero ? "WhatsApp no lo comparte" : jidCorto(detalle.waJid)}
          </p>
          <button
            type="submit"
            disabled={creando}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-verde-whatsapp text-base font-medium text-white hover:bg-brand-green/90 disabled:opacity-60"
          >
            {creando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar ficha
          </button>
          {alta.error && <p role="alert" className="text-base text-saldo-debe">{alta.error}</p>}
        </form>
      )}
    </section>
  );
}
