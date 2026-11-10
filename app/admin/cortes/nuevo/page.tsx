import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Truck } from "lucide-react";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { obtenerPedido } from "@/lib/dal/admin/ventas";
import { requireStaff } from "@/lib/dal/session";
import { anchoDeSierra } from "@/lib/dal/sierra";
import { FormularioCorte } from "./formulario";
import { consultaDeCorte } from "@/lib/dal/consultas-corte";
import { placasCortablesPublicas } from "@/lib/dal/cortes-publico";

export const metadata = { title: "Nuevo corte" };

/**
 * Alta de una orden de corte.
 *
 * El tablero sabía mover órdenes y exportarlas al optimizador, pero ninguna
 * parte del sistema podía crear una: las que había las puso el sembrado de
 * datos de prueba.
 *
 * Con `?pedido=`, el corte nace atado a ese pedido y con el cliente y la
 * sucursal ya puestos. Es el camino real: primero entra la venta, después se
 * manda a cortar. Cargarlo suelto y volver a tipear el nombre es lo que hacía
 * que en el pedido no quedara rastro de que había un corte esperando.
 */
export default async function NuevoCortePage({
  searchParams,
}: {
  searchParams: Promise<{ pedido?: string; consulta?: string }>;
}) {
  await requireStaff();

  const { pedido: pedidoId, consulta: token } = await searchParams;
  const [sucursales, pedido, sierra, consulta, placas] = await Promise.all([
    listarSucursalesPublicas(),
    pedidoId ? obtenerPedido(pedidoId) : Promise.resolve(null),
    anchoDeSierra(),
    token ? consultaDeCorte(token) : Promise.resolve(null),
    token ? placasCortablesPublicas() : Promise.resolve([]),
  ]);
  if (token && !consulta) notFound();
  // La placa entera de la consulta: lo guardado es la medida ya partida, y el
  // formulario parte la entera él mismo.
  const placaDeLaConsulta = consulta?.variantId ? placas.find((p) => p.variantId === consulta.variantId) : undefined;

  // Un id de pedido que no existe no es lo mismo que no haber pasado ninguno:
  // seguir de largo dejaría un corte suelto creyendo que quedó atado.
  if (pedidoId && !pedido) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={pedido ? `/admin/pedidos/${pedido.id}` : "/admin/cortes"}
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        {pedido ? `Volver al pedido ${pedido.numero}` : "Volver a cortes"}
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-foreground">Nuevo corte</h1>
      </div>

      {pedido && (
        <p className="tarjeta-atencion flex items-center gap-2.5 px-4 py-3 text-base">
          <Truck className="h-5 w-5 shrink-0 text-brand-orange" aria-hidden="true" />
          <span>
            Este corte queda atado al pedido{" "}
            <strong className="tabular">{pedido.numero}</strong> de{" "}
            {pedido.cliente}. Va a figurar en la ficha del pedido y en la del
            corte.
          </span>
        </p>
      )}

      <FormularioCorte
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
        desdeConsulta={
          consulta
            ? {
                token: consulta.token,
                placa: placaDeLaConsulta
                  ? {
                      variantId: placaDeLaConsulta.variantId,
                      descripcion: consulta.material,
                      largoMm: placaDeLaConsulta.largoMm,
                      anchoMm: placaDeLaConsulta.anchoMm,
                      color: placaDeLaConsulta.color,
                    }
                  : null,
                mitad: consulta.mitad === "largo" || consulta.mitad === "ancho" ? consulta.mitad : null,
                cantoDescripcion: consulta.cantoDescripcion ?? "",
                piezas: consulta.piezas.map((p) => ({
                  largoMm: p.largoMm,
                  anchoMm: p.anchoMm,
                  cantidad: p.cantidad,
                  respetaVeta: p.respetaVeta === 1,
                  cantoLargo: p.cantoLargo ?? 0,
                  cantoAncho: p.cantoAncho ?? 0,
                  aclaracion: "",
                  etiqueta: p.etiqueta ?? "",
                })),
              }
            : undefined
        }
        anchoSierra={sierra}
        desdePedido={
          pedido
            ? {
                id: pedido.id,
                numero: pedido.numero,
                branchId: pedido.branchId,
                contactoNombre: pedido.cliente,
                cliente: pedido.customerId
                  ? {
                      id: pedido.customerId,
                      nombre: pedido.cliente,
                      razonSocial: pedido.empresa,
                    }
                  : null,
              }
            : undefined
        }
      />
    </div>
  );
}
