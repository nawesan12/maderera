import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { MandarPorWhatsapp } from "@/app/admin/whatsapp/mandar-por-whatsapp";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import { avisoDelUltimoRecibo, avisoManual } from "@/lib/whatsapp/aviso-manual-datos";
import { ArrowLeft, Download, MessageCircle, Printer } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { enlaceDeWhatsapp } from "@/lib/formato";
import {
  fechaCorta,
  formatearCuit,
  moneda,
} from "@/components/admin/formato";
import { obtenerCliente } from "@/lib/dal/admin/clientes";
import { AvisoCuentaWeb } from "./aviso-cuenta-web";
import { CreditoDelCliente } from "./credito";
import { DialogoMovimiento } from "./dialogo-movimiento";
import { DialogoCobro } from "@/components/cobros/dialogo-cobro";
import { LineaDeTiempo } from "@/components/cuenta/linea-de-tiempo";
import { FiltrosDeMovimientos, esFiltro } from "@/components/cuenta/filtros-de-movimientos";
import { desdeDelPeriodo, historialDelCliente } from "@/lib/dal/historial-cliente";
import { requireStaff } from "@/lib/dal/session";

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

  const [cliente, historial, usuario] = await Promise.all([
    obtenerCliente(id),
    historialDelCliente(id, { desde: desdeDelPeriodo(periodo), filtro }),
    requireStaff(),
  ]);

  if (!cliente) notFound();
  const esAdmin = usuario.staffRole === "admin";

  const [recordatorio, resumenCuenta, recibo] = await Promise.all([
    cliente.saldo > 0
      ? avisoManual("recordatorio_saldo", { tipo: "customer", id }, { saldo: moneda.format(cliente.saldo) })
      : null,
    avisoManual("documento", { tipo: "customer", id }),
    avisoDelUltimoRecibo(id),
  ]);

  const limite = Number(cliente.limiteCredito);
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
            <EtiquetaEstado estado={cliente.estado} />
          </div>
          <p className="mt-0.5 text-base text-muted-foreground">
            {[cliente.razonSocial, cliente.rubro].filter(Boolean).join(" · ") ||
              "Cliente particular"}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          />
        </div>
      </div>

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
                excedido ? "text-red-700" : ""
              }`}
            >
              {moneda.format(cliente.saldo)}
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
                  <span className="tabular">{moneda.format(limite)}</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Usa el ${Math.round(usoLimite)}% del límite`}
                >
                  <div
                    className={`h-full rounded-full ${
                      excedido ? "bg-red-600" : "bg-brand-orange"
                    }`}
                    style={{ width: `${Math.max(usoLimite, 2)}%` }}
                  />
                </div>
                {excedido && (
                  <p className="mt-1.5 text-sm text-red-700">
                    Supera el límite en{" "}
                    <span className="tabular">
                      {moneda.format(cliente.saldo - limite)}
                    </span>
                  </p>
                )}
              </div>
            )}
          </section>

          {/* El plazo de pago y el corte de cuenta. Van acá, debajo del
              saldo: es donde se mira cuando alguien pregunta por qué el
              mostrador no le vende a cuenta. */}
          <CreditoDelCliente
            customerId={cliente.id}
            diasCredito={cliente.diasCredito}
            bloqueada={cliente.cuentaBloqueada}
            motivo={cliente.motivoBloqueo}
          />

          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Datos
            </h2>
            <dl className="space-y-2.5 text-base">
              <Dato etiqueta="CUIT" valor={formatearCuit(cliente.cuit)} tabular />
              <Dato
                etiqueta="Condición IVA"
                valor={CONDICIONES[cliente.condicionIva] ?? cliente.condicionIva}
              />
              <Dato etiqueta="Correo" valor={cliente.email ?? "—"} />
              <Dato etiqueta="Teléfono" valor={cliente.telefono ?? "—"} tabular />
              <Dato etiqueta="Domicilio" valor={cliente.direccion ?? "—"} />
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
          {(recordatorio || resumenCuenta || recibo) && (
            <section className="tarjeta space-y-4 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Avisarle por WhatsApp
              </h2>
              {recibo && (
                <div>
                  <p className="mb-1.5 text-base font-medium">El recibo {recibo.referencia} que se acaba de hacer</p>
                  <AvisarPorWhatsapp aviso={recibo} atajo={!recordatorio} />
                </div>
              )}
              {recordatorio && <AvisarPorWhatsapp aviso={recordatorio} atajo />}
              {resumenCuenta && (
                <div>
                  <p className="mb-1.5 text-base font-medium">El resumen de la cuenta</p>
                  <AvisarPorWhatsapp aviso={resumenCuenta} compacto />
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
                <MandarPorWhatsapp tipo="cuenta" id={cliente.id} compacto />
              </span>
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
            />
            {historial.hayMas && (
              <p className="border-t border-linea px-5 py-3 text-sm text-muted-foreground">
                Se muestran los últimos 200. Achicá el período o filtrá para ver el resto.
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
          </div>
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
}: {
  etiqueta: string;
  valor: string;
  tabular?: boolean;
  /** Cuando el dato es otra ficha del sistema y no un texto suelto. */
  href?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{etiqueta}</dt>
      <dd className={`text-right ${tabular ? "tabular" : ""}`}>
        {href ? (
          <Link href={href} className="hover:text-brand-orange hover:underline">
            {valor}
          </Link>
        ) : (
          valor
        )}
      </dd>
    </div>
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
    total: string;
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
              <Link
                href={fila.href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="tabular block text-base">{fila.numero}</span>
                  <span className="block text-sm text-muted-foreground">
                    {fechaCorta.format(fila.fecha)}
                  </span>
                </span>
                <span className="tabular text-base">
                  {moneda.format(Number(fila.total))}
                </span>
                <EtiquetaEstado estado={fila.estado} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
