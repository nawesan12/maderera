import { leerDocumento } from "@/lib/clientes/documento";
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { MandarPorWhatsapp } from "@/app/admin/whatsapp/mandar-por-whatsapp";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import { avisoDelUltimoRecibo, avisoManual } from "@/lib/whatsapp/aviso-manual-datos";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { valorDeRegla } from "@/lib/reglas";
import { ArrowLeft, CalendarClock, ClipboardList, Download, MessageCircle, MessageSquareText, Printer, Scissors } from "lucide-react";
import { MANEJAN_PLATA, puedeEntrar } from "@/lib/roles";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { enlaceDeWhatsapp, fechaSolaCorta, telefonoLegible } from "@/lib/formato";
import {
  fechaCorta,
  formatearCuit,
  formatearMonto,
} from "@/components/admin/formato";
import { etiquetaDeRubro } from "@/lib/rubros-cliente";
import { gestionesDelCliente } from "@/lib/dal/admin/seguimiento";
import { obtenerCliente, type FichaDeCliente } from "@/lib/dal/admin/clientes";
import { AvisoCuentaWeb } from "./aviso-cuenta-web";
import { CreditoDelCliente } from "./credito";
import { DialogoMovimiento } from "./dialogo-movimiento";
import { DialogoCobro } from "@/components/cobros/dialogo-cobro";
import { AnularRecibo } from "@/components/cobros/anular-recibo";
import { InvitarAlPortal } from "./invitar-portal";
import { RechazarCheque } from "@/components/cobros/rechazar-cheque";
import { LineaDeTiempo } from "@/components/cuenta/linea-de-tiempo";
import { FiltrosDeMovimientos, esFiltro } from "@/components/cuenta/filtros-de-movimientos";
import { historialDelCliente } from "@/lib/dal/historial-cliente";
import { requireStaff } from "@/lib/dal/session";
import { DialogoCliente } from "../dialogo-cliente";
import { listarListasParaClientes } from "@/lib/dal/admin/clientes";
import { vendedoresActivos } from "@/lib/dal/admin/vendedores";

const ETAPA_DE_GESTION: Record<string, string> = {
  pendiente: "Para hacer",
  hablando: "Hablando",
  promesa: "Prometió",
};

const CONDICIONES: Record<string, string> = {
  consumidor_final: "Consumidor final",
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
  no_categorizado: "No categorizado",
};

export default async function FichaClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ periodo?: string; ver?: string }>;
}) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const { periodo = "12m", ver } = await searchParams;
  const filtro = esFiltro(ver) ? ver : "todo";

  const [cliente, historial, usuario, listas, vendedores, gestiones] = await Promise.all([
    obtenerCliente(id),
    historialDelCliente(id, { periodo, filtro }),
    requireStaff(),
    listarListasParaClientes(),
    vendedoresActivos(),
    gestionesDelCliente(id),
  ]);

  if (!cliente) notFound();
  const esAdmin = usuario.staffRole === "admin";
  const manejaPlata = usuario.staffRole != null && MANEJAN_PLATA.includes(usuario.staffRole);

  const [recordatorio, resumenCuenta, recibo, ajustes] = await Promise.all([
    cliente.saldo > 0
      ? avisoManual("recordatorio_saldo", { tipo: "customer", id }, { saldo: formatearMonto(cliente.saldo) })
      : null,
    avisoManual("documento", { tipo: "customer", id }),
    avisoDelUltimoRecibo(id),
    ajustesDelSitio(),
  ]);

  const limite = Number(cliente.limiteCredito);
  // Una ficha nueva, sin deuda ni movimientos, no tiene resumen que mandar.
  const tieneMovimientos = historial.movimientos.length > 0 || cliente.saldo !== 0;
  // La lista de precios a la vista: había que abrir «Editar datos» para saber
  // cuál tenía (mes simulado). Sin lista propia es la general.
  const lista = listas.find((l) => l.id === cliente.priceListId) ?? listas.find((l) => l.isDefault);
  // El seguimiento abierto con este cliente (mes simulado: no aparecía en la
  // ficha, al lado de la deuda que se está gestionando).
  const abiertas = gestiones.filter((g) => g.etapa !== "cerrado");
  // La razón social repetida debajo del nombre no dice nada, y el rubro va
  // como se lee («Carpintería»), no como se guarda («carpintero»).
  const subtitulo = [
    cliente.razonSocial && cliente.razonSocial !== cliente.nombre ? cliente.razonSocial : null,
    cliente.rubro && cliente.rubro !== "particular" ? etiquetaDeRubro(cliente.rubro) : null,
    // Que es profesional se dice acá, junto al rubro (M3S1-072).
    cliente.tipo === "profesional" ? "Profesional" : null,
  ].filter(Boolean);
  const excedido = limite > 0 && cliente.saldo > limite;
  const usoLimite = limite > 0 ? Math.min((cliente.saldo / limite) * 100, 100) : 0;

  /*
   * El enlace sale de `enlaceDeWhatsapp` y ya no se arma acá: esta línea ponía
   * `54` sin el nueve de celular, así que abría una conversación con un número
   * que no existe.
   */
  const whatsapp = cliente.telefono
    ? enlaceDeWhatsapp(
        cliente.telefono,
        `Hola ${cliente.nombre}, te escribimos de Maderera Juan B. Justo.`,
      )
    : null;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/clientes"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a clientes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {cliente.nombre}
            </h1>
            {/* La ficha que quedó apagada al unir su cuenta web a otra
                dice «Inactivo»: decía «Activo» (mes 23). */}
            <EtiquetaEstado estado={cliente.active ? cliente.estado : "inactivo"} />
          </div>
          <p className="mt-0.5 text-base text-muted-foreground">
            {subtitulo.join(" · ") || "Particular"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DialogoCliente listas={listas} vendedores={vendedores} cliente={cliente} />
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
            >
              <MessageCircle className="h-5 w-5" />
              WhatsApp
            </a>
          )}
          {/* Cobrar es lo de todos los días y va primero; los otros
              movimientos —una nota de crédito, un ajuste— corrigen la
              cuenta y quedan para el admin. */}
          {esAdmin && <DialogoMovimiento customerId={cliente.id} nombre={cliente.nombre} />}
          <DialogoCobro
            customerId={cliente.id}
            nombre={cliente.nombre}
            aCobrar={Math.max(cliente.saldo, 0)}
            conRetencion={esAdmin || valorDeRegla(ajustes, "retencion_en_el_cobro") === "quien_cobra"}
          />
        </div>
      </div>

      {/* Lo que se hace con un cliente, ya con el cliente puesto: armarle un
          presupuesto o tomarle un corte sin volver a buscarlo. */}
      <nav aria-label="Hacer para este cliente" className="flex flex-wrap gap-2">
        {puedeEntrar("/admin/presupuestos", usuario.staffRole) && (
          <Link
            href={`/admin/presupuestos/nuevo?cliente=${cliente.id}`}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-hundida px-4 text-base font-medium hover:bg-muted"
          >
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
            Presupuesto
          </Link>
        )}
        {puedeEntrar("/admin/cortes", usuario.staffRole) && (
          <Link
            href={`/admin/cortes/nuevo?cliente=${cliente.id}`}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-hundida px-4 text-base font-medium hover:bg-muted"
          >
            <Scissors className="h-5 w-5" aria-hidden="true" />
            Corte
          </Link>
        )}
      </nav>

      {cliente.cuentaWebSinVincular && (
        <AvisoCuentaWeb
          customerId={cliente.id}
          cuentaWeb={cliente.cuentaWebSinVincular}
          nombreCliente={cliente.nombre}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Datos y cuenta */}
        <div className="space-y-4">
          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Cuenta corriente
            </h2>
            <p
              className={`tabular text-3xl font-semibold ${
                excedido ? "text-saldo-debe" : ""
              }`}
            >
              {formatearMonto(cliente.saldo)}
            </p>
            <p className="mt-1 text-base text-muted-foreground">
              {cliente.saldo > 0
                ? "Deuda pendiente"
                : cliente.saldo < 0
                  ? "Saldo a favor"
                  : "Sin deuda"}
            </p>

            {limite > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Límite</span>
                  <span className="tabular">{formatearMonto(limite)}</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Usa el ${Math.round(usoLimite)}% del límite`}
                >
                  <div
                    className={`h-full rounded-full ${
                      excedido ? "bg-destructive" : "bg-brand-orange"
                    }`}
                    style={{ width: `${Math.max(usoLimite, 2)}%` }}
                  />
                </div>
                {excedido && (
                  <p className="mt-1.5 text-sm text-saldo-debe">
                    Supera el límite en{" "}
                    <span className="tabular">
                      {formatearMonto(cliente.saldo - limite)}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* El plazo de pago y el corte de cuenta, en la misma tarjeta:
                es donde se mira cuando alguien pregunta por qué el
                mostrador no le vende a cuenta. */}
            <CreditoDelCliente
              customerId={cliente.id}
              diasCredito={cliente.diasCredito}
              bloqueada={cliente.cuentaBloqueada}
              motivo={cliente.motivoBloqueo}
              editable={esAdmin}
              sinCuenta={limite <= 0}
            />

            {/* La gestión de cobro arranca desde lo que debe: el cliente y el
                importe ya puestos. Las abiertas, a la vista. */}
            {(abiertas.length > 0 || cliente.saldo > 0) && (
              <div className="mt-4 space-y-2 border-t border-linea pt-4">
                {abiertas.map((g) => (
                  <Link
                    key={g.id}
                    href="/admin/clientes/seguimiento"
                    className="block rounded-lg bg-hundida px-3 py-2.5 transition-colors hover:bg-muted"
                  >
                    <span className="block text-base font-medium leading-snug">{g.asunto}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                      {ETAPA_DE_GESTION[g.etapa] ?? g.etapa}
                      {g.proximaAccionAt && (
                        <span className={`inline-flex items-center gap-1 ${g.vencida ? "font-medium text-destructive" : ""}`}>
                          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                          {fechaCorta.format(g.proximaAccionAt)}
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
                {cliente.saldo > 0 && (
                  <Link
                    href={`/admin/clientes/seguimiento?cliente=${cliente.id}`}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium ring-1 ring-inset ring-linea transition-colors hover:bg-hundida"
                  >
                    <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                    Seguimiento
                  </Link>
                )}
              </div>
            )}
          </section>

          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Datos
            </h2>
            <dl className="space-y-2.5 text-base">
              {/* Un CUIT que no pasa el verificador no factura: se ve acá antes
                  de que lo descubra el mostrador al cobrar. */}
              <Dato
                etiqueta="CUIT"
                valor={formatearCuit(cliente.cuit)}
                tabular
                problema={"error" in leerDocumento(cliente.cuit) ? "no es válido" : undefined}
              />
              <Dato
                etiqueta="Condición IVA"
                valor={CONDICIONES[cliente.condicionIva] ?? cliente.condicionIva}
              />
              <Dato etiqueta="Correo" valor={cliente.email ?? "—"} />
              <Dato etiqueta="Teléfono" valor={cliente.telefono ? telefonoLegible(cliente.telefono) : "—"} tabular />
              <Dato etiqueta="Domicilio" valor={cliente.direccion ?? "—"} />
              <Dato etiqueta="Lista de precios" valor={lista?.name ?? "General"} />
              {/* El vendedor asignado; `asesor` es el texto que dejó la
                  migración y se muestra solo si no hay uno de verdad. */}
              <Dato
                etiqueta="Vendedor"
                valor={cliente.vendedor ?? cliente.asesor ?? "—"}
                href={cliente.vendedor ? "/admin/clientes/vendedores" : undefined}
              />
              {/* Saber si entra al sitio cambia cómo se lo atiende: a quien
                  tiene cuenta se lo puede mandar a mirar el estado solo. */}
              <Dato
                etiqueta="Cuenta web"
                valor={cliente.userId ? "Sí, con acceso al portal" : "No tiene"}
              />
            </dl>
            {/* Con el correo cargado, se lo invita desde acá (M2S1-097). */}
            {!cliente.userId && cliente.email && (
              <div className="mt-2 flex justify-end">
                <InvitarAlPortal customerId={cliente.id} />
              </div>
            )}
            {cliente.notas && (
              <p className="mt-4 border-t pt-3 text-base text-muted-foreground">
                {cliente.notas}
              </p>
            )}
          </section>
        </div>

        {/* Actividad */}
        <div className="space-y-4">
          {/* Lo que se le manda por WhatsApp desde el teléfono, gratis: el
              recordatorio del saldo si debe, y el resumen de la cuenta. */}
          {/* El resumen se manda desde Movimientos: eran dos grupos para lo
              mismo, también en una ficha nueva sin nada (M2S4-068). */}
          {(recordatorio || recibo) && (
            <section className="tarjeta space-y-4 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Avisarle por WhatsApp
              </h2>
              {/* Cada aviso con su rótulo: eran dos «Avisar por WhatsApp»
                  seguidos y no se sabía cuál era el del recibo. */}
              {recibo && (
                <div>
                  <p className="mb-1.5 text-base font-medium">
                    Último recibo · <span className="codigo">{recibo.referencia}</span>
                  </p>
                  <AvisarPorWhatsapp aviso={recibo} atajo={!recordatorio} />
                </div>
              )}
              {recordatorio && (
                <div>
                  <p className="mb-1.5 text-base font-medium">
                    Lo que debe · <span className="tabular">{formatearMonto(cliente.saldo)}</span>
                  </p>
                  <AvisarPorWhatsapp aviso={recordatorio} atajo />
                </div>
              )}
            </section>
          )}

          <section className="tarjeta overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4">
              <h2 className="text-base font-medium">Movimientos</h2>

              {/* El resumen trae el libro entero con el saldo corrido y la
                  antigüedad de la deuda: es lo que se le manda al cliente
                  cuando pregunta cuánto debe. */}
              {tieneMovimientos && (
              <span className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/cuenta/${cliente.id}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 text-base text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Printer className="h-4 w-4" />
                  Imprimir resumen
                </Link>
                <a
                  href={`/api/cuenta/${cliente.id}/pdf`}
                  className="inline-flex items-center gap-1.5 text-base text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                  Resumen en PDF
                </a>
                {resumenCuenta && <AvisarPorWhatsapp aviso={resumenCuenta} compacto />}
                <MandarPorWhatsapp tipo="cuenta" id={cliente.id} compacto />
              </span>
              )}
            </div>

            {/* Lo mismo que ve el cliente en Mi cuenta → Movimientos, con los
                mismos filtros: los dos tienen que estar mirando lo mismo
                cuando hablan por teléfono. */}
            <FiltrosDeMovimientos
              base={`/admin/clientes/${cliente.id}`}
              periodo={periodo}
              filtro={filtro}
            />
            <LineaDeTiempo
              movimientos={historial.movimientos}
              enlacePedido={(p) => `/admin/pedidos/${p.id}`}
              accionDelRecibo={
                manejaPlata
                  ? // El cobro de Mercado Pago se devuelve desde MP y su aviso
                    // anula el recibo: a mano, el cliente pagaría dos veces.
                    // El renglón del cheque (filtro «Cheques») y la nota de
                    // débito de uno rechazado llevan el recibo de referencia:
                    // se anula desde su pago.
                    (r, m) =>
                      // Con un cheque rechazado tampoco: ya volvió a la cuenta
                      // con su nota de débito (M2S3-070).
                      r.porMercadoPago || r.chequeRechazado || r.chequeDevuelto || m.clase === "cheque" || m.clase === "nota_debito" ? null : (
                        <AnularRecibo
                          id={r.id}
                          numero={r.numero}
                          importe={Math.abs(m.importe ?? m.importeInformativo ?? 0)}
                          cliente={cliente.nombre}
                        />
                      )
                  : undefined
              }
              accionDelCheque={
                manejaPlata
                  ? (c, unoDeVarios) => (
                      <RechazarCheque
                        id={c.id}
                        nombre={c.nombre}
                        importe={c.importe}
                        cliente={cliente.nombre}
                        conNombre={unoDeVarios}
                        devolver={c.devolver}
                      />
                    )
                  : undefined
              }
            />
            {historial.hayMas && (
              <p className="border-t border-linea px-5 py-3 text-sm text-muted-foreground">
                Se muestran los últimos 200.
              </p>
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Listado
              titulo="Pedidos"
              vacio="Sin pedidos todavía."
              filas={cliente.pedidos.map((p) => ({
                id: p.id,
                numero: p.numero,
                estado: p.estado,
                total: p.total,
                fecha: p.createdAt,
                href: `/admin/pedidos/${p.id}`,
              }))}
            />
            <Listado
              titulo="Presupuestos"
              vacio="Sin presupuestos todavía."
              filas={cliente.presupuestos.map((p) => ({
                id: p.id,
                numero: p.numero,
                estado: p.estado,
                total: p.total,
                fecha: p.createdAt,
                href: `/admin/presupuestos/${p.id}`,
              }))}
            />
            <Listado
              titulo="Cortes"
              vacio="Sin cortes todavía."
              filas={cliente.cortes.map((c) => ({
                id: c.id,
                numero: c.numero,
                estado: c.estado,
                fecha: c.createdAt,
                href: `/admin/cortes/${c.id}`,
                detalle: `${Number(c.total)} ${Number(c.total) === 1 ? "placa" : "placas"}`,
              }))}
            />
            {puedeEntrar("/admin/facturacion", usuario.staffRole) && (
              <Listado
                titulo="Facturas"
                vacio="Sin facturas todavía."
                filas={cliente.facturas.map((f) => ({
                  id: f.id,
                  numero: f.numero,
                  estado: f.estado,
                  total: f.total,
                  fecha: f.createdAt,
                  href: `/admin/facturacion/${f.id}`,
                }))}
              />
            )}
          </div>

          <DelSistemaAnterior anterior={cliente.anterior} />
        </div>
      </div>
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  tabular = false,
  href,
  problema,
}: {
  etiqueta: string;
  valor: string;
  tabular?: boolean;
  /** El dato está mal: se marca en rojo con su porqué corto. */
  problema?: string;
  /** Cuando el dato es otra ficha del sistema y no un texto suelto. */
  href?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{etiqueta}</dt>
      <dd
        className={`text-right ${tabular ? "tabular" : ""} ${
          problema ? "estado-problema font-medium text-[var(--estado-tinta)]" : ""
        }`}
      >
        {href ? (
          <Link href={href} className="hover:text-brand-orange hover:underline">
            {valor}
          </Link>
        ) : (
          valor
        )}
        {problema && ` · ${problema}`}
      </dd>
    </div>
  );
}

/**
 * Lo que la migración trajo de ISIS para este cliente: sus ventas y sus
 * comprobantes de antes. Antes solo lo escribía la migración y no se veía en
 * ningún lado, justo cuando el cliente pregunta «¿qué me llevé la otra vez?».
 * Sin nada migrado, la sección no aparece. Las fechas son días guardados a
 * medianoche UTC: se leen en UTC, si no salen un día antes.
 */
function DelSistemaAnterior({ anterior }: { anterior: FichaDeCliente["anterior"] }) {
  if (anterior.cantidadVentas === 0 && anterior.cantidadComprobantes === 0) return null;
  const mas = (cantidad: number, mostradas: number) =>
    cantidad > mostradas ? ` · se muestran las últimas ${mostradas}` : "";
  return (
    <section className="tarjeta overflow-hidden">
      <header className="px-4 py-3.5">
        <h2 className="text-base font-medium">Del sistema anterior</h2>
      </header>
      <div className="grid gap-px border-t bg-linea sm:grid-cols-2">
        {anterior.cantidadVentas > 0 && (
          <div className="bg-card">
            <p className="px-4 pt-3 text-sm text-muted-foreground">
              {anterior.cantidadVentas} {anterior.cantidadVentas === 1 ? "venta" : "ventas"} por{" "}
              <span className="tabular">{formatearMonto(Number(anterior.totalVentas))}</span>
              {mas(anterior.cantidadVentas, anterior.ventas.length)}
            </p>
            <ul className="divide-y">
              {anterior.ventas.map((v) => (
                <li key={v.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="tabular block text-base">{v.comprobante}</span>
                    <span className="block text-sm text-muted-foreground">
                      {fechaSolaCorta.format(new Date(v.fecha))}
                      {v.sucursal && ` · ${v.sucursal}`}
                    </span>
                    {v.detalle && (
                      <span className="block truncate text-sm text-muted-foreground">{v.detalle}</span>
                    )}
                  </span>
                  <span className="tabular text-base">{formatearMonto(Number(v.total))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {anterior.cantidadComprobantes > 0 && (
          <div className="bg-card">
            <p className="px-4 pt-3 text-sm text-muted-foreground">
              {anterior.cantidadComprobantes}{" "}
              {anterior.cantidadComprobantes === 1 ? "comprobante" : "comprobantes"} por{" "}
              <span className="tabular">{formatearMonto(Number(anterior.totalComprobantes))}</span>
              {mas(anterior.cantidadComprobantes, anterior.comprobantes.length)}
            </p>
            <ul className="divide-y">
              {anterior.comprobantes.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-base">
                      {c.tipo}{" "}
                      <span className="tabular">
                        {String(c.puntoVenta).padStart(4, "0")}-{String(c.numero).padStart(8, "0")}
                      </span>
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {fechaSolaCorta.format(new Date(c.fecha))}
                    </span>
                    {c.cae && (
                      <span className="tabular block text-sm text-muted-foreground">CAE {c.cae}</span>
                    )}
                  </span>
                  <span className="tabular text-base">{formatearMonto(Number(c.total))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Los pedidos y presupuestos del cliente.
 *
 * **Cada fila es un enlace.** Era la pantalla que más se abre —el cliente está
 * del otro lado del teléfono preguntando por lo suyo— y era un callejón sin
 * salida: mostraba los números y no dejaba abrir ninguno, teniendo el id a
 * mano. Había que anotar el número en un papel, ir a Pedidos y buscarlo.
 */
function Listado({
  titulo,
  vacio,
  filas,
}: {
  titulo: string;
  vacio: string;
  filas: {
    id: string;
    numero: string;
    estado: string;
    total?: string;
    /** En vez del importe, cuando la fila no es plata (las placas del corte). */
    detalle?: string;
    fecha: Date;
    href: string;
  }[];
}) {
  return (
    <section className="tarjeta overflow-hidden">
      <h2 className="px-4 py-3.5 text-base font-medium">{titulo}</h2>
      {filas.length === 0 ? (
        <p className="border-t px-4 py-6 text-center text-base text-muted-foreground">
          {vacio}
        </p>
      ) : (
        <ul className="divide-y border-t">
          {filas.map((fila) => (
            <li key={fila.id}>
              {/* Dos renglones: el número entero arriba; fecha, importe y
                  estado abajo. En una sola fila, en las tarjetas angostas el número
                  se partía («PED-» y «1061») y el importe pisaba el de la
                  factura. */}
              <Link
                href={fila.href}
                className="block px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="codigo block truncate whitespace-nowrap text-base">{fila.numero}</span>
                <span className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-sm text-muted-foreground">{fechaCorta.format(fila.fecha)}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular whitespace-nowrap text-base font-medium">
                      {fila.total !== undefined ? formatearMonto(Number(fila.total)) : fila.detalle}
                    </span>
                    <EtiquetaEstado estado={fila.estado} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
