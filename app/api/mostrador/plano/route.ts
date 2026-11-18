import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { staffOrNull } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { api } from "@/lib/api/servidor";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { cortePdf } from "@/lib/pdf/corte";
import { hojaDeCortePdf } from "@/lib/pdf/hoja-de-corte";
import type { HojaDeCorte, PiezaFijada, PlanoDeCorte } from "@/lib/cortes/tipos";

/**
 * El plano que se está armando en el mostrador, en PDF, antes de cobrar.
 *
 * Quien atiende la caja tiene que poder bajarlo en el momento (pedido de
 * Nahuel, 18/11/2026): para dárselo al cliente que todavía lo está pensando,
 * o para pasarlo al taller. Hasta ahora el PDF existía solo para un corte ya
 * cobrado, desde el panel.
 *
 * Llega el despiece, no el plano: Go lo vuelve a calcular con la hoja de la
 * máquina (`hoja: true`, solo para el staff), así el papel sale de la misma
 * cuenta que el panel y no de lo que mande el navegador. Son dos documentos
 * pegados: el reporte (datos, piezas y sobrantes) y la hoja de cada placa con
 * su dibujo y los pasos en el orden de la máquina.
 */
interface Pedido {
  material: string;
  canto: string | null;
  deQueSale: string;
  metrosCanto: number;
  cliente: string | null;
  placaLargo: number;
  placaAncho: number;
  anchoSierra: number;
  piezas: {
    largoMm: number;
    anchoMm: number;
    cantidad: number;
    respetaVeta: number;
    cantoLargo: number;
    cantoAncho: number;
    etiqueta: string | null;
  }[];
  fijadas: PiezaFijada[];
}

export async function POST(request: Request) {
  const usuario = await staffOrNull();
  if (!usuario || !puedeEntrar("/mostrador", usuario.staffRole)) {
    return new NextResponse("No autorizado", { status: 403 });
  }

  const pedido = (await request.json().catch(() => null)) as Pedido | null;
  if (!pedido || typeof pedido.material !== "string" || !Array.isArray(pedido.piezas) || pedido.piezas.length === 0) {
    return new NextResponse("Falta el despiece.", { status: 400 });
  }

  // El contrato de Go valida topes y tipos: lo que no pasa vuelve como 422.
  const r = await (await api()).POST("/api/v1/cortes/plano", {
    body: {
      piezas: pedido.piezas,
      placaLargo: pedido.placaLargo,
      placaAncho: pedido.placaAncho,
      anchoSierra: pedido.anchoSierra,
      fijadas: pedido.fijadas?.length ? pedido.fijadas : undefined,
      hoja: true,
    },
  });
  if (!r.data) return new NextResponse("No se pudo armar el plano.", { status: r.response.status === 422 ? 422 : 502 });
  const plano = r.data.plano as PlanoDeCorte;
  if (plano.placas.length === 0) return new NextResponse("El plano está vacío.", { status: 422 });

  const datos = {
    numero: "BORRADOR",
    cliente: pedido.cliente?.trim().slice(0, 120) || "Mostrador",
    material: pedido.material.slice(0, 200),
    deQueSale: String(pedido.deQueSale ?? "").slice(0, 60),
    createdAt: new Date(),
  };
  const reporte = await cortePdf(
    {
      ...datos,
      cantoDescripcion: pedido.canto?.slice(0, 200) || null,
      metrosCanto: Number(pedido.metrosCanto) || 0,
      superficieSierra: (r.data.superficies ?? []).reduce((t, x) => t + x, 0),
    },
    plano,
    await obtenerConfiguracionFiscal(),
  );

  // Sin hoja (un plano que no se corta en guillotina) sale solo el reporte.
  let pdf = reporte;
  if (r.data.hoja) {
    const hoja = await hojaDeCortePdf(datos, r.data.hoja as HojaDeCorte);
    const junto = await PDFDocument.load(reporte);
    const otro = await PDFDocument.load(hoja);
    for (const pagina of await junto.copyPages(otro, otro.getPageIndices())) junto.addPage(pagina);
    pdf = await junto.save();
  }

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="plano-de-corte.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
