/**
 * El lado TS del benchmark de la tanda 6: agregar al carrito y
 * `confirmarCompra` **como eran antes de la mudanza** (git 791cc3f), sin
 * Next. Lo que dependía de la petición se reemplazó por lo mínimo: el carrito
 * se busca por su token (la cookie), sin sesión, la lista es la general y no
 * hay cortes a medida (el carrito del banco no tiene). El resto —el freno,
 * las escalas de pago, la transacción con la numeración, los costos, los
 * factores y la reserva— es el código de entonces (las copias de
 * scripts/golden/originales/tanda6).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  cartCortes,
  cartItems,
  carts,
  orderItems,
  orderStatusHistory,
  orders,
  paymentDiscounts,
  priceListItems,
  priceLists,
  productVariants,
  products,
} from "@/lib/db/schema";
import { permitido } from "@/lib/limites";
import { precioDeLinea, descripcionConPresentacion } from "@/lib/ventas/forma-de-venta";
import { descuentoPorMedioDePago, montoDelDescuentoDePago, medioPermitido } from "@/lib/precios/medio-pago";
import { costoPorUnidadDeVenta, costosParaCongelar } from "@/scripts/golden/originales/tanda6/congelar";
import { factoresDeStock } from "@/scripts/golden/originales/tanda6/factores";
import { siguienteNumeroDePedido } from "@/scripts/golden/originales/tanda6/numeracion-ventas";
import { reservarPedido } from "@/scripts/golden/originales/tanda6/reservas";

/** agregarAlCarrito, con el carrito del token (lo crea si no existe). */
export async function agregar(token: string, variantId: string, cantidad: number) {
  let [carrito] = await db.select({ id: carts.id }).from(carts).where(and(eq(carts.token, token), eq(carts.activo, true))).limit(1);
  if (!carrito) [carrito] = await db.insert(carts).values({ token }).returning({ id: carts.id });
  const [producto] = await db
    .select({ unit: products.unit, formaDeVenta: products.formaDeVenta, precioMediaPct: products.precioMediaPct })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId))
    .limit(1);
  const [fila] = await db
    .select({ price: priceListItems.price })
    .from(priceListItems)
    .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
    .where(and(eq(priceListItems.variantId, variantId), eq(priceLists.isDefault, true)))
    .limit(1);
  const precio = fila ? precioDeLinea(Number(fila.price), { ...producto, precioMediaPct: Number(producto.precioMediaPct) }, null).toFixed(2) : null;
  await db.insert(cartItems).values({ cartId: carrito.id, variantId, descripcion: "Banco", unidad: "unidad", cantidad: cantidad.toFixed(2), precioUnitario: precio, origen: "catalogo" });
  return { ok: "Banco va al presupuesto." };
}

/** obtenerCarrito por token, con la lista general (copia de lib/dal/carrito.ts). */
async function carritoDelToken(token: string) {
  const [carrito] = await db.select({ id: carts.id }).from(carts).where(and(eq(carts.activo, true), eq(carts.token, token))).limit(1);
  if (!carrito) return null;
  const [general] = await db.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.isDefault, true)).limit(1);
  const propia = alias(priceListItems, "precio_propio");
  const gen = alias(priceListItems, "precio_general");
  await db.select().from(cartCortes).where(eq(cartCortes.cartId, carrito.id)).orderBy(asc(cartCortes.createdAt));
  const filas = await db
    .select({
      id: cartItems.id,
      variantId: cartItems.variantId,
      descripcion: cartItems.descripcion,
      unidad: cartItems.unidad,
      cantidad: cartItems.cantidad,
      precioUnitario: cartItems.precioUnitario,
      presentacion: cartItems.presentacion,
      unit: products.unit,
      formaDeVenta: products.formaDeVenta,
      precioMediaPct: products.precioMediaPct,
      precioActual: sql<string | null>`coalesce(${propia.price}, round((${gen.price} * ${1})::numeric, 2))`,
    })
    .from(cartItems)
    .leftJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(propia, and(eq(propia.variantId, cartItems.variantId), eq(propia.priceListId, general.id)))
    .leftJoin(gen, and(eq(gen.variantId, cartItems.variantId), eq(gen.priceListId, general.id)))
    .where(eq(cartItems.cartId, carrito.id))
    .orderBy(asc(cartItems.createdAt));
  const items = filas.map((f) => {
    const cantidad = Number(f.cantidad);
    const actual = f.precioActual !== null ? Number(f.precioActual) : null;
    return { ...f, presentacion: null, cantidad, precioActual: actual, precioUnitario: f.precioUnitario ? Number(f.precioUnitario) : null, subtotal: (actual ?? 0) * cantidad };
  });
  return { id: carrito.id, items, subtotal: items.reduce((s, i) => s + i.subtotal, 0) };
}

export async function confirmar(
  token: string,
  datos: { nombre: string; email: string; telefono: string; sucursalId: string; medioPago: string },
  ip: string,
) {
  const [porIp, porCorreo] = await Promise.all([permitido("comprar", `ip:${ip}`), permitido("comprar", `correo:${datos.email.toLowerCase()}`)]);
  if (!porIp.permitido || !porCorreo.permitido) return { error: "freno" };
  const carrito = await carritoDelToken(token);
  if (!carrito || carrito.items.length === 0) return { error: "El carrito está vacío." };
  const subtotal = carrito.items.reduce((t, i) => t + i.subtotal, 0);
  if (!medioPermitido(datos.medioPago, false)) return { error: "medio" };
  const escalas = (await db.select().from(paymentDiscounts).where(eq(paymentDiscounts.activo, true))).map((e) => ({
    medio: e.medio, desdeMonto: Number(e.desdeMonto), porcentaje: Number(e.porcentaje), etiqueta: e.etiqueta,
  }));
  const escala = descuentoPorMedioDePago(escalas, datos.medioPago, subtotal);
  const descuento = escala ? montoDelDescuentoDePago(subtotal, escala.porcentaje) : 0;
  const total = subtotal - descuento;
  let numeroCreado = "";
  let tokenCreado = "";
  await db.transaction(async (tx) => {
    const numero = await siguienteNumeroDePedido(tx);
    numeroCreado = numero;
    const [pedido] = await tx
      .insert(orders)
      .values({
        numero, contactoNombre: datos.nombre, contactoEmail: datos.email, contactoTelefono: datos.telefono, branchId: datos.sucursalId,
        estado: "pendiente", origen: "tienda", tipoEntrega: "retiro", costoEnvio: "0.00", subtotal: subtotal.toFixed(2),
        descuento: descuento.toFixed(2), total: total.toFixed(2), medioPago: datos.medioPago as "transferencia", estadoPago: "pendiente",
      })
      .returning();
    const costos = await costosParaCongelar(tx, carrito.items.map((i) => i.variantId).filter((v): v is string => Boolean(v)));
    const factores = await factoresDeStock(tx, carrito.items);
    await tx.insert(orderItems).values(
      carrito.items.map((item, i) => {
        const precio = item.precioActual ?? item.precioUnitario ?? 0;
        const costo = item.variantId ? costos.get(item.variantId) : undefined;
        const { presentacion, stockPorUnidad } = factores[i]!;
        return {
          orderId: pedido.id, variantId: item.variantId, descripcion: descripcionConPresentacion(item.descripcion, presentacion),
          unidad: item.unidad, cantidad: item.cantidad.toFixed(2), precioUnitario: precio.toFixed(2),
          subtotal: (precio * item.cantidad).toFixed(2), presentacion, stockPorUnidad,
          costoUnitario: costoPorUnidadDeVenta(costo?.costoUnitario, stockPorUnidad), alicuotaIva: costo?.alicuotaIva ?? null, orden: i,
        };
      }),
    );
    await tx.insert(orderStatusHistory).values({ orderId: pedido.id, estado: "pendiente", nota: "Pedido hecho desde la tienda" });
    await reservarPedido(tx, pedido.id);
    tokenCreado = pedido.publicToken;
    await tx.delete(cartItems).where(eq(cartItems.cartId, carrito.id));
    await tx.delete(cartCortes).where(eq(cartCortes.cartId, carrito.id));
    await tx.update(carts).set({ activo: false, updatedAt: new Date() }).where(eq(carts.id, carrito.id));
  });
  return { numero: numeroCreado, token: tokenCreado };
}
