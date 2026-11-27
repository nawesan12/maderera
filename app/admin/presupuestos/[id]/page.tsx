import Link from "next/link";
import { UnirAFicha } from "@/components/admin/unir-a-ficha";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { MandarPorWhatsapp } from "@/app/admin/whatsapp/mandar-por-whatsapp";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import { avisoManual } from "@/lib/whatsapp/aviso-manual-datos";
import { AlertTriangle, FileDown } from "lucide-react";
import { EncabezadoFicha } from "@/components/admin/encabezado-ficha";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaCorta, formatearMonto } from "@/components/admin/formato";
import { cantidadConUnidad } from "@/lib/formato";
import { obtenerPresupuesto } from "@/lib/dal/admin/ventas";
import { obtenerCliente } from "@/lib/dal/admin/clientes";
import { AccionesPresupuesto, EnviarAlCliente } from "../acciones";
import { zonasParaPedido } from "../zonas";
import { escalasDePago } from "@/lib/dal/descuentos-pago";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { valorDeRegla } from "@/lib/reglas";

/**
 * La ficha de un presupuesto.
 *
 * Mes simulado: en el teléfono eran cinco botones apilados de a uno antes de
 * ver qué llevaba y cuánto salía, y había tres maneras de mandarlo sin que se
 * entendiera cuál. Ahora va arriba lo que se decide —el total, el cliente y
 * la acción principal (pasarlo a pedido)— y los canales para mandárselo
 * juntos en una fila: WhatsApp desde el teléfono, WhatsApp desde el sistema,
 * correo y el PDF.
 */
export default async function FichaPresupuestoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pasar?: string }>;
}) {
  const { id } = await params;
  const { pasar } = await searchParams;
  if (!esUuid(id)) notFound();
  const [usuario, p, aviso, zonas, escalas, ajustes] = await Promise.all([
    requireStaff(),
    obtenerPresupuesto(id),
    avisoManual("presupuesto_listo", { tipo: "quote", id }),
    zonasParaPedido(),
    escalasDePago(),
    ajustesDelSitio(),
  ]);

  if (!p) notFound();
  const verCliente = puedeEntrar("/admin/clientes", usuario.staffRole);
  // El disponible de la cuenta corriente, para decirlo antes de crear el
  // pedido a cuenta (Go lo vuelve a mirar).
  const ficha = p.customerId && !p.pedidoId && verCliente ? await obtenerCliente(p.customerId) : null;
  const limite = ficha ? Number(ficha.limiteCredito) : 0;
  const credito = ficha ? { disponible: limite > 0 ? limite - ficha.saldo : 0, bloqueada: ficha.cuentaBloqueada } : null;

  const abierto = !["rechazado"].includes(p.estado);
  // Un presupuesto rechazado o ya hecho pedido no se va a vender a ese
  // precio: el aviso del costo no tiene a quién servirle (mes simulado).
  const bajoCosto = abierto && !p.pedidoId ? p.items.filter((i) => i.bajoCosto).length : 0;
  // Sobre qué va el descuento por forma de pago (lo mismo que Go): lo del
  // catálogo, y con la regla, también lo cargado a mano.
  const alFlete = valorDeRegla(ajustes, "descuento_al_flete") === "si";
  const baseEscala = p.items.filter((i) => alFlete || i.variantId).reduce((t, i) => t + Number(i.subtotal), 0);
  const empresa = p.empresa && p.empresa !== p.cliente ? p.empresa : null;

  return (
    <div className="space-y-5">
      <EncabezadoFicha
        volverA="/admin/presupuestos"
        volverTexto="Volver a presupuestos"
        titulo={p.numero}
        estado={
          <>
            <EtiquetaEstado estado={p.estado} />
            {p.vencido && p.estado !== "vencido" && <EtiquetaEstado estado="vencido" />}
            {/* El motivo como etiqueta, junto al estado (M3S2-051). */}
            {p.motivoRechazo && (
              <span className="estado-cerrado rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-semibold text-[var(--estado-tinta)]">
                {p.motivoRechazo}
              </span>
            )}
          </>
        }
        detalle={
          <>
            {fechaCorta.format(p.createdAt)}
            {p.validoHasta && ` · vale hasta ${fechaCorta.format(p.validoHasta)}`}
            {p.sucursal && ` · ${p.sucursal}`}
            {/* Los pedidos que salieron de él y se cancelaron (M3S3-031). */}
            {p.pedidosCancelados?.map((c, i) => (
              <span key={c.id}>
                {i === 0 ? " · " : ", "}
                <Link href={`/admin/pedidos/${c.id}`} className="codigo hover:underline">
                  {c.numero}
                </Link>
              </span>
            ))}
            {(p.pedidosCancelados?.length ?? 0) > 0 && ((p.pedidosCancelados?.length ?? 0) === 1 ? " cancelado" : " cancelados")}
          </>
        }
      />

      {/* Lo que se decide: a quién, cuánto, y qué se hace ahora. */}
      <section className="tarjeta space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            {p.customerId && verCliente ? (
              <Link
                href={`/admin/clientes/${p.customerId}`}
                className="text-lg font-medium hover:text-brand-orange"
              >
                {p.cliente}
              </Link>
            ) : (
              <p className="text-lg font-medium">{p.cliente}</p>
            )}
            {empresa && <p className="text-base text-muted-foreground">{empresa}</p>}
          </div>
          <p className="tabular text-3xl font-semibold">{formatearMonto(Number(p.total))}</p>
        </div>

        {bajoCosto > 0 && (
          <p className="estado-problema flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base font-medium text-[var(--estado-tinta)]">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            {bajoCosto === 1 ? "Un renglón va" : `${bajoCosto} renglones van`} por debajo del costo
          </p>
        )}

        <AccionesPresupuesto
          id={p.id}
          numero={p.numero}
          estado={p.estado}
          total={Number(p.total)}
          pedido={p.pedidoId && p.numeroPedido ? { id: p.pedidoId, numero: p.numeroPedido } : null}
          zonas={zonas}
          conCliente={!!p.customerId}
          direccion={p.clienteDireccion}
          vencido={p.vencido ? { totalDeHoy: Number(p.totalDeHoy ?? p.total) } : null}
          abrirPasar={pasar === "1"}
          credito={credito}
          bajoCosto={bajoCosto}
          escalas={escalas}
          baseEscala={baseEscala}
          sucursal={p.sucursalSlug}
          renglones={p.items
            .filter((i) => (i.disponible?.length ?? 0) > 0)
            .map((i) => ({ descripcion: i.descripcion, cantidad: Number(i.cantidad), disponible: i.disponible ?? [] }))}
        />
      </section>

      {/* Mandárselo: los canales juntos, cada uno dice cuál es. */}
      {abierto && (
        <section className="tarjeta space-y-3 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Mandárselo
          </h2>
          <div className="flex flex-wrap items-start gap-2">
            {/* Un solo PDF: el del aviso («PDF para adjuntar») y este iban al
                mismo lugar (M2S1-188). */}
            {aviso && <AvisarPorWhatsapp aviso={{ ...aviso, pdf: null }} atajo compacto />}
            <MandarPorWhatsapp tipo="presupuesto" id={p.id} />
            {/* Mandado por WhatsApp sigue a mano: el cliente lo pide también
                por mail (M2S1-098). */}
            {["pendiente", "revision", "enviado"].includes(p.estado) && (
              <EnviarAlCliente id={p.id} yaEnviado={p.estado === "enviado"} />
            )}
            <a
              href={`/api/presupuestos/${p.id}/pdf`}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-hundida px-3.5 text-base font-medium transition-colors hover:bg-muted"
            >
              <FileDown className="h-5 w-5" aria-hidden="true" />
              PDF
            </a>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Los renglones como lista y no como tabla: en el teléfono la tabla
            apilada rotulaba «Subtotal» al total y al envío. */}
        <section className="tarjeta overflow-hidden">
          <h2 className="px-5 py-4 text-base font-medium">Qué lleva</h2>
          <ul className="divide-y divide-linea border-t border-linea">
            {p.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-base">{item.descripcion}</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="tabular">
                      {cantidadConUnidad(Number(item.cantidad), item.unidad, item.descripcion)} ×{" "}
                      {formatearMonto(Number(item.precioUnitario))}
                    </span>
                    {item.bajoCosto && (
                      <span className="estado-problema ml-2 font-medium text-[var(--estado-tinta)]">bajo costo</span>
                    )}
                  </p>
                </div>
                <p className="tabular shrink-0 text-base font-medium">{formatearMonto(Number(item.subtotal))}</p>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-linea bg-hundida px-5 py-4">
            <span className="text-base font-medium">Total</span>
            <span className="tabular text-xl font-semibold">{formatearMonto(Number(p.total))}</span>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Contacto
            </h2>
            {/* Como en el pedido: solo quien entra a Clientes (Go lo exige
                igual y el botón daba 403). */}
            {p.fichaPorCorreo && verCliente && (
              <UnirAFicha
                que="presupuesto"
                id={p.id}
                numero={p.numero}
                total={Number(p.total)}
                contacto={{ nombre: p.cliente, telefono: p.telefono }}
                ficha={p.fichaPorCorreo}
                delPanel={p.origen === "mostrador" || p.origen === "telefono"}
              />
            )}
            <dl className="space-y-1.5 text-base">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Teléfono</dt>
                <dd className="tabular">{p.telefono ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Correo</dt>
                {/* Entero, partido donde haga falta: cortado en la columna
                    angosta no había forma de leerlo (mes simulado). Sin el
                    suyo, el de la ficha, que es al que sale (M2S1-183). */}
                <dd className="min-w-0 break-all text-right">{p.email ?? p.emailFicha ?? "—"}</dd>
              </div>
              {p.asesor && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Asesor</dt>
                  <dd>{p.asesor}</dd>
                </div>
              )}
            </dl>
          </section>

          {p.notas && (
            <section className="tarjeta p-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Notas
              </h2>
              <p className="text-base text-muted-foreground">{p.notas}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
