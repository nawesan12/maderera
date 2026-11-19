"use client";

import Link from "next/link";
import { ClipboardList, Loader2, Plus, FileText, Printer } from "lucide-react";
import type { PromoVigente } from "@/lib/dal/contenido";
import { formatearMonto } from "@/lib/formato";
import type { TipoDescuento, MedioDeMostrador } from "@/lib/mostrador/importes";
import { medioPermitido } from "@/lib/precios/medio-pago";
import { BuscadorDeCliente, CuitSuelto } from "./cliente";
import {
  MEDIOS_DE_CONTADO,
  type TipoDeOperacion,
  TIPOS_DE_OPERACION,
  esElTipo,
  type ParteDePago,
  type ChequeEnPantalla,
} from "./medios";
import { CamposDeCheque, DatosDeTarjeta, PagoPartido } from "./medios-de-pago";
import { PromosDelBanco } from "./promos";
import { type Cliente, type UltimaVenta, papelDeLaVenta } from "./tipos";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";

export function Cobro({
  cheque,
  onCheque,
  branchId,
  buscarClienteLocal,
  subtotal,
  descuento,
  etiquetaDelDescuento,
  tipoDesc,
  onTipoDesc,
  valorDesc,
  onValorDesc,
  motivoDesc,
  onMotivoDesc,
  total,
  cliente,
  onCliente,
  otrosPrecios,
  onAplicarPrecios,
  comprobante,
  onComprobante,
  cuit,
  onCuit,
  letra,
  medio,
  onMedio,
  listaGeneral,
  recibido,
  onRecibido,
  cambio,
  hayCaja,
  enviando,
  puede,
  puedeCobrar,
  onCobrar,
  porAutorizar,
  pidePin,
  onPin,
  onCancelarPin,
  aviso,
  ultima,
  acopio,
  onTipo,
  onPartir,
  promos,
  tarjeta,
  onTarjeta,
  partes,
  onPartes,
  restante,
  enLinea,
  onRemito,
  onPresupuesto,
}: {
  subtotal: number;
  descuento: number;
  /** El motivo tipeado o el nombre de la escala de la forma de pago. */
  etiquetaDelDescuento: string;
  tipoDesc: TipoDescuento;
  onTipoDesc: (t: TipoDescuento) => void;
  valorDesc: string;
  onValorDesc: (v: string) => void;
  motivoDesc: string;
  onMotivoDesc: (v: string) => void;
  total: number;
  cliente: Cliente | null;
  onCliente: (c: Cliente | null) => void;
  otrosPrecios: boolean;
  onAplicarPrecios: () => void;
  comprobante: "interno" | "fiscal";
  onComprobante: (c: "interno" | "fiscal") => void;
  cuit: string;
  onCuit: (v: string) => void;
  letra: string | null;
  medio: MedioDeMostrador;
  onMedio: (m: MedioDeMostrador) => void;
  /** La lista general: lo que no sea esta es precio de profesional. */
  listaGeneral: string | null;
  recibido: string;
  onRecibido: (v: string) => void;
  cambio: number | null;
  hayCaja: boolean;
  enviando: boolean;
  /** Hay algo cargado: alcanza para un presupuesto. */
  puede: boolean;
  /** Además, están los datos que la venta necesita para cobrarse. */
  puedeCobrar: boolean;
  onCobrar: () => void;
  /** Lo que la venta deja de cobrar pasado lo libre: va a pedir el PIN. */
  porAutorizar: number;
  /** Go pidió el PIN de un admin: el campo va en el lugar del botón. */
  pidePin: Autorizacion | null;
  onPin: (pin: string) => void;
  onCancelarPin: () => void;
  aviso: { tipo: "ok" | "error"; texto: string } | null;
  ultima: UltimaVenta | null;
  acopio: boolean;
  /** Elegir contado, cuenta corriente o acopio: acomoda el medio de pago. */
  onTipo: (t: TipoDeOperacion) => void;
  /** Abrir el pago partido con dos renglones. */
  onPartir: () => void;
  promos: PromoVigente[];
  tarjeta: { nroLote: string; nroCupon: string; marca: string; cuotas: number };
  onTarjeta: (v: {
    nroLote: string;
    nroCupon: string;
    marca: string;
    cuotas: number;
  }) => void;
  partes: ParteDePago[] | null;
  onPartes: (v: ParteDePago[] | null) => void;
  cheque: ChequeEnPantalla;
  onCheque: (c: ChequeEnPantalla) => void;
  /** Lo que falta repartir en el pago partido. Cero es "cierra". */
  restante: number;
  enLinea: boolean;
  branchId: string;
  /** La copia local del padrón de clientes. */
  buscarClienteLocal: (texto: string) => Cliente[];
  onRemito: () => void;
  onPresupuesto: () => void;
}) {
  const faltaCaja = medio === "efectivo" && !hayCaja;

  /*
   * El precio de profesional es de contado.
   *
   * `registrarVentaDeMostrador` lo rechaza igual, pero enterarse al cobrar es
   * tarde: hay alguien esperando enfrente y ya se cargó toda la venta. Acá el
   * crédito se apaga apenas se elige el cliente, y el cartel dice cuál es la
   * salida —cobrar a consumidor final, que es precio de catálogo—.
   */
  const precioProfesional =
    cliente?.priceListId != null && cliente.priceListId !== listaGeneral;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-linea p-4">
        <BuscadorDeCliente
          cliente={cliente}
          onCliente={onCliente}
          branchId={branchId}
          enLinea={enLinea}
          buscarLocal={buscarClienteLocal}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/*
          Qué clase de operación es. Va primero porque decide el resto: contado
          deja elegir el medio, cuenta corriente lo fija y acopio reserva en vez
          de entregar.

          La clienta pidió "más tipos de factura, como de acopio, cuenta
          corriente, contado". Leído de cerca, no son tipos de comprobante
          fiscal —esos los decide la condición de IVA del cliente y no se
          eligen— sino **tres formas distintas de vender**, y las tres ya
          existían repartidas en controles que no se miraban juntos: un
          checkbox acá, un medio de pago allá.

          Puestas en un solo lugar se elige una vez y la pantalla se acomoda. El
          botón de cobrar y el papel que sale después dicen cuál fue.
        */}
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tipo de operación
        </p>
        <div
          className="mt-2.5 grid grid-cols-3 gap-2"
          role="group"
          aria-label="Tipo de operación"
        >
          {TIPOS_DE_OPERACION.map((t) => {
            const activo = esElTipo(t.clave, acopio, medio);
            return (
              <button
                key={t.clave}
                type="button"
                aria-pressed={activo}
                onClick={() => onTipo(t.clave)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  activo
                    ? "border-accion bg-accion/10"
                    : "border-linea hover:bg-hundida"
                }`}
              >
                <span className="block text-base font-medium">{t.texto}</span>
                <span className="block text-sm text-muted-foreground">
                  {t.detalle}
                </span>
              </button>
            );
          })}
        </div>

        {/*
          Lo que se toca en toda venta, en dos columnas: cómo paga y con cuánto,
          contra el descuento y el papel. En el panel angosto de antes esto era
          una fila atrás de la otra y había que scrollear para llegar al vuelto,
          que es lo último que se tipea antes de cobrar.
        */}
        <div className="mt-5 grid gap-x-4 gap-y-5 xl:grid-cols-2">
          <div className="min-w-0">
            {/* En cuenta corriente no se elige medio: el medio *es* la cuenta
                corriente, y tenerlo dos veces en pantalla era el control
                duplicado que hacía elegir lo mismo dos veces. En su lugar, la
                columna dice a quién se le anota, que es el dato que falta. */}
            {medio === "cuenta_corriente" && (
              <>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Se le anota a
                </p>
                {cliente ? (
                  <p className="mt-2.5 rounded-xl border border-linea p-3.5 text-base">
                    {/* Se lleva la mercadería y el total queda como deuda en su cuenta. */}
                    <span className="font-medium">{cliente.nombre}</span>
                  </p>
                ) : (
                  <p className="estado-espera mt-2.5 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-base text-[var(--estado-tinta)]">
                    Elegí el cliente.{" "}
                    <kbd className="whitespace-nowrap rounded border border-current px-1.5 py-0.5 text-xs">
                      Alt + C
                    </kbd>
                  </p>
                )}
              </>
            )}

            {medio !== "cuenta_corriente" && (
              <>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Cómo paga
                </p>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {MEDIOS_DE_CONTADO.map(({ valor, texto }, i) => {
                    const bloqueado =
                      precioProfesional && !medioPermitido(valor, true);

                    return (
                      <button
                        key={valor}
                        onClick={() => !bloqueado && onMedio(valor)}
                        disabled={bloqueado}
                        title={
                          bloqueado
                            ? "El precio de profesional es de contado."
                            : `Alt + ${i + 1}`
                        }
                        className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-base font-medium transition-colors ${
                          medio === valor
                            ? "border-accion bg-accion text-white"
                            : "border-linea hover:bg-hundida"
                        } ${
                          bloqueado
                            ? "cursor-not-allowed opacity-40 hover:bg-transparent"
                            : ""
                        }`}
                      >
                        {texto}
                      </button>
                    );
                  })}
                </div>


                {precioProfesional && (
                  <p className="mt-2 rounded-lg bg-hundida px-3 py-2 text-sm text-muted-foreground">
                    {/* En cuotas con tarjeta corre el precio de catálogo, así que la venta va a consumidor final. */}
                    Precio de profesional: en cuotas va a consumidor final.
                  </p>
                )}
              </>
            )}

            {medio === "efectivo" && !partes && (
              <label className="mt-4 block">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Con cuánto paga
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={recibido}
                  onChange={(e) => onRecibido(e.target.value)}
                  data-foco="recibido"
                  onKeyDown={(e) => {
                    // Es el último dato de la venta en efectivo: Enter cobra.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (puedeCobrar) onCobrar();
                    }
                  }}
                  placeholder="0"
                  className="tabular mt-1.5 h-14 w-full rounded-xl border border-linea bg-background px-3.5 text-right text-2xl font-semibold"
                />
                {cambio !== null && (
                  <span className="mt-2 flex items-baseline justify-between text-lg">
                    <span className="text-muted-foreground">Vuelto</span>
                    <span className="tabular font-bold text-saldo-favor">
                      {formatearMonto(cambio)}
                    </span>
                  </span>
                )}
              </label>
            )}

            {faltaCaja && (
              <p className="estado-problema mt-3 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-base text-[var(--estado-tinta)]">
                No hay caja abierta en esta sucursal. Abrila para poder cobrar en
                efectivo.
              </p>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Descuento
            </p>
            <div className="mt-2.5 flex gap-2">
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-linea">
                {(["porcentaje", "monto"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => onTipoDesc(t)}
                    className={`h-12 px-3.5 text-base font-medium transition-colors ${
                      tipoDesc === t ? "bg-accion text-white" : "hover:bg-hundida"
                    }`}
                  >
                    {t === "porcentaje" ? "%" : "$"}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={valorDesc}
                onChange={(e) => onValorDesc(e.target.value)}
                data-foco="descuento"
                placeholder="0"
                className="tabular h-12 min-w-0 flex-1 rounded-lg border border-linea bg-background px-3 text-right text-base"
              />
            </div>

            {/* El motivo, en su propia línea: al lado del importe no entraba y
                es lo que después explica el descuento en el cierre. */}
            <input
              value={motivoDesc}
              onChange={(e) => onMotivoDesc(e.target.value)}
              placeholder="Motivo del descuento"
              className="mt-2 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />

            <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Qué se lleva
            </p>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                onClick={() => onComprobante("interno")}
                className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-base font-medium transition-colors ${
                  comprobante === "interno"
                    ? "border-accion bg-accion text-white"
                    : "border-linea hover:bg-hundida"
                }`}
              >
                Comprobante
              </button>
              <button
                onClick={() => onComprobante("fiscal")}
                className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-base font-medium transition-colors ${
                  comprobante === "fiscal"
                    ? "border-accion bg-accion text-white"
                    : "border-linea hover:bg-hundida"
                }`}
              >
                {/* La letra la calcula el servidor con la condición de las dos
                    partes. Antes de que conteste se dice "Factura" a secas:
                    mejor eso que anunciar una letra que después cambia. */}
                {letra ? `Factura ${letra}` : "Factura"}
              </button>
            </div>

            {comprobante === "fiscal" && !cliente && (
              <CuitSuelto
                cuit={cuit}
                onCuit={onCuit}
                enLinea={enLinea}
                onCliente={onCliente}
              />
            )}
          </div>
        </div>

        {/* El cheque de un pago de un solo medio. */}
        {!partes && medio === "cheque" && (
          <CamposDeCheque valor={cheque} onCambio={onCheque} />
        )}

        {/* La tarjeta de un pago de un solo medio: marca, lote, cupón y cuotas. */}
        {!partes && (
          <DatosDeTarjeta
            medio={medio}
            tarjeta={tarjeta}
            onTarjeta={onTarjeta}
            total={total}
          />
        )}

        {/* El pago partido, cada renglón con su medio y su importe. */}
        {partes !== null && (
          <PagoPartido partes={partes} onPartes={onPartes} restante={restante} />
        )}

        {/* Lo que se consulta de vez en cuando, plegado y junto: partir el pago
            —una venta de cada tantas— y las promociones de los bancos, que se
            abren cuando el cliente pregunta "¿qué promociones tienen?". Están
            para decirlas, no para descontarlas. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {partes === null && (
            <button
              type="button"
              onClick={() => onPartir()}
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Partir el pago en más de un medio
            </button>
          )}
          <PromosDelBanco promos={promos} />
        </div>

        {otrosPrecios && (
          <div className="estado-info mt-4 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-[var(--estado-tinta)]">
            <p className="text-base leading-relaxed">
              {cliente?.nombre} tiene otra lista de precios. Los productos que ya
              cargaste están a precio de mostrador.
            </p>
            <button
              onClick={onAplicarPrecios}
              className="mt-2.5 inline-flex h-10 items-center rounded-lg bg-[var(--estado-tinta)] px-3.5 text-sm font-semibold text-[var(--estado-fondo)]"
            >
              Aplicar su lista
            </button>
          </div>
        )}


      </div>

      {/* Cómo salió la venta. Fuera del scroll a propósito: un "no se pudo
          cobrar" al final de una columna que hay que scrollear es un aviso que
          nadie lee. */}
      {aviso && (
        <div
          className={`border-t border-linea px-4 py-3 text-base ${
            aviso.tipo === "ok" ? "estado-ok" : "estado-problema"
          } bg-[var(--estado-fondo)] text-[var(--estado-tinta)]`}
        >
          <p>{aviso.texto}</p>
        </div>
      )}

      {/* El papel de la venta recién cobrada, fuera del scroll.
          Es lo primero que se toca después de cobrar y estaba al final de una
          columna que había que scrollear, con el cliente esperando el ticket en
          la mano. */}
      {ultima && (
        <div className="flex flex-wrap gap-2 border-t border-linea px-4 py-3">
          {/* Si salió factura se imprime la factura, que es el papel que vale.
              Si no, el ticket del pedido, que dice expresamente que no es un
              comprobante fiscal. Las dos rutas piden ids distintos: la primera
              el de la factura, la segunda el del pedido. */}
          <Link
            href={papelDeLaVenta(ultima)}
            target="_blank"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
          >
            <Printer className="h-4 w-4 shrink-0" />
            Imprimir {ultima.numero}
            <kbd className="rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
              Alt + I
            </kbd>
          </Link>
          {!ultima.invoiceId && (
            <Link
              href={`/admin/facturacion?pedido=${ultima.orderId}`}
              target="_blank"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
            >
              <Plus className="h-4 w-4 shrink-0" />
              Facturar
            </Link>
          )}

          {/* El remito del retiro: qué se llevó y si pagó. En un acopio no
              se llevó nada todavía; el retiro se registra en la ficha del
              pedido, que es lo que descuenta el stock. */}
          {ultima.orderId &&
            (ultima.acopio ? (
              <Link
                href={`/admin/pedidos/${ultima.orderId}`}
                target="_blank"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
              >
                <FileText className="h-4 w-4" />
                Registrar retiro
              </Link>
            ) : ultima.remitoId ? (
              <Link
                href={`/remito/${ultima.remitoId}`}
                target="_blank"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
              >
                <Printer className="h-4 w-4" />
                Remito
              </Link>
            ) : (
              <button
                type="button"
                onClick={onRemito}
                disabled={enviando}
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida disabled:opacity-50"
              >
                <FileText className="h-4 w-4 shrink-0" />
                Remito
              </button>
            ))}
        </div>
      )}

      <div className="border-t border-linea p-4">
        {descuento > 0 && (
          <>
            <p className="flex items-baseline justify-between text-base text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular">{formatearMonto(subtotal)}</span>
            </p>
            <p className="flex items-baseline justify-between text-base">
              <span className="text-muted-foreground">
                Descuento{etiquetaDelDescuento ? ` · ${etiquetaDelDescuento}` : ""}
              </span>
              <span className="tabular font-semibold text-saldo-favor">
                −{formatearMonto(descuento)}
              </span>
            </p>
          </>
        )}

        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">Total</span>
          {/* Pasado lo libre, el total se pone naranja y dice cuánto queda
              abajo del precio: se llama al admin mientras se termina de cargar. */}
          <span className="text-right">
            <span
              className={`tabular block text-[34px] font-bold leading-none tracking-tight ${porAutorizar > 0 ? "text-brand-orange" : ""}`}
            >
              {formatearMonto(total)}
            </span>
            {porAutorizar > 0 && !pidePin && (
              <span className="tabular mt-1 block text-sm font-semibold text-brand-orange">
                {formatearMonto(porAutorizar)} abajo del precio · PIN admin
              </span>
            )}
          </span>
        </div>

        {/* El PIN de un admin en el lugar del botón: la venta no se corta, no
            abre otra pantalla. Enter reenvía la misma venta y Esc vuelve. */}
        {pidePin ? (
          <div className="mt-3.5">
            <CampoPin autorizacion={pidePin} enviando={enviando} onEnviar={onPin} onCancelar={onCancelarPin} grande />
          </div>
        ) : (
        /* Cobrar y el presupuesto en la misma fila: el presupuesto es de cada
            tantas ventas y no necesita el ancho entero, y esos 55 px de alto
            son los que hacían falta arriba. */
        <div className="mt-3.5 flex gap-2">
          <button
            onClick={() => onCobrar()}
            disabled={!puedeCobrar}
            className="inline-flex h-16 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-xl bg-accion text-xl font-bold text-white transition-colors hover:bg-accion-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                {acopio ? "Cobrar y dejar en acopio" : "Cobrar"}
                <kbd className="rounded border border-white/40 px-1.5 py-0.5 text-xs font-medium">
                  Ctrl + Enter
                </kbd>
              </>
            )}
          </button>

          {/* El papel para quien pregunta un precio y se va a pensarlo: mismo
              carro, sin cobrar. Necesita servidor porque numera y arma el PDF. */}
          <button
            type="button"
            onClick={onPresupuesto}
            disabled={!puede || enviando || !enLinea}
            title={
              !enLinea
                ? "Sin conexión no se puede numerar el presupuesto."
                : "Emitir presupuesto sin cobrar · Alt + U"
            }
            className="inline-flex h-16 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-linea text-sm font-medium transition-colors hover:bg-hundida disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ClipboardList className="h-4 w-4" />
            Presupuesto
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
