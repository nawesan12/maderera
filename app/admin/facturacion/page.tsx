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
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); toast.info("PDF generado", { description: `Factura ${f.tipo} ${f.numero}` }); }}>
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
                  <Button size="sm" variant="outline" className="text-xs h-7 border-white/20 text-white/70 hover:text-white" onClick={() => toast.info("PDF descargado", { description: `Factura ${preview.tipo} ${preview.numero}` })}>
                    <Download className="h-3 w-3 mr-1" /> PDF
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7 border-white/20 text-white/70 hover:text-white" onClick={() => toast.info("Enviando a impresora...")}>
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
        <DialogContent className="bg-[#18181b] border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand-orange" />
              Nueva Factura
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-2">
            {/* Invoice type */}
            <div className="flex gap-3">
              {(["A", "B", "C"] as FacturaTipo[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setNewTipo(t)}
                  className={`flex-1 p-3 rounded-xl border-2 text-center transition-all ${
                    newTipo === t
                      ? "border-brand-orange bg-brand-orange/10"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <p className="text-2xl font-black">{t}</p>
                  <p className="text-[10px] text-white/40">
                    {t === "A" ? "Resp. Inscripto" : t === "B" ? "Consumidor Final" : "Exento"}
                  </p>
                </button>
              ))}
            </div>

            <Separator className="bg-white/10" />

            {/* Client info */}
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-3">Datos del cliente</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs text-white/60">Nombre / Contacto</Label>
                  <Input value={newCliente} onChange={(e) => setNewCliente(e.target.value)} placeholder="Nombre completo" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-white/60">Empresa / Razón Social</Label>
                  <Input value={newEmpresa} onChange={(e) => setNewEmpresa(e.target.value)} placeholder="Razón social" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-white/60">CUIT</Label>
                  <Input value={newCuit} onChange={(e) => setNewCuit(e.target.value)} placeholder="XX-XXXXXXXX-X" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-white/60">Condición IVA</Label>
                  <Select value={newCondicion} onValueChange={(v) => v && setNewCondicion(v)}>
                    <SelectTrigger className="bg-white/5 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Responsable Inscripto">Responsable Inscripto</SelectItem>
                      <SelectItem value="Monotributista">Monotributista</SelectItem>
                      <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                      <SelectItem value="Exento">Exento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label className="text-xs text-white/60">Domicilio</Label>
                  <Input value={newDireccion} onChange={(e) => setNewDireccion(e.target.value)} placeholder="Dirección completa" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
                </div>
              </div>
            </div>

            <Separator className="bg-white/10" />

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">Items</p>
                <Button size="sm" variant="outline" className="border-white/10 text-white/60 text-xs h-7" onClick={addNewItem}>
                  <Plus className="h-3 w-3 mr-1" /> Agregar item
                </Button>
              </div>
              <div className="space-y-2">
                {newItems.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-white/[0.03] border border-white/5">
                    <div className="col-span-5 space-y-1">
                      {i === 0 && <Label className="text-[10px] text-white/40">Descripción</Label>}
                      <Input
                        value={item.descripcion}
                        onChange={(e) => updateNewItem(i, "descripcion", e.target.value)}
                        placeholder="Producto o servicio"
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-9 text-xs"
                      />
                    </div>
                    <div className="col-span-1 space-y-1">
                      {i === 0 && <Label className="text-[10px] text-white/40">Cant.</Label>}
                      <Input
                        type="number"
                        value={item.cantidad}
                        onChange={(e) => updateNewItem(i, "cantidad", parseInt(e.target.value) || 0)}
                        min="1"
                        className="bg-white/5 border-white/10 text-white h-9 text-xs text-center"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      {i === 0 && <Label className="text-[10px] text-white/40">Unidad</Label>}
                      <Input
                        value={item.unidad}
                        onChange={(e) => updateNewItem(i, "unidad", e.target.value)}
                        className="bg-white/5 border-white/10 text-white h-9 text-xs"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      {i === 0 && <Label className="text-[10px] text-white/40">P. Unit.</Label>}
                      <Input
                        type="number"
                        value={item.precioUnitario || ""}
                        onChange={(e) => updateNewItem(i, "precioUnitario", parseInt(e.target.value) || 0)}
                        placeholder="0"
                        className="bg-white/5 border-white/10 text-white h-9 text-xs font-mono"
                      />
                    </div>
                    <div className="col-span-1 space-y-1">
                      {i === 0 && <Label className="text-[10px] text-white/40">Sub.</Label>}
                      <p className="h-9 flex items-center text-xs font-mono text-white/60">
                        {item.subtotal > 0 ? formatMoney(item.subtotal) : "—"}
                      </p>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {newItems.length > 1 && (
                        <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-white/30 hover:text-red-400" onClick={() => removeNewItem(i)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-64 space-y-2 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Subtotal</span>
                  <span className="font-mono text-white">{formatMoney(newSubtotal)}</span>
                </div>
                {newTipo === "A" && (
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">IVA 21%</span>
                    <span className="font-mono text-white">{formatMoney(newIva)}</span>
                  </div>
                )}
                <Separator className="bg-white/10" />
                <div className="flex justify-between text-lg font-bold">
                  <span className="text-brand-orange">TOTAL</span>
                  <span className="font-mono text-brand-orange">{formatMoney(newTotal)}</span>
                </div>
              </div>
            </div>

            {/* Observations */}
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Observaciones (opcional)</Label>
              <Textarea value={newObs} onChange={(e) => setNewObs(e.target.value)} placeholder="Notas, condiciones de pago, etc." rows={2} className="bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none" />
            </div>

            {/* Submit */}
            <div className="flex gap-3">
              <Button
                className="flex-1 bg-brand-orange hover:bg-brand-orange-dark text-white"
                disabled={!newCliente || newItems.every((i) => !i.descripcion)}
                onClick={handleCreate}
              >
                <FileText className="h-4 w-4 mr-2" /> Crear como Borrador
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-white/10 text-white/60 hover:text-white"
                disabled={!newCliente || newItems.every((i) => !i.descripcion)}
                onClick={() => {
                  handleCreate();
                  // Emitir directamente
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
                Crear y Emitir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
