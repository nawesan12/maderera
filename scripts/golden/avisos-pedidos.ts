/**
 * Golden de los correos de pedidos, pagos, presupuestos y entregas
 * (lib/email/plantillas.ts: pedidoRecibido, pedidoCambioDeEstado,
 * pagoAcreditado, pedidoParaFirmar, remitoFirmado; y el acuse del
 * presupuesto, que vivía sin exportar en lib/notificaciones/presupuestos.ts
 * —copia textual de 7c087bb, abajo—). El Go
 * (backend/internal/avisos/pedidos.go) tiene que dar el mismo asunto, HTML y
 * texto.
 *
 * Con la zona de Buenos Aires: el acuse formatea la hora de respuesta con la
 * zona del proceso. El contenedor de Next corría en UTC y la daba tres horas
 * corrida; Go la da en hora argentina, y el golden falla si Go usa UTC.
 *
 *   TZ=America/Argentina/Buenos_Aires npx tsx --conditions=react-server scripts/golden/avisos-pedidos.ts
 */
import { writeFileSync } from "node:fs";

process.env.APP_URL = "https://mjbj.com.ar/";

async function main() {
  if (new Date("2026-06-01T12:00:00Z").getTimezoneOffset() !== 180) {
    throw new Error("Correlo con TZ=America/Argentina/Buenos_Aires");
  }
  const p = await import("../../lib/email/plantillas");
  const { fechaHora } = await import("../../lib/formato");

  // --- copia textual de acuse() (lib/notificaciones/presupuestos.ts, 7c087bb) ---
  function acuse(datos: { nombre: string; numero: string; express: boolean; respondeHasta: Date | null }) {
    const cuerpo = p.envolver({
      titulo: "Recibimos tu pedido de presupuesto",
      adelanto: `Estamos armando el presupuesto ${datos.numero}.`,
      saludo: datos.nombre,
      parrafos: [
        datos.express
          ? "Como sos cliente profesional, entra por la cola express: te contestamos dentro de las 24 horas hábiles."
          : "Lo estamos armando y te contestamos a la brevedad.",
      ],
      datos: [
        { etiqueta: "Número", valor: datos.numero },
        ...(datos.respondeHasta
          ? [
              {
                etiqueta: "Te contestamos antes de",
                valor: fechaHora.format(datos.respondeHasta),
              },
            ]
          : []),
      ],
      cierre:
        "Si necesitás agregar o cambiar algo, contestá este correo y lo ajustamos antes de cotizarlo.",
    });

    return { asunto: `Pedido de presupuesto ${datos.numero}`, ...cuerpo };
  }
  // --- fin de la copia ---

  const nombres = ["Juan", "Ana <María>", "Ñandú & Cía", ""];
  const numeros = ["PED-000123", "P-2026-0042", "PED 7/8"];
  const totales = ["84500.50", "0", "1234567.49", "999.5", "-10"];
  const lineasPedido = [
    [],
    [{ descripcion: "Placa MDF 18 mm", cantidad: 2, unidad: "u", importe: "84500.50" }],
    [
      { descripcion: "Tirante <pino> 2x4", cantidad: 3.5, unidad: "m", importe: "0" },
      { descripcion: "Corte a medida", cantidad: 1, unidad: null, importe: "1500" },
      { descripcion: "Clavos & tornillos", cantidad: 0.125, unidad: "kg", importe: "999.5" },
    ],
  ];
  const lineasRemito = [
    [],
    [{ descripcion: "Placa MDF 18 mm", cantidad: 2, unidad: "u", importe: null }],
    [
      { descripcion: "Tirante <pino> 2x4", cantidad: 3.5, unidad: "m", importe: null },
      { descripcion: "Machimbre", cantidad: 12.75, unidad: "m2", importe: null },
    ],
  ];

  const pedidos = [];
  for (const nombre of nombres)
    for (const numero of numeros)
      for (const total of totales)
        for (const lineas of lineasPedido)
          for (const [entrega, medioPago] of [
            ["Retiro en sucursal", "Mercado Pago"],
            ["Envío · Zona Sur", "A coordinar"],
          ]) {
            const entrada = { nombre, numero, token: "tok_abc123", total, entrega, medioPago, lineas };
            pedidos.push({ entrada, ...p.pedidoRecibido(entrada) });
          }

  const estados = [];
  for (const nombre of nombres)
    for (const numero of numeros)
      for (const estado of ["preparando", "listo", "en-camino", "entregado", "cancelado", "pendiente", "en_camino"])
        for (const [asunto, encabezado] of [
          [null, null],
          ["", ""],
          ["Tu pedido avanzó", "¡Ya casi!"],
          [null, "Encabezado <propio>"],
        ]) {
          const entrada = { nombre, numero, token: "tok_abc123", estado, asuntoPersonalizado: asunto, encabezadoPersonalizado: encabezado };
          estados.push({ entrada, ...p.pedidoCambioDeEstado(entrada) });
        }

  const pagos = [];
  for (const nombre of nombres)
    for (const monto of ["84500.50", "0", "1234567.49", "999.5"])
      for (const medio of [null, "", "visa", "account_money"])
        for (const [referencia, token, esDeuda] of [
          ["PED-000123", "tok_abc123", false],
          ["PED 7/8", "tok_x", false],
          ["PED-000123", null, false],
          ["PED-000123", "", false],
          ["Cuenta corriente", null, true],
        ] as const) {
          const entrada = { nombre, monto, medio, referencia, token, esDeuda };
          pagos.push({ entrada, ...p.pagoAcreditado(entrada) });
        }

  const presupuestos = [];
  for (const nombre of nombres)
    for (const numero of ["P-2026-0042", "P-2027-0001"])
      for (const express of [true, false])
        for (const respondeHasta of [null, "2026-10-29T03:05:00Z", "2026-03-05T19:00:00Z", "2026-12-31T23:30:00Z", "2026-01-01T15:00:00Z"]) {
          const entrada = { nombre, numero, express, respondeHasta };
          presupuestos.push({ entrada, ...acuse({ ...entrada, respondeHasta: respondeHasta ? new Date(respondeHasta) : null }) });
        }

  const paraFirmar = [];
  for (const nombre of nombres)
    for (const numero of numeros)
      for (const remito of ["REM-000045", "R <1>"]) {
        const entrada = { nombre, numero, remito, url: "https://mjbj.com.ar/firmar/abc&def" };
        paraFirmar.push({ entrada, ...p.pedidoParaFirmar(entrada) });
      }

  const firmados = [];
  for (const nombre of nombres)
    for (const numero of numeros)
      for (const lineas of lineasRemito)
        for (const pendiente of [true, false]) {
          const entrada = { nombre, remito: "REM-000045", numero, fecha: "5/3, 07:07", lineas, pendiente };
          firmados.push({ entrada, ...p.remitoFirmado(entrada) });
        }

  const destino = new URL("../../backend/testdata/golden/avisos/pedidos.json", import.meta.url);
  writeFileSync(
    destino,
    JSON.stringify({ sitio: process.env.APP_URL, pedidos, estados, pagos, presupuestos, paraFirmar, firmados }) + "\n",
  );
  const n = pedidos.length + estados.length + pagos.length + presupuestos.length + paraFirmar.length + firmados.length;
  console.log(`${n} correos en ${destino.pathname}`);
}
main();
