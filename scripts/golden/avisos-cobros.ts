/**
 * Golden de los correos de cobros y facturación (lib/email/plantillas.ts:
 * reciboEmitido, chequeRechazado, facturaEmitida). El Go
 * (backend/internal/avisos/plantillas.go) tiene que dar el mismo asunto, HTML
 * y texto.
 *
 *   npx tsx --conditions=react-server scripts/golden/avisos-cobros.ts
 */
import { writeFileSync } from "node:fs";

process.env.APP_URL = "https://mjbj.com.ar/";

async function main() {
  const p = await import("../../lib/email/plantillas");
  const nombres = ["Juan", "Ana <María>", "Ñandú & Cía", ""];
  const importes = [0, 1, 84500.5, 1234567.49, 999.5, 2.5, -10];
  const saldos: (number | null)[] = [null, 0, 15000, -2500.5, -0.004, 0.005];
  const recibos = [];
  for (const nombre of nombres)
    for (const total of importes)
      for (const saldo of saldos)
        recibos.push({ entrada: { nombre, numero: "REC-0042", total, medios: "Efectivo, Cheque", saldo }, ...p.reciboEmitido({ nombre, numero: "REC-0042", total, medios: "Efectivo, Cheque", saldo }) });
  const cheques = [];
  for (const nombre of nombres)
    for (const importe of importes)
      for (const motivo of [null, "Sin fondos", "Firma <distinta>"])
        for (const porElBanco of [true, false])
          cheques.push({ entrada: { nombre, cheque: "Cheque NACIÓN N° 00123456", importe, motivo, porElBanco }, ...p.chequeRechazado({ nombre, cheque: "Cheque NACIÓN N° 00123456", importe, motivo, porElBanco }) });
  const facturas = [];
  for (const nombre of nombres)
    for (const total of importes)
      for (const conCae of [true, false])
        facturas.push({ entrada: { nombre, comprobante: "FACTURA_B 0003-00000127", total, conCae }, ...p.facturaEmitida({ nombre, comprobante: "FACTURA_B 0003-00000127", total, conCae }) });
  const destino = new URL("../../backend/testdata/golden/avisos/cobros.json", import.meta.url);
  writeFileSync(destino, JSON.stringify({ sitio: process.env.APP_URL, recibos, cheques, facturas }) + "\n");
  console.log(`${recibos.length + cheques.length + facturas.length} correos en ${destino.pathname}`);
}
main();
