"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  FileText,
  Search,
  Plus,
  Eye,
  Download,
  MessageCircle,
  Printer,
  DollarSign,
  Clock,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Trash2,
  X,
  Users,
  Package,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  facturas as initialFacturas,
  type Factura,
  type FacturaEstado,
  type FacturaTipo,
  type FacturaItem,
} from "@/lib/dashboard-data";

const estadoConfig: Record<FacturaEstado, { bg: string; label: string; icon: React.ElementType }> = {
  borrador: { bg: "bg-white/5 text-white/50", label: "Borrador", icon: FileText },
  emitida: { bg: "bg-blue-500/15 text-blue-400", label: "Emitida", icon: Clock },
  pagada: { bg: "bg-green-500/15 text-green-400", label: "Pagada", icon: CheckCircle },
  vencida: { bg: "bg-red-500/15 text-red-400", label: "Vencida", icon: AlertTriangle },
  anulada: { bg: "bg-white/5 text-white/30 line-through", label: "Anulada", icon: XCircle },
};

const formatMoney = (n: number) => {
  return "$" + n.toLocaleString("es-AR");
};

function printFactura(f: Factura) {
  const logoUrl = window.location.origin + "/cropped-icon-180x180.png";
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Factura ${f.tipo} ${f.numero} — MJBJ</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, sans-serif; color: #1a1a1a; background: #fff; padding: 0; }
  .page { max-width: 800px; margin: 0 auto; padding: 48px 40px; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand img { width: 56px; height: 56px; border-radius: 12px; }
  .brand-name { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
  .brand-sub { font-size: 11px; color: #666; margin-top: 2px; }
  .brand-info { font-size: 10px; color: #999; margin-top: 8px; line-height: 1.7; }

  .invoice-type { text-align: right; }
  .type-box { display: inline-block; border: 3px solid #1a1a1a; padding: 8px 20px; margin-bottom: 8px; }
  .type-label { font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .type-letter { font-size: 40px; font-weight: 900; line-height: 1; }
  .invoice-meta { font-size: 11px; color: #666; line-height: 1.8; text-align: right; }
  .invoice-meta strong { color: #1a1a1a; font-weight: 600; }

  /* Divider */
  .divider { height: 2px; background: linear-gradient(90deg, #e87c3e, #e87c3e 40%, #eee 40%); margin: 24px 0; }
  .divider-thin { height: 1px; background: #eee; margin: 20px 0; }

  /* Client */
  .client-box { background: #fafafa; border: 1px solid #eee; border-radius: 10px; padding: 20px; margin-bottom: 28px; }
  .client-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #999; margin-bottom: 12px; }
  .client-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 32px; }
  .client-field label { font-size: 10px; color: #999; }
  .client-field span { font-size: 13px; font-weight: 500; display: block; margin-top: 1px; }
  .client-field.full { grid-column: span 2; }

  /* Table */
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  .items-table th { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #999; padding: 10px 12px; border-bottom: 2px solid #1a1a1a; text-align: left; }
  .items-table th.right { text-align: right; }
  .items-table th.center { text-align: center; }
  .items-table td { font-size: 12px; padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
  .items-table td.right { text-align: right; }
  .items-table td.center { text-align: center; }
  .items-table td.mono { font-family: 'SF Mono', 'Consolas', monospace; font-size: 11px; }
  .items-table tr:last-child td { border-bottom: 2px solid #eee; }
  .items-table tr:nth-child(even) { background: #fafafa; }

  /* Totals */
  .totals { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .totals-box { width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
  .total-row .label { color: #666; }
  .total-row .value { font-family: 'SF Mono', 'Consolas', monospace; font-weight: 600; }
  .total-divider { height: 2px; background: #e87c3e; margin: 8px 0; }
  .total-final { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
  .total-final .label { font-size: 16px; font-weight: 800; color: #e87c3e; }
  .total-final .value { font-size: 22px; font-weight: 900; font-family: 'SF Mono', 'Consolas', monospace; color: #e87c3e; }

  /* Observations */
  .obs { background: #fffbf0; border: 1px solid #f0e6c8; border-radius: 8px; padding: 14px 18px; margin-bottom: 28px; font-size: 12px; color: #8a7340; }
  .obs-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #b89a50; margin-bottom: 6px; }

  /* Footer */
  .footer { text-align: center; padding-top: 20px; border-top: 1px solid #eee; }
  .footer p { font-size: 10px; color: #bbb; line-height: 1.8; }
  .footer .accent { color: #e87c3e; font-weight: 600; }

  /* Watermark for drafts */
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 100px; font-weight: 900; color: rgba(0,0,0,0.04); pointer-events: none; text-transform: uppercase; letter-spacing: 20px; }

  /* Print */
  @media print {
    body { padding: 0; }
    .page { padding: 24px 32px; max-width: 100%; }
    .no-print { display: none !important; }
    @page { margin: 12mm; size: A4; }
  }

  /* Print button */
  .print-bar { background: #1a1a1a; padding: 12px 24px; display: flex; justify-content: center; gap: 12px; position: sticky; top: 0; z-index: 10; }
  .print-btn { padding: 8px 24px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s; }
  .print-btn.primary { background: #e87c3e; color: white; }
  .print-btn.primary:hover { background: #d06a2e; }
  .print-btn.secondary { background: rgba(255,255,255,0.1); color: white; }
  .print-btn.secondary:hover { background: rgba(255,255,255,0.15); }
</style>
</head>
<body>
  <div class="print-bar no-print">
    <button class="print-btn primary" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      Imprimir
    </button>
    <button class="print-btn secondary" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      Guardar como PDF
    </button>
  </div>

  ${f.estado === "borrador" ? '<div class="watermark">Borrador</div>' : ""}
  ${f.estado === "anulada" ? '<div class="watermark">Anulada</div>' : ""}

  <div class="page">
    <div class="header">
      <div>
        <div class="brand">
          <img src="${logoUrl}" alt="MJBJ" />
          <div>
            <div class="brand-name">Maderera Juan B. Justo</div>
            <div class="brand-sub">Desde 1981 en Mar del Plata</div>
          </div>
        </div>
        <div class="brand-info">
          Av. Juan B. Justo 4153, Mar del Plata (B7600)<br>
          CUIT: 30-12345678-9 | IVA Responsable Inscripto<br>
          Tel: (0223) 474-3328 | info@mjbj.com.ar<br>
          Inicio de Actividades: 01/03/1981
        </div>
      </div>
      <div class="invoice-type">
        <div class="type-box">
          <div class="type-label">Factura</div>
          <div class="type-letter">${f.tipo}</div>
        </div>
        <div class="invoice-meta">
          <strong>N°</strong> ${f.numero}<br>
          <strong>Fecha:</strong> ${f.fecha}<br>
          <strong>Vto. Pago:</strong> ${f.vencimiento}<br>
          <strong>Sucursal:</strong> ${f.sucursal}
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="client-box">
      <div class="client-title">Datos del Cliente</div>
      <div class="client-grid">
        <div class="client-field">
          <label>Razón Social</label>
          <span>${f.empresa}</span>
        </div>
        <div class="client-field">
          <label>CUIT</label>
          <span style="font-family: monospace">${f.cuit}</span>
        </div>
        <div class="client-field">
          <label>Contacto</label>
          <span>${f.cliente}</span>
        </div>
        <div class="client-field">
          <label>Condición IVA</label>
          <span>${f.condicionIva}</span>
        </div>
        <div class="client-field full">
          <label>Domicilio</label>
          <span>${f.direccion}</span>
        </div>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width:45%">Descripción</th>
          <th class="center" style="width:8%">Cant.</th>
          <th style="width:12%">Unidad</th>
          <th class="right" style="width:17%">P. Unitario</th>
          <th class="right" style="width:18%">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${f.items
          .map(
            (item) => `
        <tr>
          <td>${item.descripcion}</td>
          <td class="center mono">${item.cantidad}</td>
          <td>${item.unidad}</td>
          <td class="right mono">${formatMoney(item.precioUnitario)}</td>
          <td class="right mono" style="font-weight:600">${formatMoney(item.subtotal)}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-box">
        <div class="total-row">
          <span class="label">Subtotal</span>
          <span class="value">${formatMoney(f.subtotal)}</span>
        </div>
        ${
          f.tipo === "A"
            ? `<div class="total-row">
          <span class="label">IVA 21%</span>
          <span class="value">${formatMoney(f.iva)}</span>
        </div>`
            : ""
        }
        <div class="total-divider"></div>
        <div class="total-final">
          <span class="label">TOTAL</span>
          <span class="value">${formatMoney(f.total)}</span>
        </div>
      </div>
    </div>

    ${
      f.observaciones
        ? `<div class="obs">
      <div class="obs-title">Observaciones</div>
      ${f.observaciones}
    </div>`
        : ""
    }

    <div class="divider-thin"></div>

    <div class="footer">
      <p>
        <span class="accent">Maderera Juan B. Justo</span> — Av. Juan B. Justo 4153, Mar del Plata<br>
        Tel: (0223) 474-3328 | WhatsApp: (223) 590-3118 | www.mjbj.ar<br>
        Documento no válido como factura fiscal. Sujeto a verificación con AFIP.
      </p>
    </div>
  </div>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

export default function AdminFacturacionPage() {
  const [facturasList, setFacturasList] = useState<Factura[]>(initialFacturas);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  // New invoice form state
  const [newTipo, setNewTipo] = useState<FacturaTipo>("A");
  const [newCliente, setNewCliente] = useState("");
  const [newEmpresa, setNewEmpresa] = useState("");
  const [newCuit, setNewCuit] = useState("");
  const [newCondicion, setNewCondicion] = useState("Responsable Inscripto");
  const [newDireccion, setNewDireccion] = useState("");
  const [newObs, setNewObs] = useState("");
  const [newItems, setNewItems] = useState<FacturaItem[]>([
    { descripcion: "", cantidad: 1, unidad: "unidades", precioUnitario: 0, subtotal: 0 },
  ]);

  const preview = facturasList.find((f) => f.id === previewId);

  const filtered = facturasList.filter((f) => {
    if (filtroEstado !== "todos" && f.estado !== filtroEstado) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        f.cliente.toLowerCase().includes(q) ||
        f.empresa.toLowerCase().includes(q) ||
        f.numero.includes(q) ||
        f.cuit.includes(q)
      );
    }
    return true;
  });

  const stats = {
    total: facturasList.reduce((a, f) => a + (f.estado !== "anulada" ? f.total : 0), 0),
    pendientes: facturasList.filter((f) => f.estado === "emitida").reduce((a, f) => a + f.total, 0),
    pagadas: facturasList.filter((f) => f.estado === "pagada").reduce((a, f) => a + f.total, 0),
    vencidas: facturasList.filter((f) => f.estado === "vencida").length,
  };

  const changeEstado = (id: string, estado: FacturaEstado) => {
    setFacturasList((prev) =>
      prev.map((f) => (f.id === id ? { ...f, estado } : f))
    );
    toast.success(`Factura ${estadoConfig[estado].label.toLowerCase()}`);
  };

  const updateNewItem = (idx: number, field: keyof FacturaItem, value: string | number) => {
    setNewItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[idx], [field]: value };
      item.subtotal = item.cantidad * item.precioUnitario;
      updated[idx] = item;
      return updated;
    });
  };

  const addNewItem = () => {
    setNewItems((prev) => [
      ...prev,
      { descripcion: "", cantidad: 1, unidad: "unidades", precioUnitario: 0, subtotal: 0 },
    ]);
  };

  const removeNewItem = (idx: number) => {
    if (newItems.length <= 1) return;
    setNewItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const newSubtotal = newItems.reduce((a, i) => a + i.subtotal, 0);
  const newIva = newTipo === "A" ? Math.round(newSubtotal * 0.21) : 0;
  const newTotal = newSubtotal + newIva;

  const handleCreate = () => {
    const validItems = newItems.filter((i) => i.descripcion && i.precioUnitario > 0);
    if (!validItems.length || !newCliente) return;

    const newFactura: Factura = {
      id: `fa-${Date.now()}`,
      numero: "—",
      tipo: newTipo,
      fecha: new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }),
      vencimiento: "—",
      cliente: newCliente,
      empresa: newEmpresa || "Particular",
      cuit: newCuit,
      condicionIva: newCondicion,
      direccion: newDireccion,
      items: validItems,
      subtotal: newSubtotal,
      iva: newIva,
      total: newTotal,
      estado: "borrador",
      sucursal: "Central",
      observaciones: newObs || undefined,
    };
    setFacturasList((prev) => [newFactura, ...prev]);
    toast.success("Factura creada como borrador", { description: `${newCliente} — ${formatMoney(newTotal)}` });
    setNewOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setNewCliente(""); setNewEmpresa(""); setNewCuit(""); setNewDireccion(""); setNewObs("");
    setNewItems([{ descripcion: "", cantidad: 1, unidad: "unidades", precioUnitario: 0, subtotal: 0 }]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold">Facturación</h1>
          <p className="text-sm text-white/40">Emisión y seguimiento de comprobantes</p>
        </motion.div>
        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-lg" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nueva Factura
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Facturado", value: formatMoney(stats.total), color: "text-white", accent: "border-l-2 border-l-brand-orange", icon: DollarSign },
          { label: "Pendiente de Cobro", value: formatMoney(stats.pendientes), color: "text-blue-400", accent: "border-l-2 border-l-blue-400", icon: Clock },
          { label: "Cobrado", value: formatMoney(stats.pagadas), color: "text-green-400", accent: "border-l-2 border-l-green-400", icon: CheckCircle },
          { label: "Vencidas", value: String(stats.vencidas), color: "text-red-400", accent: "border-l-2 border-l-red-400", icon: AlertTriangle },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className={`bg-white/[0.03] border-white/5 ${s.accent}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <s.icon className="h-4 w-4 text-white/30" />
                  <p className="text-[10px] text-white/40 uppercase tracking-wider">{s.label}</p>
                </div>
                <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            placeholder="Buscar por cliente, empresa, CUIT o número..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>
        <div className="flex gap-1.5">
          {[
            { id: "todos", label: "Todas" },
            { id: "borrador", label: "Borrador" },
            { id: "emitida", label: "Emitidas" },
            { id: "pagada", label: "Pagadas" },
            { id: "vencida", label: "Vencidas" },
          ].map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filtroEstado === f.id ? "default" : "outline"}
              className={filtroEstado === f.id ? "bg-brand-orange text-white" : "border-white/10 text-white/50"}
              onClick={() => setFiltroEstado(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card className="bg-white/[0.03] border-white/5">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Tipo</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Número</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Cliente</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Fecha</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Vto.</th>
                  <th className="text-center p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Items</th>
                  <th className="text-right p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Total</th>
                  <th className="text-center p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Estado</th>
                  <th className="text-right p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f, i) => {
                  const cfg = estadoConfig[f.estado];
                  return (
                    <motion.tr
                      key={f.id}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setPreviewId(f.id)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    >
                      <td className="p-4">
                        <Badge className="border-0 bg-white/10 text-white font-bold text-xs px-2">
                          {f.tipo}
                        </Badge>
                      </td>
                      <td className="p-4 text-xs font-mono text-white/60">{f.numero}</td>
                      <td className="p-4">
                        <p className="text-sm font-medium text-white">{f.cliente}</p>
                        <p className="text-[10px] text-white/40">{f.empresa}</p>
                      </td>
                      <td className="p-4 text-sm text-white/60">{f.fecha}</td>
                      <td className="p-4 text-sm text-white/60">{f.vencimiento}</td>
                      <td className="p-4 text-center text-sm text-white/60">{f.items.length}</td>
                      <td className="p-4 text-right text-sm font-mono font-bold text-white">
                        {formatMoney(f.total)}
                      </td>
                      <td className="p-4 text-center">
                        <Badge className={`border-0 text-[10px] ${cfg.bg}`}>{cfg.label}</Badge>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); setPreviewId(f.id); }}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); printFactura(f); }}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/5492235903118?text=${encodeURIComponent(`Hola ${f.cliente}, le enviamos la factura ${f.tipo} ${f.numero} por ${formatMoney(f.total)}.`)}`, "_blank"); }}>
                            <MessageCircle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ==================== INVOICE PREVIEW DIALOG ==================== */}
      <Dialog open={!!previewId} onOpenChange={() => setPreviewId(null)}>
        <DialogContent className="bg-white text-[#1a1a1a] max-w-2xl max-h-[90vh] overflow-y-auto p-0 border-0">
          {preview && (
            <div className="relative">
              {/* Actions bar */}
              <div className="sticky top-0 z-10 bg-[#18181b] text-white px-6 py-3 flex items-center justify-between">
                <p className="text-sm font-semibold">
                  Factura {preview.tipo} {preview.numero}
                </p>
                <div className="flex gap-2">
                  {preview.estado === "borrador" && (
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-7" onClick={() => { changeEstado(preview.id, "emitida"); setPreviewId(null); }}>
                      Emitir
                    </Button>
                  )}
                  {preview.estado === "emitida" && (
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs h-7" onClick={() => { changeEstado(preview.id, "pagada"); setPreviewId(null); }}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Marcar Pagada
                    </Button>
                  )}
                  {(preview.estado === "emitida" || preview.estado === "borrador") && (
                    <Button size="sm" variant="outline" className="text-xs h-7 border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => { changeEstado(preview.id, "anulada"); setPreviewId(null); }}>
                      Anular
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="text-xs h-7 border-white/20 text-white/70 hover:text-white" onClick={() => printFactura(preview)}>
                    <Download className="h-3 w-3 mr-1" /> PDF
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7 border-white/20 text-white/70 hover:text-white" onClick={() => printFactura(preview)}>
                    <Printer className="h-3 w-3 mr-1" /> Imprimir
                  </Button>
                </div>
              </div>

              {/* Invoice body */}
              <div className="p-8 space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-[#1a1a1a]">MADERERA JUAN B. JUSTO</h2>
                    <p className="text-xs text-gray-500 mt-1">Av. Juan B. Justo 4153, Mar del Plata</p>
                    <p className="text-xs text-gray-500">CUIT: 30-12345678-9 | IVA Resp. Inscripto</p>
                    <p className="text-xs text-gray-500">Tel: (0223) 474-3328 | info@mjbj.com.ar</p>
                  </div>
                  <div className="text-right">
                    <div className="inline-block border-2 border-[#1a1a1a] px-4 py-2 mb-2">
                      <p className="text-2xl font-bold">FACTURA</p>
                      <p className="text-3xl font-black text-center">{preview.tipo}</p>
                    </div>
                    <p className="text-xs text-gray-500">N° {preview.numero}</p>
                    <p className="text-xs text-gray-500">Fecha: {preview.fecha}</p>
                    <p className="text-xs text-gray-500">Vto. Pago: {preview.vencimiento}</p>
                  </div>
                </div>

                <Separator className="bg-gray-200" />

                {/* Client */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2 font-semibold">Datos del cliente</p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                    <div>
                      <span className="text-gray-400 text-xs">Razón Social: </span>
                      <span className="font-semibold">{preview.empresa}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">CUIT: </span>
                      <span className="font-mono">{preview.cuit}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">Contacto: </span>
                      <span>{preview.cliente}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">Cond. IVA: </span>
                      <span>{preview.condicionIva}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-400 text-xs">Domicilio: </span>
                      <span>{preview.direccion}</span>
                    </div>
                  </div>
                </div>

                {/* Items table */}
                <div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-[#1a1a1a]">
                        <th className="text-left py-2 font-semibold">Descripción</th>
                        <th className="text-center py-2 font-semibold w-16">Cant.</th>
                        <th className="text-center py-2 font-semibold w-20">Unidad</th>
                        <th className="text-right py-2 font-semibold w-28">P. Unitario</th>
                        <th className="text-right py-2 font-semibold w-28">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items.map((item, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="py-2.5">{item.descripcion}</td>
                          <td className="py-2.5 text-center font-mono">{item.cantidad}</td>
                          <td className="py-2.5 text-center text-gray-500">{item.unidad}</td>
                          <td className="py-2.5 text-right font-mono">{formatMoney(item.precioUnitario)}</td>
                          <td className="py-2.5 text-right font-mono font-semibold">{formatMoney(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="flex justify-end">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Subtotal</span>
                      <span className="font-mono">{formatMoney(preview.subtotal)}</span>
                    </div>
                    {preview.tipo === "A" && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">IVA 21%</span>
                        <span className="font-mono">{formatMoney(preview.iva)}</span>
                      </div>
                    )}
                    <Separator className="bg-gray-300" />
                    <div className="flex justify-between text-lg font-bold">
                      <span>TOTAL</span>
                      <span className="font-mono">{formatMoney(preview.total)}</span>
                    </div>
                  </div>
                </div>

                {/* Observations */}
                {preview.observaciones && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                    <p className="font-semibold text-xs uppercase mb-1">Observaciones</p>
                    {preview.observaciones}
                  </div>
                )}

                {/* Footer */}
                <div className="text-center text-[10px] text-gray-400 pt-4 border-t border-gray-100">
                  <p>Maderera Juan B. Justo — Desde 1981 en Mar del Plata</p>
                  <p>Sucursal: {preview.sucursal} | www.mjbj.ar</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ==================== NEW INVOICE DIALOG ==================== */}
      <Dialog open={newOpen} onOpenChange={(open) => { setNewOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="bg-[#0f0f12] border-white/10 text-white max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto p-0">
          {/* Dialog header bar */}
          <div className="sticky top-0 z-10 bg-[#0f0f12] border-b border-white/5 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-orange/15 flex items-center justify-center">
                <FileText className="h-5 w-5 text-brand-orange" />
              </div>
              <div>
                <h2 className="font-bold text-base">Nueva Factura</h2>
                <p className="text-[10px] text-white/40">Complete los datos para generar el comprobante</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Live type selector */}
              <div className="flex gap-1 bg-white/5 rounded-lg p-1">
                {(["A", "B", "C"] as FacturaTipo[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setNewTipo(t)}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${
                      newTipo === t
                        ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20"
                        : "text-white/40 hover:text-white/60"
                    }`}
                  >
                    Tipo {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6">
            {/* Two column layout: client left, preview right */}
            <div className="grid lg:grid-cols-5 gap-6">
              {/* LEFT: Client + Observations (2 cols) */}
              <div className="lg:col-span-2 space-y-5">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-4">
                  <p className="text-xs text-white/40 uppercase tracking-wider font-semibold flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" /> Datos del cliente
                  </p>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-white/50">Nombre / Contacto</Label>
                      <Input value={newCliente} onChange={(e) => setNewCliente(e.target.value)} placeholder="Nombre completo" className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-white/50">Empresa / Razón Social</Label>
                      <Input value={newEmpresa} onChange={(e) => setNewEmpresa(e.target.value)} placeholder="Razón social" className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] text-white/50">CUIT</Label>
                        <Input value={newCuit} onChange={(e) => setNewCuit(e.target.value)} placeholder="XX-XXXXXXXX-X" className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 font-mono text-xs" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] text-white/50">Cond. IVA</Label>
                        <Select value={newCondicion} onValueChange={(v) => v && setNewCondicion(v)}>
                          <SelectTrigger className="bg-white/5 border-white/10 text-white h-9 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Responsable Inscripto">Resp. Inscripto</SelectItem>
                            <SelectItem value="Monotributista">Monotributista</SelectItem>
                            <SelectItem value="Consumidor Final">Cons. Final</SelectItem>
                            <SelectItem value="Exento">Exento</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-white/50">Domicilio</Label>
                      <Input value={newDireccion} onChange={(e) => setNewDireccion(e.target.value)} placeholder="Dirección completa" className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9" />
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                  <Label className="text-[10px] text-white/50">Observaciones (opcional)</Label>
                  <Textarea value={newObs} onChange={(e) => setNewObs(e.target.value)} placeholder="Notas, condiciones de pago, plazos, etc." rows={3} className="bg-white/5 border-white/10 text-white placeholder:text-white/20 resize-none text-sm" />
                </div>

                {/* Totals card */}
                <div className="p-4 rounded-xl bg-brand-orange/5 border border-brand-orange/20 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Subtotal</span>
                    <span className="font-mono text-white font-semibold">{formatMoney(newSubtotal)}</span>
                  </div>
                  {newTipo === "A" && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">IVA 21%</span>
                      <span className="font-mono text-white font-semibold">{formatMoney(newIva)}</span>
                    </div>
                  )}
                  <Separator className="bg-white/10" />
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold text-brand-orange">TOTAL</span>
                    <span className="text-2xl font-black font-mono text-brand-orange">{formatMoney(newTotal)}</span>
                  </div>
                </div>
              </div>

              {/* RIGHT: Items table (3 cols) */}
              <div className="lg:col-span-3 space-y-4">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs text-white/40 uppercase tracking-wider font-semibold flex items-center gap-2">
                      <Package className="h-3.5 w-3.5" /> Detalle de items
                    </p>
                    <Button size="sm" variant="outline" className="border-brand-orange/30 text-brand-orange hover:bg-brand-orange/10 text-xs h-7" onClick={addNewItem}>
                      <Plus className="h-3 w-3 mr-1" /> Agregar
                    </Button>
                  </div>

                  {/* Items header */}
                  <div className="grid grid-cols-12 gap-2 px-3 mb-2">
                    <p className="col-span-5 text-[10px] text-white/30 uppercase tracking-wider">Descripción</p>
                    <p className="col-span-1 text-[10px] text-white/30 uppercase tracking-wider text-center">Cant.</p>
                    <p className="col-span-2 text-[10px] text-white/30 uppercase tracking-wider">Unidad</p>
                    <p className="col-span-2 text-[10px] text-white/30 uppercase tracking-wider text-right">P. Unitario</p>
                    <p className="col-span-1 text-[10px] text-white/30 uppercase tracking-wider text-right">Subtotal</p>
                    <p className="col-span-1" />
                  </div>

                  {/* Items rows */}
                  <div className="space-y-1.5">
                    {newItems.map((item, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                        <div className="col-span-5">
                          <Input
                            value={item.descripcion}
                            onChange={(e) => updateNewItem(i, "descripcion", e.target.value)}
                            placeholder="Producto o servicio"
                            className="bg-transparent border-0 text-white placeholder:text-white/20 h-8 text-sm px-2 focus-visible:ring-0"
                          />
                        </div>
                        <div className="col-span-1">
                          <Input
                            type="number"
                            value={item.cantidad}
                            onChange={(e) => updateNewItem(i, "cantidad", parseInt(e.target.value) || 0)}
                            min="1"
                            className="bg-transparent border-0 text-white h-8 text-sm text-center px-1 focus-visible:ring-0"
                          />
                        </div>
                        <div className="col-span-2">
                          <Input
                            value={item.unidad}
                            onChange={(e) => updateNewItem(i, "unidad", e.target.value)}
                            className="bg-transparent border-0 text-white h-8 text-sm px-2 focus-visible:ring-0"
                          />
                        </div>
                        <div className="col-span-2">
                          <Input
                            type="number"
                            value={item.precioUnitario || ""}
                            onChange={(e) => updateNewItem(i, "precioUnitario", parseInt(e.target.value) || 0)}
                            placeholder="0"
                            className="bg-transparent border-0 text-white h-8 text-sm font-mono text-right px-2 focus-visible:ring-0"
                          />
                        </div>
                        <div className="col-span-1 text-right">
                          <p className="text-xs font-mono text-white/60 pr-1">
                            {item.subtotal > 0 ? formatMoney(item.subtotal) : "—"}
                          </p>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          {newItems.length > 1 && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/20 hover:text-red-400" onClick={() => removeNewItem(i)}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Quick add hint */}
                  <button
                    onClick={addNewItem}
                    className="w-full mt-2 py-2.5 rounded-lg border border-dashed border-white/10 text-xs text-white/20 hover:text-white/40 hover:border-white/20 transition-colors"
                  >
                    + Agregar otra línea
                  </button>
                </div>

                {/* Submit buttons */}
                <div className="flex gap-3">
                  <Button
                    className="flex-1 bg-brand-orange hover:bg-brand-orange-dark text-white h-11 font-semibold"
                    disabled={!newCliente || newItems.every((i) => !i.descripcion)}
                    onClick={handleCreate}
                  >
                    <FileText className="h-4 w-4 mr-2" /> Guardar Borrador
                  </Button>
                  <Button
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white h-11 font-semibold"
                    disabled={!newCliente || newItems.every((i) => !i.descripcion)}
                    onClick={() => {
                      handleCreate();
                      setTimeout(() => {
                        setFacturasList((prev) => {
                          if (prev[0]?.estado === "borrador") {
                            const updated = [...prev];
                            updated[0] = { ...updated[0], estado: "emitida" };
                            return updated;
                          }
                          return prev;
                        });
                        toast.success("Factura emitida directamente");
                      }, 100);
                    }}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" /> Crear y Emitir
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
