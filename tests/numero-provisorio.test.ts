import { describe, expect, it } from "vitest";
import {
  esProvisorio,
  fechaAcotada,
  numeroProvisorio,
} from "@/lib/mostrador/offline/numero-provisorio";
import { documentoDeVenta } from "@/lib/mostrador/ticket";
import { totalDeLaVenta } from "@/lib/mostrador/importes";

/**
 * El número provisorio es lo único que el cliente se lleva escrito cuando la
 * venta se hizo sin internet, y lo único con lo que el mostrador la puede
 * encontrar después. Equivocarlo es perder la venta de vista.
 */
describe("número provisorio", () => {
  it("va con ceros adelante para que se lea siempre igual", () => {
    expect(numeroProvisorio("CAJA1", 1)).toBe("CAJA1-001");
    expect(numeroProvisorio("CAJA1", 17)).toBe("CAJA1-017");
    expect(numeroProvisorio("CAJA1", 999)).toBe("CAJA1-999");
  });

  it("pasado el 999 sigue creciendo en vez de reiniciarse", () => {
    // Reiniciar el contador haría que dos tickets compartan etiqueta.
    expect(numeroProvisorio("CAJA1", 1000)).toBe("CAJA1-1000");
  });

  it("dos cajas distintas nunca coinciden", () => {
    expect(numeroProvisorio("CAJA1", 5)).not.toBe(numeroProvisorio("CAJA2", 5));
  });

  it("se distingue del número definitivo del servidor", () => {
    expect(esProvisorio("CAJA1-017")).toBe(true);
    expect(esProvisorio("PED-1206")).toBe(false);
    expect(esProvisorio(null)).toBe(false);
  });
});

/**
 * De la hora que reclama el mostrador salen las ventas del día y el cierre de
 * caja. Un reloj mal puesto no puede mandar una venta al futuro ni al año
 * pasado.
 */
describe("fecha acotada", () => {
  const ahora = new Date("2026-09-03T15:00:00Z");

  it("respeta una hora razonable", () => {
    const hace2h = new Date("2026-09-03T13:00:00Z");
    expect(fechaAcotada(hace2h, ahora)).toEqual(hace2h);
  });

  it("una venta del futuro se trae al presente", () => {
    // Con fecha de mañana desaparecería de todos los listados del día.
    const manana = new Date("2026-09-04T10:00:00Z");
    expect(fechaAcotada(manana, ahora)).toEqual(ahora);
  });

  it("no acepta más de una semana atrás", () => {
    const anioPasado = new Date("2025-09-03T15:00:00Z");
    const resultado = fechaAcotada(anioPasado, ahora);
    expect(resultado.getTime()).toBe(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
  });

  it("una fecha inválida cae en ahora en vez de romper", () => {
    expect(fechaAcotada(new Date("no es una fecha"), ahora)).toEqual(ahora);
  });
});

/**
 * El ticket es lo único que se lleva el cliente. Si el papel dice un total y la
 * venta otro, la discusión en el mostrador la pierde el sistema.
 */
describe("documento del ticket", () => {
  const contexto = {
    sucursal: { nombre: "Casa Central", direccion: "Juan B. Justo 4153", telefono: "4743328" },
    emisor: { razonSocial: "Maderera Juan B. Justo", cuit: "30712345678" },
    whatsapp: "5492235903118",
  };

  const venta = {
    numero: "CAJA1-017",
    provisorio: true,
    cobradaAt: "2026-09-03T15:00:00.000Z",
    contactoNombre: "Consumidor final",
    medioPago: "efectivo",
    lineas: [
      { descripcion: "Fenólico 18mm", cantidad: 2, unidad: "unidad", precioUnitario: 99800 },
      { descripcion: "Tornillos", cantidad: 10, unidad: "unidad", precioUnitario: 350 },
    ],
  };

  it("el total del papel es la suma de sus renglones", () => {
    const doc = documentoDeVenta(venta, contexto);
    expect(doc.items[0].subtotal).toBe(199600);
    expect(doc.subtotal).toBe(203100);
    expect(doc.total).toBe(203100);
  });

  it("el descuento se resta del total", () => {
    const doc = documentoDeVenta({ ...venta, descuento: 3100, descuentoMotivo: "Cliente" }, contexto);
    expect(doc.total).toBe(200000);
    expect(doc.descuentoMotivo).toBe("Cliente");
  });

  it("un ticket sin conexión dice que su número es provisorio", () => {
    expect(documentoDeVenta(venta, contexto).provisorio).toBe(true);
  });

  it("una venta a cuenta corriente queda marcada", () => {
    const doc = documentoDeVenta({ ...venta, medioPago: "cuenta_corriente" }, contexto);
    expect(doc.enCuentaCorriente).toBe(true);
  });

  it("el papel dice exactamente lo que cobra el sistema", () => {
    /*
     * La garantía que importa no es que el redondeo sea perfecto: es que el
     * ticket y el cobro den **el mismo número**. Con 2,5 m² a $33,33 el
     * resultado exacto cae justo en el medio, y dos fórmulas "iguales" pueden
     * separarse por un centavo. Esa diferencia se discute en el mostrador, y
     * ahí el papel siempre gana.
     */
    const lineas = [
      { descripcion: "Machimbre", cantidad: 2.5, unidad: "m2", precioUnitario: 33.33 },
      { descripcion: "Tirante", cantidad: 3.7, unidad: "m", precioUnitario: 1234.56 },
    ];

    const doc = documentoDeVenta({ ...venta, lineas }, contexto);
    expect(doc.total).toBe(totalDeLaVenta(lineas));
  });
});
