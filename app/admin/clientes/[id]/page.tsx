import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle, Printer } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import {
  fechaCorta,
  formatearCuit,
  moneda,
} from "@/components/admin/formato";
import { obtenerCliente } from "@/lib/dal/admin/clientes";
import { AvisoCuentaWeb } from "./aviso-cuenta-web";
import { DialogoMovimiento } from "./dialogo-movimiento";

const CONDICIONES: Record<string, string> = {
  consumidor_final: "Consumidor final",
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
  no_categorizado: "No categorizado",
};

export default async function FichaClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cliente = await obtenerCliente(id);

  if (!cliente) notFound();

  const limite = Number(cliente.limiteCredito);
  const excedido = limite > 0 && cliente.saldo > limite;
  const usoLimite = limite > 0 ? Math.min((cliente.saldo / limite) * 100, 100) : 0;

  const whatsapp = cliente.telefono
    ? `https://wa.me/54${cliente.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola ${cliente.nombre}, te escribimos de Maderera Juan B. Justo.`,
      )}`
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
          <DialogoMovimiento customerId={cliente.id} nombre={cliente.nombre} />
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
              <Dato etiqueta="Asesor" valor={cliente.asesor ?? "—"} />
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
          <section className="tarjeta overflow-hidden">
            <h2 className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4 text-base font-medium">
              <span className="flex items-baseline gap-3">
                Movimientos de cuenta
                {cliente.totalMovimientos > cliente.movimientos.length && (
                  <span className="text-base font-normal text-muted-foreground">
                    últimos {cliente.movimientos.length} de{" "}
                    <span className="tabular">{cliente.totalMovimientos}</span>
                  </span>
                )}
              </span>

              {/* Esta lista muestra los últimos veinte. El resumen los trae
                  todos, con el saldo acumulado y la antigüedad de la deuda: es
                  lo que se le manda al cliente cuando pregunta cuánto debe. */}
              <Link
                href={`/cuenta/${cliente.id}`}
                target="_blank"
                className="inline-flex items-center gap-1.5 text-base font-normal text-muted-foreground transition-colors hover:text-foreground"
              >
                <Printer className="h-4 w-4" />
                Resumen de cuenta
              </Link>
            </h2>
            {cliente.movimientos.length === 0 ? (
              <p className="border-t px-5 py-8 text-center text-base text-muted-foreground">
                Todavía no hay movimientos.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {cliente.movimientos.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-4 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <EtiquetaEstado estado={m.tipo} />
                        <span className="text-base">{m.detalle ?? ""}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {fechaCorta.format(m.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`tabular shrink-0 text-base font-medium ${
                        Number(m.monto) > 0 ? "" : "text-green-700"
                      }`}
                    >
                      {Number(m.monto) > 0 ? "+" : ""}
                      {moneda.format(Number(m.monto))}
                    </span>
                  </li>
                ))}
              </ul>
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
}: {
  etiqueta: string;
  valor: string;
  tabular?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{etiqueta}</dt>
      <dd className={`text-right ${tabular ? "tabular" : ""}`}>{valor}</dd>
    </div>
  );
}

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
            <li key={fila.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="tabular text-base">{fila.numero}</p>
                <p className="text-sm text-muted-foreground">
                  {fechaCorta.format(fila.fecha)}
                </p>
              </div>
              <span className="tabular text-base">
                {moneda.format(Number(fila.total))}
              </span>
              <EtiquetaEstado estado={fila.estado} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
