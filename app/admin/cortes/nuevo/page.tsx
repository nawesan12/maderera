import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Scissors, Truck } from "lucide-react";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { pedidoParaElTaller } from "@/lib/dal/admin/ventas";
import { cortesDelPedido, fichaDeCorte, obtenerCorte } from "@/lib/dal/admin/cortes";
import { requireStaff } from "@/lib/dal/session";
import { obtenerCliente } from "@/lib/dal/admin/clientes";
import { DECIDEN_EN_LA_COLA, puedeEntrar } from "@/lib/roles";
import { esUuid } from "@/lib/uuid";
import { anchoDeSierra } from "@/lib/dal/sierra";
import { FormularioCorte } from "./formulario";
import { consultaDeCorte } from "@/lib/dal/consultas-corte";
import { placasCortablesPublicas } from "@/lib/dal/cortes-publico";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { valorDeRegla } from "@/lib/reglas";

export const metadata = { title: "Nuevo corte" };

/** Solo se vuelve a pantallas propias: el chat del panel o de atención. */
const VUELTA_PERMITIDA = /^\/(admin\/whatsapp|atencion)(\?|$)/;

/**
 * Alta de una orden de corte.
 *
 * El tablero sabía mover órdenes y exportarlas al optimizador, pero ninguna
 * parte del sistema podía crear una: las que había las puso el sembrado de
 * datos de prueba.
 *
 * Con `?pedido=`, el corte nace atado a ese pedido y con el cliente, la
 * sucursal, la placa, el teléfono y el día de retiro ya puestos. Es el camino
 * real: primero entra la venta, después se manda a cortar.
 *
 * Con `?corregir=`, arranca con lo de un corte que está en la cola y, al
 * guardar, el nuevo lo reemplaza (mes simulado, H185): el malo salía primero
 * en la cola del taller y no había forma de sacarlo.
 */
export default async function NuevoCortePage({
  searchParams,
}: {
  searchParams: Promise<{
    pedido?: string;
    consulta?: string;
    grupo?: string;
    cliente?: string;
    corregir?: string;
    volver?: string;
    telefono?: string;
  }>;
}) {
  const usuario = await requireStaff();
  const decide = usuario.staffRole !== null && DECIDEN_EN_LA_COLA.includes(usuario.staffRole);
  const veClientes = puedeEntrar("/admin/clientes", usuario.staffRole);

  const sp = await searchParams;
  const { consulta: token, grupo: grupoPedido, cliente: clienteId } = sp;
  const corregido = sp.corregir && esUuid(sp.corregir) && decide ? await fichaDeCorte(sp.corregir) : null;
  if (sp.corregir && !corregido) notFound();
  const pedidoId = sp.pedido ?? corregido?.corte.orderId ?? undefined;
  // De dónde se vino: el chat del cliente (H046).
  const volver = sp.volver && VUELTA_PERMITIDA.test(sp.volver) ? sp.volver : null;
  const [sucursales, pedido, sierra, consulta, placas, cliente, ajustes] = await Promise.all([
    listarSucursalesPublicas(),
    // Sin plata: el depósito también carga cortes de un pedido (el alta no
    // es del aserradero: lib/roles.ts).
    pedidoId ? pedidoParaElTaller(pedidoId) : Promise.resolve(null),
    anchoDeSierra(),
    token ? consultaDeCorte(token) : Promise.resolve(null),
    token || pedidoId ? placasCortablesPublicas() : Promise.resolve([]),
    clienteId && esUuid(clienteId) ? obtenerCliente(clienteId) : Promise.resolve(null),
    ajustesDelSitio(),
  ]);
  if (token && !consulta) notFound();
  // El teléfono del cliente del pedido, para el aviso de «corte listo»
  // (H046). El aserradero no lo ve.
  const clienteDelPedido =
    pedido?.customerId && veClientes && !corregido ? await obtenerCliente(pedido.customerId) : null;
  // Una consulta con varias placas se pasa de a una (`?grupo=`): cada placa es
  // su propia orden de corte. Sin grupo, la primera, como antes.
  const orden = Number(grupoPedido ?? 0);
  const grupo = consulta
    ? (consulta.grupos?.find((g) => g.orden === orden) ?? (orden === 0 ? { ...consulta, orden: 0 } : undefined))
    : undefined;
  if (consulta && !grupo) notFound();
  // Una consulta que ya se pasó a corte no se ofrece otra vez: el alta la
  // rechazaría, y mostrar el formulario lleno invita a cargarla dos veces.
  const yaPasada = grupo?.corteId ? await obtenerCorte(grupo.corteId) : null;
  if (grupo?.corteId) {
    return (
      <div className="space-y-6">
        <Link
          href="/admin/cortes"
          className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
          Volver a cortes
        </Link>
        <h1 className="text-3xl font-bold text-foreground">Nuevo corte</h1>
        <p className="tarjeta-atencion flex items-center gap-2.5 px-4 py-3 text-base">
          <Scissors className="h-5 w-5 shrink-0 text-brand-orange" aria-hidden="true" />
          <span>
            Esta consulta ya se pasó a corte:{" "}
            <Link href={`/admin/cortes/${grupo.corteId}`} className="font-semibold underline underline-offset-4">
              {yaPasada ? `ver el ${yaPasada.numero}` : "ver el corte"}
            </Link>
            .
          </span>
        </p>
      </div>
    );
  }
  // La placa entera de la consulta: lo guardado es la medida ya partida, y el
  // formulario parte la entera él mismo.
  const placaDeLaConsulta = grupo?.variantId ? placas.find((p) => p.variantId === grupo.variantId) : undefined;

  // Un id de pedido que no existe no es lo mismo que no haber pasado ninguno:
  // seguir de largo dejaría un corte suelto creyendo que quedó atado.
  if (pedidoId && !pedido) notFound();

  if (corregido && corregido.corte.estado !== "en-cola" && corregido.corte.estado !== "en-proceso") {
    return (
      <div className="space-y-6">
        <Link
          href={`/admin/cortes/${corregido.corte.id}`}
          className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
          Volver a {corregido.corte.numero}
        </Link>
        <h1 className="text-3xl font-bold text-foreground">Corregir {corregido.corte.numero}</h1>
        {/* Uno anulado o reemplazado no «salió de la máquina» (H185). */}
        <p className="tarjeta-hundida rounded-xl px-4 py-3 text-base">
          {corregido.corte.estado === "cancelado"
            ? (corregido.corte.motivoAnulado ?? "Anulado")
            : `${corregido.corte.numero} ya salió de la máquina.`}
        </p>
      </div>
    );
  }

  // Las placas que vende el pedido: «Mandar a cortar» arranca con la primera
  // y no con una medida supuesta (H188), y elegir otra se confirma (H280).
  // Cuántas vende el pedido de cada placa y cuántas usan sus otros cortes:
  // el alta avisa la diferencia igual que la ficha (mes simulado, H184).
  const otrosCortes = pedido ? await cortesDelPedido(pedido.id) : [];
  const enEntera = (it: { cantidad: string | number; presentacion: string | null }) =>
    Number(it.cantidad) / (it.presentacion?.startsWith("media") ? 2 : 1);
  const placasDelPedido = (pedido?.items ?? [])
    .filter((it) => it.variantId && it.largoMm && it.anchoMm)
    .filter((it, i, todos) => todos.findIndex((o) => o.variantId === it.variantId) === i)
    .map((it) => ({
      variantId: it.variantId!,
      descripcion: it.descripcion,
      largoMm: it.largoMm,
      anchoMm: it.anchoMm,
      color: it.color,
      mitad: (it.presentacion === "media_largo" ? "largo" : it.presentacion === "media_ancho" ? "ancho" : null) as
        | "largo"
        | "ancho"
        | null,
      vendidas: (pedido?.items ?? []).filter((o) => o.variantId === it.variantId).reduce((t, o) => t + enEntera(o), 0),
      enOtrosCortes: otrosCortes
        .filter((k) => k.variantId === it.variantId && k.estado !== "cancelado" && !k.sinCargo && k.id !== corregido?.corte.id)
        .reduce((t, k) => t + k.placasEnteras, 0),
    }));

  // Un pedido que no vende la placa (la venta de un corte, que cobró las
  // pasadas): la reposición arranca con la placa de sus cortes, no con una
  // medida supuesta (mes simulado, M3S3-032).
  const varianteDeSusCortes =
    placasDelPedido.length === 0 ? otrosCortes.find((k) => k.variantId)?.variantId : undefined;
  const deSusCortes = varianteDeSusCortes ? placas.find((p) => p.variantId === varianteDeSusCortes) : undefined;
  const placaDeSusCortes = deSusCortes
    ? {
        variantId: deSusCortes.variantId,
        descripcion: deSusCortes.descripcion,
        largoMm: deSusCortes.largoMm,
        anchoMm: deSusCortes.anchoMm,
        color: deSusCortes.color,
      }
    : undefined;

  const c = corregido?.corte;
  const deCorregir = c
    ? {
        id: c.id,
        numero: c.numero,
        placa: c.variantId
          ? {
              variantId: c.variantId,
              descripcion: c.material,
              largoMm: c.varianteLargoMm,
              anchoMm: c.varianteAnchoMm,
              color: c.color,
            }
          : null,
        material: c.material,
        largoMm: c.propiaLargoMm,
        anchoMm: c.propiaAnchoMm,
        mitad: c.medida.mitad,
        cantoDescripcion: c.cantoDescripcion ?? "",
        notas: c.notas ?? "",
        urgente: c.urgente,
        contactoNombre: c.cliente,
        telefono: c.telefono ?? "",
        retiraEl: c.retiraEl ?? "",
        cliente: c.customerId ? { id: c.customerId, nombre: c.cliente, razonSocial: c.empresa } : null,
        branchId: c.branchId,
        sinCargo: c.sinCargo,
        anchoSierraMm: c.anchoSierraMm,
        fijadas: corregido?.fijadas ?? [],
        piezas: c.piezas.map((p) => ({
          largoMm: p.largoMm,
          anchoMm: p.anchoMm,
          cantidad: p.cantidad,
          respetaVeta: p.respetaVeta === 1,
          cantoLargo: p.cantoLargo,
          cantoAncho: p.cantoAncho,
          aclaracion: p.aclaracion ?? "",
          etiqueta: p.etiqueta ?? "",
        })),
      }
    : undefined;

  const vuelta = c
    ? { href: `/admin/cortes/${c.id}`, texto: `Volver a ${c.numero}` }
    : volver
      ? { href: volver, texto: "Volver al chat" }
      : pedido
        ? { href: `/admin/pedidos/${pedido.id}`, texto: `Volver al pedido ${pedido.numero}` }
        : { href: "/admin/cortes", texto: "Volver a cortes" };

  return (
    <div className="space-y-6">
      <Link
        href={vuelta.href}
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        {vuelta.texto}
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-foreground">{c ? `Corregir ${c.numero}` : "Nuevo corte"}</h1>
      </div>

      {pedido && (
        <p className="tarjeta-atencion flex items-center gap-2.5 px-4 py-3 text-base">
          <Truck className="h-5 w-5 shrink-0 text-brand-orange" aria-hidden="true" />
          <span>
            {/* Figura en la ficha del pedido y en la del corte. */}
            Este corte queda atado al pedido{" "}
            <strong className="tabular">{pedido.numero}</strong> de{" "}
            {pedido.cliente}.
          </span>
        </p>
      )}

      <FormularioCorte
        preguntarSucursal={valorDeRegla(ajustes, "sucursal_del_corte_suelto") === "preguntar"}
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
        desdeConsulta={
          consulta && grupo
            ? {
                token: consulta.token,
                grupo: grupo.orden,
                // La sucursal que eligió el cliente al mandarla: arrancaba en
                // Casa Central y el trabajo iba a la cola de otro taller
                // (mes simulado, M2S1-091).
                branchId: sucursales.find((s) => s.slug === consulta.sucursal)?.id ?? null,
                placa: placaDeLaConsulta
                  ? {
                      variantId: placaDeLaConsulta.variantId,
                      descripcion: grupo.material,
                      largoMm: placaDeLaConsulta.largoMm,
                      anchoMm: placaDeLaConsulta.anchoMm,
                      color: placaDeLaConsulta.color,
                    }
                  : null,
                mitad: grupo.mitad === "largo" || grupo.mitad === "ancho" ? grupo.mitad : null,
                cantoDescripcion: grupo.cantoDescripcion ?? "",
                piezas: grupo.piezas.map((p) => ({
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
        sierraEditable={usuario.staffRole === "admin"}
        puedeReponer={decide}
        corregir={deCorregir}
        clienteInicial={
          cliente
            ? {
                id: cliente.id,
                nombre: cliente.nombre,
                razonSocial: cliente.razonSocial,
                telefono: cliente.telefono ?? (sp.telefono?.slice(0, 40) || null),
              }
            : undefined
        }
        desdePedido={
          pedido
            ? {
                id: pedido.id,
                numero: pedido.numero,
                branchId: pedido.branchId,
                contactoNombre: pedido.cliente,
                telefono: clienteDelPedido?.telefono ?? null,
                entregarEl: pedido.entregarEl,
                placas: placasDelPedido,
                placaDeSusCortes,
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
