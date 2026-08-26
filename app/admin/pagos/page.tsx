import type { Metadata } from "next";
import Link from "next/link";
import {
  Banknote,
  CircleAlert,
  FlaskConical,
  Landmark,
  Wallet,
} from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import {
  AcentoEstado,
  EtiquetaEstado,
} from "@/components/admin/etiqueta-estado";
import { fechaHora, moneda, plural } from "@/lib/formato";
import {
  listarPagos,
  obtenerDatosBancarios,
  resumenPagos,
  ultimosAvisos,
  type PagoListado,
} from "@/lib/dal/admin/pagos";
import { AccionesCobro } from "./acciones";
import { FormularioBanco } from "./banco";

export const metadata: Metadata = { title: "Cobros" };

const PROVEEDORES: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  transferencia: "Transferencia",
  demo: "Simulado",
};

const TIPOS: Record<string, string> = {
  pedido: "Pedido",
  deuda: "Cuenta corriente",
  inscripcion: "Inscripción",
};

/**
 * Los cobros, ordenados por lo que necesita una decisión.
 *
 * Arriba las transferencias a verificar: son las únicas que esperan que alguien
 * mire el extracto y decida. Después los rechazos del mes, que son clientes que
 * quisieron pagar y no pudieron —y a los que conviene llamar—. El resto es
 * historial.
 */
export default async function PagosPage() {
  const [pagos, resumen, avisos, banco] = await Promise.all([
    listarPagos(),
    resumenPagos(),
    ultimosAvisos(8),
    obtenerDatosBancarios(),
  ]);

  const aVerificar = pagos.filter((p) => p.estado === "en_revision");
  const rechazados = pagos.filter((p) => p.estado === "rechazado");
  const resto = pagos.filter(
    (p) => p.estado !== "en_revision" && p.estado !== "rechazado",
  );

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Cobros"
        detalle="La plata que entró, la que está por entrar y la que no pudo."
      >
        <Link
          href="/admin/facturacion"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Landmark className="h-5 w-5" />
          Facturación
        </Link>
      </EncabezadoPanel>

      {!resumen.enVivo && (
        <section className="tarjeta-atencion flex flex-wrap items-start gap-x-4 gap-y-2 p-5">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <div className="min-w-[18rem] flex-1">
            <h2 className="text-base font-medium">
              Los cobros online están en modo de prueba
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              Falta cargar <code className="tabular">MP_ACCESS_TOKEN</code> con
              las credenciales de Mercado Pago del negocio. Hasta entonces, todo
              el circuito funciona pero no se mueve plata: los pagos se aprueban
              desde una pantalla de simulación.
            </p>
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          titulo="Acreditado este mes"
          valor={moneda.format(resumen.acreditadoMes)}
          detalle={plural(resumen.cantidadMes, "cobro")}
        />
        <Indicador
          titulo="A verificar"
          valor={moneda.format(resumen.montoEnRevision)}
          detalle={
            resumen.enRevision > 0
              ? plural(resumen.enRevision, "cobro")
              : "Nada pendiente"
          }
          atencion={resumen.enRevision > 0}
        />
        <Indicador
          titulo="Rechazados del mes"
          valor={String(resumen.rechazadosMes)}
          detalle={
            resumen.rechazadosMes > 0
              ? "Vale la pena llamarlos"
              : "Ninguno"
          }
          atencion={resumen.rechazadosMes > 0}
        />
      </div>

      {pagos.length === 0 ? (
        <section className="tarjeta px-6 py-16 text-center">
          <Wallet className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <h2 className="mt-4 text-lg font-medium">Todavía no hay cobros</h2>
          <p className="mx-auto mt-1 max-w-md text-base text-muted-foreground">
            Aparecen acá apenas alguien pague un pedido desde la tienda o
            cancele deuda de su cuenta corriente.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {aVerificar.length > 0 && (
            <Grupo
              titulo="Cobros a verificar"
              detalle="Transferencias informadas y avisos que no cuadran"
              pagos={aVerificar}
              atencion
            />
          )}
          {rechazados.length > 0 && (
            <Grupo
              titulo="Rechazados"
              detalle="Quisieron pagar y no pudieron"
              pagos={rechazados}
            />
          )}
          {resto.length > 0 && (
            <Grupo titulo="Movimientos" pagos={resto} />
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <FormularioBanco datos={banco} />

        <section className="tarjeta p-5">
          <h2 className="text-base font-medium">Últimos avisos recibidos</h2>
          <p className="mt-0.5 text-base text-muted-foreground">
            Si un cliente dice que pagó y el pedido sigue pendiente, la respuesta
            está acá: o el aviso no llegó, o llegó y falló.
          </p>

          {avisos.length === 0 ? (
            <p className="mt-4 text-base text-muted-foreground">
              Todavía no llegó ningún aviso.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {avisos.map((aviso) => (
                <li
                  key={aviso.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-base"
                >
                  <span className="tabular text-muted-foreground">
                    {fechaHora.format(aviso.createdAt)}
                  </span>
                  <span className="flex-1">
                    {PROVEEDORES[aviso.proveedor] ?? aviso.proveedor} ·{" "}
                    {aviso.tipo ?? "aviso"}
                  </span>
                  {aviso.error ? (
                    <span className="flex items-center gap-1.5 text-brand-orange-dark">
                      <CircleAlert className="h-4 w-4 shrink-0" />
                      {aviso.error}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {aviso.procesadoAt ? "Procesado" : "Sin procesar"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Grupo({
  titulo,
  detalle,
  pagos,
  atencion = false,
}: {
  titulo: string;
  detalle?: string;
  pagos: PagoListado[];
  atencion?: boolean;
}) {
  return (
    <section className={atencion ? "tarjeta-atencion" : "tarjeta"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-base font-medium">{titulo}</h2>
        {detalle && (
          <p className="text-base text-muted-foreground">{detalle}</p>
        )}
      </div>

      <ul className="divide-y">
        {pagos.map((pago) => (
          <li
            key={pago.id}
            className="relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden px-5 py-4"
          >
            <AcentoEstado estado={pago.estado} />

            <div className="min-w-[14rem] flex-1 pl-2">
              <p className="text-base font-medium">
                {pago.numeroPedido ? (
                  <Link
                    href={`/admin/pedidos/${pago.orderId}`}
                    className="hover:text-brand-orange-dark hover:underline"
                  >
                    Pedido {pago.numeroPedido}
                  </Link>
                ) : (
                  (TIPOS[pago.tipo] ?? pago.tipo)
                )}
              </p>
              <p className="text-base text-muted-foreground">
                {pago.cliente ?? "Sin ficha de cliente"} ·{" "}
                {PROVEEDORES[pago.proveedor] ?? pago.proveedor}
                {pago.medio ? ` · ${pago.medio}` : ""}
              </p>
              {pago.motivoRechazo && (
                <p className="mt-0.5 text-base text-brand-orange-dark">
                  {pago.motivoRechazo}
                </p>
              )}
            </div>

            <span className="tabular text-lg font-semibold">
              {moneda.format(pago.monto)}
            </span>

            <EtiquetaEstado estado={pago.estado} />

            <span className="tabular w-36 text-right text-base text-muted-foreground">
              {fechaHora.format(pago.acreditadoAt ?? pago.createdAt)}
            </span>

            <AccionesCobro
              pagoId={pago.id}
              estado={pago.estado}
              proveedor={pago.proveedor}
              comprobanteUrl={pago.comprobanteUrl}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Indicador({
  titulo,
  valor,
  detalle,
  atencion = false,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  atencion?: boolean;
}) {
  return (
    <div className={atencion ? "tarjeta-atencion p-5" : "tarjeta p-5"}>
      <p className="text-base text-muted-foreground">{titulo}</p>
      <p className="tabular mt-1 text-3xl font-semibold tracking-tight">
        {valor}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-base text-muted-foreground">
        {atencion && <Banknote className="h-4 w-4 text-brand-orange" />}
        {detalle}
      </p>
    </div>
  );
}
