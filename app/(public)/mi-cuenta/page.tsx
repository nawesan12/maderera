import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  MessageCircle,
  PackageOpen,
  Receipt,
  ScrollText,
} from "lucide-react";
import { TarjetaPedido } from "@/components/cuenta/tarjeta-pedido";
import {
  clienteDeLaSesion,
  misPedidos,
  misPresupuestos,
  resumenCuenta,
} from "@/lib/dal/cuenta";
import { diasHasta, fechaCorta, formatearMonto, plural } from "@/lib/formato";
import { RespuestaPresupuesto } from "./presupuestos/respuesta";

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
  const aResponder = presupuestos.filter((p) => p.estado === "enviado");
  const operaACuenta = resumen.limiteCredito > 0 || resumen.saldo !== 0;

  // Cuenta recién creada y sin actividad: en vez de tres tarjetas vacías, se
  // muestra por dónde empezar.
  if (pedidos.length === 0 && presupuestos.length === 0 && !operaACuenta) {
    return <Bienvenida nombre={cliente?.nombre ?? ""} />;
  }

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
                  className="rounded-xl border-2 border-brand-orange/35 bg-white p-5"
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
                    <RespuestaPresupuesto numero={presupuesto.numero} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Cuenta corriente, con el crédito disponible medido */}
      {operaACuenta && (
        <section className="overflow-hidden rounded-xl border bg-white">
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
              </p>
            </div>

            <Link
              href="/mi-cuenta/cuenta-corriente"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange hover:underline"
            >
              Ver movimientos
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {resumen.limiteCredito > 0 && (
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
            enCurso.length > 0 ? plural(enCurso.length, "en camino") : undefined
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
            <p className="rounded-xl border border-dashed bg-white/60 px-5 py-6 text-center text-muted-foreground">
              No tenés pedidos en curso. El último fue{" "}
              <Link
                href={`/mi-cuenta/pedidos/${pedidos[0].numero}`}
                className="tabular font-medium text-brand-orange hover:underline"
              >
                {pedidos[0].numero}
              </Link>
              .
            </p>
          ) : (
            <p className="rounded-xl border border-dashed bg-white/60 px-5 py-6 text-center text-muted-foreground">
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
          className="shrink-0 text-sm font-medium text-brand-orange hover:underline"
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
        aria-label={`Usás el ${Math.round(porcentaje)} por ciento de tu límite de crédito`}
      >
        <div
          className={`h-full rounded-full ${
            excedido
              ? "bg-red-600"
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
      texto: "Todo el catálogo con precio y disponibilidad",
    },
    {
      href: "/calculadora",
      icono: Calculator,
      titulo: "Calcular materiales",
      texto: "Techos, decks, pisos y placas",
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
          className="group rounded-xl border bg-white p-4 transition-colors hover:border-brand-orange/40 hover:bg-brand-orange/[0.03]"
        >
          <a.icono className="h-5 w-5 text-brand-orange" />
          <p className="mt-2.5 font-medium">{a.titulo}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{a.texto}</p>
        </Link>
      ))}
    </section>
  );
}

/** Primera visita: qué hacer, no un vacío con un ícono gris. */
function Bienvenida({ nombre }: { nombre: string }) {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="bg-brand-gray p-8 text-white">
          <h2 className="text-2xl font-bold">
            {nombre ? `Bienvenido, ${nombre.split(" ")[0]}` : "Bienvenido"}
          </h2>
          <p className="mt-2 max-w-lg text-white/70">
            Acá vas a ver tus pedidos, tus presupuestos y —si comprás a cuenta
            corriente— tu saldo con cada movimiento. Por ahora está vacío
            porque todavía no hiciste tu primera compra.
          </p>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-3">
          <Paso
            numero={1}
            titulo="Armá tu presupuesto"
            texto="Sumá productos del catálogo o usá la calculadora de materiales."
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

        <div className="flex flex-wrap gap-3 border-t bg-sitio-alt px-6 py-5">
          <Link
            href="/catalogo"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-orange px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark"
          >
            Ver el catálogo
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/calculadora"
            className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-5 font-medium transition-colors hover:bg-muted"
          >
            <Calculator className="h-4 w-4" />
            Calcular materiales
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-dashed p-5">
        <h3 className="flex items-center gap-2 font-medium">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          ¿Ya comprás en el mostrador?
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Si tenés cuenta corriente con nosotros, escribinos y la vinculamos con
          esta cuenta web para que veas tu saldo y tu historial acá.
        </p>
        <a
          href="https://wa.me/542235903118"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand-green hover:underline"
        >
          <MessageCircle className="h-4 w-4" />
          Escribirnos por WhatsApp
        </a>
      </section>
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
