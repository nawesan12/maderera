"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { ClipboardList, Trash2, Plus, Minus, Send, MessageCircle, Calculator, ShoppingCart, Package, ArrowRight, User, AtSign, Phone, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useBudget } from "@/lib/budget-context";

export default function PresupuestoPage() {
  const { items, removeItem, updateQuantity, clearBudget } = useBudget();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [notas, setNotas] = useState("");
  const [sent, setSent] = useState(false);

  const whatsappMessage = encodeURIComponent(
    `Hola! Quiero presupuesto para:\n\n${items.map((item) => `- ${item.name}: ${item.quantity} ${item.unit}`).join("\n")}\n\nNombre: ${nombre}\nEmail: ${email}\nTel: ${telefono}\nSucursal: ${sucursal}\nNotas: ${notas}`
  );

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-brand-cream">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <Card className="max-w-md w-full text-center border-0 shadow-2xl">
            <CardContent className="p-12">
              <div className="w-20 h-20 bg-brand-green rounded-3xl flex items-center justify-center mx-auto mb-6 rotate-3">
                <Send className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-3xl font-bold mb-3">Presupuesto Enviado</h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Recibimos tu solicitud con {items.length} item{items.length !== 1 ? "s" : ""}. Te contactaremos a la brevedad.
              </p>
              <div className="flex gap-3 justify-center">
                <Link href="/">
                  <Button variant="outline" className="rounded-full">Volver al inicio</Button>
                </Link>
                <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full font-semibold" onClick={() => { setSent(false); clearBudget(); }}>
                  Nuevo presupuesto
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1920&q=80"
            alt="Presupuesto"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-brand-gray/90" />
        </div>
        <div className="container mx-auto px-4 relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-3">Presupuestos sin cargo</p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 tracking-tight">
              Armá tu <span className="text-brand-orange">presupuesto</span>
            </h1>
            <p className="text-white/60 text-lg max-w-xl">
              Agregá productos desde el catálogo o la calculadora, completá tus datos y recibí el presupuesto por email o WhatsApp.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-10">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Items list */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold">Items del Presupuesto</h2>
                <Badge variant="secondary" className="bg-brand-orange/10 text-brand-orange border-0 font-bold">
                  {items.length}
                </Badge>
              </div>
              {items.length > 0 && (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive/80" onClick={clearBudget}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Limpiar
                </Button>
              )}
            </div>

            {items.length === 0 ? (
              <Card className="border-0 shadow-lg overflow-hidden">
                <CardContent className="p-0">
                  <div className="bg-brand-cream p-12 text-center">
                    <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm -rotate-3">
                      <ShoppingCart className="h-10 w-10 text-brand-orange/40" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Tu presupuesto está vacío</h3>
                    <p className="text-muted-foreground mb-8 max-w-sm mx-auto">
                      Empezá agregando productos desde el catálogo o calculá los materiales que necesitás.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <Link href="/catalogo">
                        <Button variant="outline" className="rounded-full px-6 h-11">
                          <Package className="h-4 w-4 mr-2" />
                          Explorar catálogo
                        </Button>
                      </Link>
                      <Link href="/calculadora">
                        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full px-6 h-11 font-semibold shadow-lg shadow-brand-orange/20">
                          <Calculator className="h-4 w-4 mr-2" />
                          Usar calculadora
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-0 shadow-lg">
                <CardContent className="p-0 divide-y">
                  {items.map((item, i) => (
                    <motion.div
                      key={item.id}
                      className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      <div className="w-10 h-10 bg-brand-orange/10 rounded-xl flex items-center justify-center shrink-0">
                        <Package className="h-5 w-5 text-brand-orange" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{item.category}</p>
                      </div>
                      <div className="flex items-center gap-1.5 bg-muted rounded-full px-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full hover:bg-white"
                          onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="text-sm font-mono font-bold w-14 text-center">
                          {item.quantity} <span className="text-muted-foreground font-normal text-xs">{item.unit}</span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full hover:bg-white"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeItem(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </motion.div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Contact form */}
          <div>
            <Card className="sticky top-24 border-0 shadow-xl overflow-hidden">
              <div className="bg-brand-gray p-5">
                <h3 className="text-lg font-bold text-white">Datos de Contacto</h3>
                <p className="text-white/50 text-xs mt-1">Completá para recibir tu presupuesto.</p>
              </div>
              <CardContent className="p-5 space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Nombre completo</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="pl-10 h-11 rounded-xl border-border/60" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Email</Label>
                  <div className="relative">
                    <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10 h-11 rounded-xl border-border/60" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Teléfono / WhatsApp</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input placeholder="223-..." value={telefono} onChange={(e) => setTelefono(e.target.value)} className="pl-10 h-11 rounded-xl border-border/60" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sucursal de retiro</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: "central", label: "Casa Central", sub: "Av. Juan B. Justo" },
                      { id: "aserradero", label: "Aserradero", sub: "Canosa N°61" },
                    ].map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSucursal(s.id)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          sucursal === s.id
                            ? "border-brand-orange bg-brand-orange/5"
                            : "border-border/60 hover:border-brand-orange/30"
                        }`}
                      >
                        <p className="text-xs font-semibold">{s.label}</p>
                        <p className="text-[10px] text-muted-foreground">{s.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Notas</Label>
                  <Textarea placeholder="Detalles del proyecto..." value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className="rounded-xl border-border/60 resize-none" />
                </div>
                <div className="pt-2 space-y-2.5">
                  <Button
                    className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                    disabled={items.length === 0 || !nombre || !email}
                    onClick={() => { setSent(true); toast.success("Presupuesto enviado correctamente"); }}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Enviar Presupuesto
                  </Button>
                  <a
                    href={`https://wa.me/5492235903118?text=${whatsappMessage}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" className="w-full rounded-full h-11 font-medium" disabled={items.length === 0}>
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Enviar por WhatsApp
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
