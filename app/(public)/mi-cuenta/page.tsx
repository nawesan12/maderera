import Link from "next/link";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import {
  ArrowRight,
  MessageCircle,
  PackageOpen,
  Receipt,
  Scissors,
  ScrollText,
} from "lucide-react";
import { TarjetaPedido } from "@/components/cuenta/tarjeta-pedido";
import { misMovimientos } from "@/lib/dal/historial-cliente";
import {
  clienteDeLaSesion,
  miCuentaCorriente,
  misPedidos,
  misPresupuestos,
  resumenCuenta,
  type MovimientoConSaldo,
} from "@/lib/dal/cuenta";
import { pedidosEnCurso, saludoDelCliente } from "@/lib/cuenta/portal";
import { estiloDeEstado } from "@/components/admin/etiqueta-estado";
import { diasHasta, fechaCorta, formatearMonto, plural } from "@/lib/formato";
import { RespuestaPresupuesto } from "./presupuestos/respuesta";
import { DONDE_SE_CORTA } from "@/lib/sucursales";
import { tienda } from "@/lib/dal/contenido";

export default async function ResumenCuentaPage() {
  const [cliente, resumen, pedidos, presupuestos] = await Promise.all([
    clienteDeLaSesion(),
    resumenCuenta(),
    misPedidos(),
    misPresupuestos(),
  ]);

  const enCurso = pedidos.filter(
    (p) => p.estado !== "entregado" && p.estado !== "cancelado",
  );
  const aResponder = presupuestos.filter((p) => p.aResponder);
  const operaACuenta = resumen.limiteCredito > 0 || resumen.saldo !== 0;

  // Cuenta recién creada y sin actividad: en vez de tres tarjetas vacías, se
  // muestra por dónde empezar.
  if (pedidos.length === 0 && presupuestos.length === 0 && !operaACuenta) {
    return (
      <Bienvenida
        nombre={cliente ? saludoDelCliente(cliente.nombre, cliente.cuit) : ""}
        vinculada={cliente?.vinculada ?? false}
      />
    );
  }

  // Lo último que movió el saldo y cuánto es de pedidos sin entregar: sin
  // eso el saldo subía o bajaba sin decir por qué (H303, H082).
  const [cuenta, recientes] = operaACuenta
    ? await Promise.all([miCuentaCorriente(), misMovimientos({ periodo: "3m", filtro: "todo" })])
    : [null, null];
  const ultimo = cuenta?.movimientos[0];
  // Lo informado que se está verificando, como en la cuenta corriente: el
  // resumen decía «Pendiente de pago» sin mencionarlo (M2S2-117).
  const enRevision = (recientes?.movimientos ?? [])
    .filter((m) => m.clase === "pago_en_revision" || m.clase === "cheque_por_recibir")
    .reduce((t, m) => t + Math.abs(m.importeInformativo ?? 0), 0);

  return (
    <div className="space-y-8">
      {/* Lo que espera una decisión va primero y con borde de acento. */}
      {aResponder.length > 0 && (
        <section>
          <EncabezadoSeccion
            titulo="Esperan tu respuesta"
            detalle={plural(aResponder.length, "presupuesto")}
            destacado
          />
          <div className="mt-3 space-y-3">
            {aResponder.map((presupuesto) => {
              const dias = diasHasta(presupuesto.validoHasta);

              return (
                <article
                  key={presupuesto.id}
                  className="rounded-xl border-2 border-brand-orange/35 bg-card p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div>
                      <Link
                        href={`/mi-cuenta/presupuestos/${presupuesto.numero}`}
                        className="tabular font-semibold hover:text-brand-orange"
                      >
                        {presupuesto.numero}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {plural(presupuesto.items, "producto")} ·{" "}
                        {fechaCorta.format(presupuesto.createdAt)}
                        {dias !== null && (
                          <>
                            {" · "}
                            <span
                              className={
                                dias <= 3 ? "text-brand-orange-dark" : undefined
                              }
                            >
                              {dias > 0
                                ? `vale ${plural(dias, "día")} más`
                                : "vencido"}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="tabular text-2xl font-semibold">
                      {formatearMonto(presupuesto.total)}
                    </span>
                  </div>

                  <div className="mt-4">
                    <RespuestaPresupuesto numero={presupuesto.numero} desde="resumen" />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Cuenta corriente, con el crédito disponible medido */}
      {operaACuenta && (
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-end justify-between gap-4 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Cuenta corriente
              </p>
              <p
                className={`tabular mt-1 text-3xl font-semibold ${
                  resumen.saldo > 0
                    ? "text-saldo-debe"
                    : resumen.saldo < 0
                      ? "text-saldo-favor"
                      : "text-saldo-cero"
                }`}
              >
                {formatearMonto(Math.abs(resumen.saldo))}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {resumen.saldo > 0
                  ? "Pendiente de pago"
                  : resumen.saldo < 0
                    ? "A tu favor"
                    : "Estás al día"}
                {cuenta && cuenta.sinEntregar > 0 && (
                  <>
                    {" · "}
                    <span className="tabular">
                      {formatearMonto(cuenta.sinEntregar)}
                    </span>{" "}
                    de pedidos sin entregar
                  </>
                )}
                {resumen.saldo > 0 && enRevision > 0 && (
                  <>
                    {" · "}
                    <span className="tabular">{formatearMonto(enRevision)}</span> en revisión
                  </>
                )}
              </p>
              {ultimo && <UltimoMovimiento movimiento={ultimo} />}
            </div>

            <Link
              href="/mi-cuenta/cuenta-corriente"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-acento-texto hover:underline"
            >
              Ver movimientos
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Bloqueada, no se ofrece lo disponible (M3S1-017). */}
          {resumen.limiteCredito > 0 && resumen.cuentaPausada && (
            <p className="border-t bg-sitio-alt px-5 py-4 text-sm font-medium text-saldo-debe">Cuenta corriente pausada</p>
          )}
          {resumen.limiteCredito > 0 && !resumen.cuentaPausada && (
            <MedidorCredito
              saldo={resumen.saldo}
              limite={resumen.limiteCredito}
            />
          )}
        </section>
      )}

      {/* Pedidos en curso */}
      <section>
        <EncabezadoSeccion
          titulo={enCurso.length > 0 ? "Pedidos en curso" : "Tus pedidos"}
          detalle={
            enCurso.length > 0 ? pedidosEnCurso(enCurso.length) : undefined
          }
          verMas={pedidos.length > 0 ? "/mi-cuenta/pedidos" : undefined}
        />

        <div className="mt-3 space-y-3">
          {enCurso.length > 0 ? (
            enCurso
              .slice(0, 3)
              .map((pedido) => (
                <TarjetaPedido key={pedido.id} pedido={pedido} />
              ))
          ) : pedidos.length > 0 ? (
            <p className="rounded-xl border border-dashed bg-card/60 px-5 py-6 text-center text-muted-foreground">
              No tenés pedidos en curso. El último fue{" "}
              <Link
                href={`/mi-cuenta/pedidos/${pedidos[0].numero}`}
                className="tabular font-medium text-acento-texto hover:underline"
              >
                {pedidos[0].numero}
              </Link>
              .
            </p>
          ) : (
            <p className="rounded-xl border border-dashed bg-card/60 px-5 py-6 text-center text-muted-foreground">
              Todavía no hiciste ningún pedido.
            </p>
          )}
        </div>
      </section>

      <AccesosRapidos />
    </div>
  );
}

function EncabezadoSeccion({
  titulo,
  detalle,
  verMas,
  destacado = false,
}: {
  titulo: string;
  detalle?: string;
  verMas?: string;
  destacado?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="flex items-baseline gap-2.5 text-lg font-semibold">
        {titulo}
        {detalle && (
          <span
            className={`text-sm font-normal ${
              destacado ? "text-brand-orange-dark" : "text-muted-foreground"
            }`}
          >
            {detalle}
          </span>
        )}
      </h2>
      {verMas && (
        <Link
          href={verMas}
          className="shrink-0 text-sm font-medium text-acento-texto hover:underline"
        >
          Ver todos
        </Link>
      )}
    </div>
  );
}

/**
 * Cuánto del crédito está usado.
 *
 * El número solo no dice si queda margen para el próximo pedido; la barra
 * contra el límite sí, y sin hacer la resta.
 */
function MedidorCredito({ saldo, limite }: { saldo: number; limite: number }) {
  const usado = Math.max(saldo, 0);
  const porcentaje = Math.min((usado / limite) * 100, 100);
  const excedido = usado > limite;

  return (
    <div className="border-t bg-sitio-alt px-5 py-4">
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">
          {excedido ? "Superaste tu límite" : "Disponible para comprar"}
        </span>
        <span className="tabular font-medium">
          {formatearMonto(Math.max(limite - usado, 0))}
          <span className="text-muted-foreground">
            {" "}
            de {formatearMonto(limite)}
          </span>
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-black/10"
        role="img"
        aria-label={`Usás el ${Math.floor(porcentaje)} por ciento de tu límite de crédito`}
      >
        <div
          className={`h-full rounded-full ${
            excedido
              ? "bg-destructive"
              : porcentaje > 80
                ? "bg-amber-500"
                : "bg-brand-orange"
          }`}
          style={{ width: `${Math.max(porcentaje, usado > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function AccesosRapidos() {
  const accesos = [
    {
      href: "/catalogo",
      icono: PackageOpen,
      titulo: "Seguir comprando",
      texto: "Todo el catálogo, por rubro y por medida",
    },
    {
      href: "/corte",
      icono: Scissors,
      titulo: "Pedir un corte a medida",
      texto: `Mandanos el despiece y lo cortamos ${DONDE_SE_CORTA.frase}`,
    },
    {
      href: "/mi-cuenta/presupuestos",
      icono: ScrollText,
      titulo: "Mis presupuestos",
      texto: "Los que pediste y los que te pasamos",
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {accesos.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="group rounded-xl border bg-card p-4 transition-colors hover:border-brand-orange/40 hover:bg-brand-orange/[0.03]"
        >
          <a.icono className="h-5 w-5 text-brand-orange" />
          <p className="mt-2.5 font-medium">{a.titulo}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{a.texto}</p>
        </Link>
      ))}
    </section>
  );
}

/** Lo último que movió la cuenta, en un renglón. */
function UltimoMovimiento({
  movimiento: m,
}: {
  movimiento: MovimientoConSaldo;
}) {
  const cheque =
    m.tipo !== "nota_debito"
      ? null
      : /devuelto al cliente/i.test(m.detalle ?? "")
        ? "Cheque devuelto"
        : /rechazado/i.test(m.detalle ?? "")
          ? "Cheque rechazado"
          : null;
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-muted-foreground">
        {fechaCorta.format(m.createdAt)}
      </span>
      {/* El ajuste dice qué fue («Anulación del recibo REC-0006»): solo
          «Ajuste +$ 1.000» no decía nada (M2S1-153). */}
      <span className="font-medium">
        {cheque
          ? cheque
          : m.tipo === "ajuste" && m.detalle
            ? m.detalle
            : estiloDeEstado(m.tipo).etiqueta}
      </span>
      <span className={`tabular ${m.monto < 0 ? "text-saldo-favor" : ""}`}>
        {m.monto > 0 ? "+" : "−"}
        {formatearMonto(Math.abs(m.monto))}
      </span>
    </p>
  );
}

/** Primera visita: qué hacer, no un vacío con un ícono gris. */
async function Bienvenida({
  nombre,
  vinculada,
}: {
  nombre: string;
  vinculada: boolean;
}) {
  const [whatsapp, laTienda] = await Promise.all([enlaceWhatsapp(), tienda()]);
  // Con la tienda apagada no hay carrito (redirige al catálogo): los pasos son
  // los de verdad, y la consulta por WhatsApp es lo principal (comité del 25/11).
  const vende = laTienda.activa;
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="bg-brand-gray p-8 text-white">
          <h2 className="text-2xl font-bold">
            {nombre
              ? `Te damos la bienvenida, ${nombre}`
              : "Te damos la bienvenida"}
          </h2>
        </div>

        {vende ? (
          <div className="grid gap-4 p-6 sm:grid-cols-3">
            <Paso
              numero={1}
              titulo="Armá tu presupuesto"
              texto="Sumá productos del catálogo o pedí un corte a medida."
            />
            <Paso
              numero={2}
              titulo="Confirmá el pedido"
              texto="Elegís retiro en sucursal o envío, y cómo lo querés abonar."
            />
            <Paso
              numero={3}
              titulo="Seguilo desde acá"
              texto="Te mostramos en qué etapa está hasta que lo tenés en la obra."
            />
          </div>
        ) : (
          <div className="grid gap-4 p-6 sm:grid-cols-3">
            <Paso
              numero={1}
              titulo="Elegí del catálogo"
              texto="Medidas, maderas y placas que trabajamos."
            />
            <Paso
              numero={2}
              titulo="Consultanos"
              texto="Por WhatsApp te pasamos precio y disponibilidad."
            />
            <Paso
              numero={3}
              titulo="Seguilo desde acá"
              texto="Los presupuestos y pedidos que te armemos aparecen en tu cuenta."
            />
          </div>
        )}

        <div className="flex flex-wrap gap-3 border-t bg-sitio-alt px-6 py-5">
          {!vende && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-whatsapp-boton px-5 font-medium text-white transition-colors hover:bg-whatsapp-boton-hover"
            >
              <MessageCircle className="h-4 w-4" />
              Consultar por WhatsApp
            </a>
          )}
          <Link
            href="/catalogo"
            className={
              vende
                ? "inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark"
                : "inline-flex h-11 items-center gap-2 rounded-lg border border-linea bg-card px-5 font-medium transition-colors hover:bg-sitio-alt"
            }
          >
            Ver el catálogo
            <ArrowRight className="h-4 w-4" />
          </Link>
          {vende && (
            <Link
              href="/corte"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea bg-card px-5 font-medium transition-colors hover:bg-sitio-alt"
            >
              <Scissors className="h-4 w-4" />
              Pedir un corte a medida
            </Link>
          )}
        </div>
      </section>

      {/* A quien ya tiene la ficha del mostrador vinculada no se le ofrece
          vincularla (H090). */}
      {!vinculada && (
        <section className="rounded-xl border border-dashed p-5">
          <h3 className="flex items-center gap-2 font-medium">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            ¿Ya comprás en el mostrador?
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Si tenés cuenta corriente con nosotros, escribinos y la vinculamos
            con esta cuenta web para que veas tu saldo y tu historial acá.
          </p>
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand-green hover:underline"
          >
            <MessageCircle className="h-4 w-4" />
            Escribirnos por WhatsApp
          </a>
        </section>
      )}
    </div>
  );
}

function Paso({
  numero,
  titulo,
  texto,
}: {
  numero: number;
  titulo: string;
  texto: string;
}) {
  return (
    <div>
      <span className="tabular flex h-8 w-8 items-center justify-center rounded-full bg-brand-orange/12 text-sm font-semibold text-brand-orange-dark">
        {numero}
      </span>
      <p className="mt-2.5 font-medium">{titulo}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}
