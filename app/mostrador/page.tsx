import type { Metadata } from "next";
import { ajustesDelSitio, promosVigentes } from "@/lib/dal/contenido";
import { valorDeRegla } from "@/lib/reglas";
import { tarifasDeCorte } from "@/lib/dal/cortes-tarifas";
import { anchoDeSierra } from "@/lib/dal/sierra";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { inicioDelRol, puedeEntrar } from "@/lib/roles";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { api, datos } from "@/lib/api/servidor";
import { VistaMostrador } from "./vista";
import { escalasDePago } from "@/lib/dal/descuentos-pago";
import { fichaDeCorte } from "@/lib/dal/admin/cortes";
import { esUuid } from "@/lib/uuid";

export const metadata: Metadata = {
  title: "Mostrador",
  robots: { index: false, follow: false },
};

/**
 * El punto de venta del mostrador.
 *
 * Pantalla completa y fuera de `/admin`, por lo mismo que el taller y la
 * atención por WhatsApp: quien está acá tiene a alguien esperando enfrente y
 * necesita el alto entero de la pantalla para la venta, no un menú lateral que
 * no va a tocar en todo el día.
 *
 * La sucursal viene por la dirección (`?sucursal=`) y no de una preferencia
 * guardada: la misma computadora puede estar en el mostrador de Casa Central
 * hoy y en el del aserradero mañana, y una preferencia pegada al usuario es
 * cómo se termina descontando stock de la sucursal equivocada.
 */
export default async function MostradorPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; corte?: string }>;
}) {
  const usuario = await requireStaff();

  /*
   * El mostrador es de quien atiende. Depósito y aserradero tienen su propia
   * pantalla y no cobran: dejarlos entrar acá sería darles una caja registradora
   * que no les toca. Se los manda a donde sí trabajan.
   *
   * El par sale de `ACCESO` y no está escrito acá: los endpoints de la copia
   * local usan esa misma lista, y cuando la pantalla y la API deciden cada una
   * por su cuenta es cuando una se queda atrás. Pasó: la página rebotaba y
   * `/api/mostrador/clientes` entregaba el padrón igual.
   */
  if (!puedeEntrar("/mostrador", usuario.staffRole)) {
    redirect(inicioDelRol(usuario.staffRole));
  }

  const { sucursal, corte } = await searchParams;

  const sucursales = await listarSucursalesPublicas();
  if (sucursales.length === 0) redirect("/admin/sucursales");

  const elegida =
    sucursales.find((s) => s.slug === sucursal) ?? sucursales[0];

  /*
   * El turno con sus totales, sus movimientos y el cierre Z (cuánto entró por
   * cada medio), las ventas de hoy, la lista general (con ella la pantalla
   * sabe si el cliente compra con precio de profesional, que es de contado) y
   * el cambio que tiene que quedar en el cajón: todo de Go, en un pedido.
   */
  const [pantalla, tarifas, promos, sierra, escalas, ajustes] = await Promise.all([
    (async () =>
      datos(
        await (await api()).GET("/api/v1/mostrador/pantalla", {
          params: { query: { sucursal: elegida.id } },
        }),
      ))(),
    // Las tarifas de corte, para poder cotizar un corte sin salir del
    // mostrador: hasta ahora había que ir al panel y volver con el número.
    tarifasDeCorte(),
    // Las promociones vigentes: están para contarlas, no para descontarlas.
    // Ver `PromosDelBanco`.
    promosVigentes(),
    // El espesor del disco, que el plano descuenta entre pieza y pieza y
    // ahora además se dice en pantalla.
    anchoDeSierra(),
    // El descuento por forma de pago, para que el total de la pantalla sea
    // el que va a registrar el servidor.
    escalasDePago(),
    // Las reglas que cambian la cuenta (/admin/reglas): las mismas que lee Go.
    ajustesDelSitio(),
  ]);
  const { turno, ventas, listaGeneral, fondoBase, movimientos, cierre, descuentoLibrePct, ultimoContado } = pantalla;

  /*
   * «Cobrar en el mostrador» desde la ficha de un corte sin venta (mes
   * simulado, H173): el corte llega cargado para cobrarlo, y la venta lo ata
   * en vez de crear otro.
   */
  const ficha = corte && esUuid(corte) ? await fichaDeCorte(corte) : null;
  /*
   * El corte que ya tiene su venta se cobra en esa venta, desde la ficha del
   * pedido: el mostrador abría vacío y sin decir nada (mes simulado, H173,
   * CRT-7 con PED-1158 sin cobrar). El anulado, o el que no tiene material,
   * vuelve a su ficha.
   */
  if (ficha?.corte.orderId) redirect(`/admin/pedidos/${ficha.corte.orderId}`);
  if (ficha && (ficha.corte.estado === "cancelado" || !ficha.corte.variantId)) redirect(`/admin/cortes/${ficha.corte.id}`);
  const corteACobrar =
    ficha && !ficha.corte.orderId && ficha.corte.estado !== "cancelado" && ficha.corte.variantId
      ? {
          id: ficha.corte.id,
          numero: ficha.corte.numero,
          customerId: ficha.corte.customerId,
          variantId: ficha.corte.variantId,
          material: ficha.corte.material,
          unidad: ficha.corte.unidad ?? "placa",
          precio: ficha.corte.precioPlaca ?? 0,
          largoMm: ficha.corte.varianteLargoMm,
          anchoMm: ficha.corte.varianteAnchoMm,
          color: ficha.corte.color,
          categoria: ficha.corte.categoria,
          formaDeVenta: (ficha.corte.formaDeVenta ?? "entera") as "entera" | "entera_o_media" | "metro_cuadrado",
          precioMediaPct: ficha.corte.precioMediaPct ?? 50,
          mitad: ficha.corte.mitad as "largo" | "ancho" | null,
          canto: ficha.corte.cantoDescripcion ?? "",
          pasadas: ficha.pasadasACobrar,
          piezas: ficha.corte.piezas.map((p) => ({
            largo: String(p.largoMm),
            ancho: String(p.anchoMm),
            cantidad: String(p.cantidad),
            veta: p.respetaVeta === 1,
            cantoLargo: p.cantoLargo,
            cantoAncho: p.cantoAncho,
            etiqueta: p.etiqueta ?? "",
          })),
        }
      : null;

  return (
    <VistaMostrador
      usuario={{
        nombre: usuario.name,
        userId: usuario.userId,
        administraCaja: puedeEntrar("/admin/caja", usuario.staffRole),
        factura: puedeEntrar("/admin/facturacion", usuario.staffRole),
      }}
      listaGeneral={listaGeneral}
      sucursales={sucursales.map((s) => ({
        id: s.id,
        slug: s.slug,
        nombre: s.nombre,
      }))}
      sucursal={{ id: elegida.id, slug: elegida.slug, nombre: elegida.nombre }}
      turno={turno ? { ...turno, abiertaAt: new Date(turno.abiertaAt) } : null}
      cierre={cierre}
      movimientos={movimientos}
      tarifasDeCorte={tarifas}
      anchoSierra={sierra}
      fondoBase={fondoBase}
      ultimoContado={ultimoContado ?? null}
      descuentoLibrePct={descuentoLibrePct}
      promos={promos}
      escalasDePago={escalas}
      ventas={ventas}
      corteACobrar={corteACobrar}
      reglas={{
        contadoSiempre: valorDeRegla(ajustes, "contado_por_lista") === "siempre",
        descuentoAlFlete: valorDeRegla(ajustes, "descuento_al_flete") === "si",
        loteObligatorio: valorDeRegla(ajustes, "lote_y_cupon") === "obligatorio",
      }}
    />
  );
}
