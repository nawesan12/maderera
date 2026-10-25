/**
 * Golden de la plantilla de los correos (lib/email/plantillas.ts): envolver,
 * escapar y formatearPrecio. El Go (internal/email/plantilla.go,
 * internal/formato) tiene que dar el mismo HTML y el mismo texto, byte a byte.
 *
 *   npx tsx scripts/golden/plantillas.ts
 */
import { writeFileSync } from "node:fs";

process.env.APP_URL = "https://mjbj.com.ar/";

async function main() {
  const { envolver, escapar } = await import("../../lib/email/plantillas");
  const { formatearPrecio } = await import("../../lib/formato");

  const casos: Record<string, unknown>[] = [
    { titulo: "Consulta desde el sitio", adelanto: "Ana: hola", parrafos: ["Hola"] },
    {
      titulo: "Consulta desde el sitio",
      adelanto: "Juan <x>: ¿tienen fenólico de 18 \"mm\"? & más",
      saludo: "Pedido de presupuesto",
      parrafos: [escapar("Línea 1\n<b>no</b> & \"comillas\"").replace(/\n/g, "<br>")],
      datos: [
        { etiqueta: "Nombre", valor: "Juan <Pérez>" },
        { etiqueta: "Correo", valor: "juan@x.com" },
      ],
    },
    {
      titulo: "Tu pedido PED-12",
      adelanto: "Lo recibimos",
      saludo: "Ana",
      parrafos: ["Recibimos tu pedido <strong>PED-12</strong>.", "Gracias."],
      lineas: [
        { descripcion: "Fenólico 18 mm", cantidad: 2, unidad: "u", importe: 84500.5 },
        { descripcion: "Tirante 2x3", cantidad: "3,5", unidad: null, importe: null },
        { descripcion: "Flete", cantidad: 1, importe: "1234.49" },
        { descripcion: "Regalo", cantidad: 1, importe: 0 },
      ],
      total: 170235,
      cta: { texto: "Ver el pedido", url: "https://mjbj.com.ar/pedido/PED-12?t=a&b=1" },
      cierre: "Cualquier cosa, <a href=\"https://wa.me/1\">escribinos</a>.",
    },
    {
      titulo: "Campaña",
      adelanto: "Ofertas",
      parrafos: [],
      imagen: { url: "https://x/y.png?a=1&b=2", alt: "Ofertas \"de\" invierno" },
      pie: { html: "<a href=\"https://x/baja\">Darte de baja</a>", texto: "Darte de baja: https://x/baja" },
      total: "abc",
    },
  ];
  const precios = [null, 0, -5, 1, 0.5, 1.5, 2.5, 999.5, 1000, 84500, 1234567.49, 1234567.5, NaN, "84500", "x", "1e3", 1e21];
  const salida = {
    sitio: process.env.APP_URL,
    envolver: casos.map((opciones) => ({ opciones, ...envolver(opciones as never) })),
    escapar: ["", "a&b<c>d\"e'f", "&amp;"].map((t) => ({ t, r: escapar(t) })),
    precios: precios.map((v) => ({ v: typeof v === "number" && !Number.isFinite(v) ? String(v) : v, r: formatearPrecio(v as never) })),
  };
  const destino = new URL("../../backend/testdata/golden/email/envolver.json", import.meta.url);
  writeFileSync(destino, JSON.stringify(salida, null, 1) + "\n");
  console.log(`${casos.length} correos y ${precios.length} precios en ${destino.pathname}`);
}
main();
