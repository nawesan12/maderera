"use client";

import { useState } from "react";
import { toast } from "sonner";
import Image from "next/image";
import { motion } from "framer-motion";
import { Phone, Mail, MapPin, Clock, Send, MessageCircle, CheckCircle, ArrowRight, User, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export default function ContactoPage() {
  const [sent, setSent] = useState(false);
  const [motivo, setMotivo] = useState("");

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-brand-cream">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <Card className="max-w-md w-full text-center border-0 shadow-2xl">
            <CardContent className="p-12">
              <div className="w-20 h-20 bg-brand-green rounded-3xl flex items-center justify-center mx-auto mb-6 rotate-3">
                <CheckCircle className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-3xl font-bold mb-3">Mensaje Enviado</h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Recibimos tu consulta. Te responderemos a la brevedad por el medio que prefieras.
              </p>
              <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full px-8 h-12 font-semibold" onClick={() => setSent(false)}>
                Enviar otro mensaje
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Hero with image */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1920&q=80"
            alt="Contacto"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-brand-gray/90" />
        </div>
        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl"
          >
            <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-3">Contacto</p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 tracking-tight">
              Hablemos de tu <span className="text-brand-orange">proyecto</span>
            </h1>
            <p className="text-white/60 text-lg">
              Estamos para ayudarte. Elegí el medio que prefieras.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-16">
        <div className="grid lg:grid-cols-5 gap-10">
          {/* Contact cards - Left side */}
          <div className="lg:col-span-2 space-y-5">
            {/* Quick actions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <a
                href="https://wa.me/5492235903118?text=Hola!%20Quisiera%20hacer%20una%20consulta."
                target="_blank"
                rel="noopener noreferrer"
              >
                <Card className="bg-[#25D366] border-0 text-white hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer group">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <MessageCircle className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-base">Escribinos por WhatsApp</p>
                      <p className="text-sm text-white/80">Respuesta inmediata</p>
                    </div>
                    <ArrowRight className="h-5 w-5 opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </CardContent>
                </Card>
              </a>
            </motion.div>

            {/* Branch cards */}
            {[
              {
                name: "Casa Central",
                items: [
                  { icon: MapPin, text: "Av. Juan B. Justo 4153" },
                  { icon: Phone, text: "(0223) 474-3328" },
                  { icon: Mail, text: "info@mjbj.com.ar" },
                  { icon: Clock, text: "Lun-Vie 8-16hs | Sáb 8-12hs" },
                ],
                accent: "border-l-4 border-l-brand-orange",
              },
              {
                name: "Aserradero",
                items: [
                  { icon: MapPin, text: "Canosa N°61" },
                  { icon: Phone, text: "(0223) 483-0535" },
                  { icon: Mail, text: "info@aserradero.mjbj.com.ar" },
                  { icon: Clock, text: "Lun-Vie 8-16hs | Sáb 8-12hs" },
                ],
                accent: "border-l-4 border-l-brand-green",
              },
            ].map((branch, i) => (
              <motion.div
                key={branch.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
              >
                <Card className={`${branch.accent} border-0 shadow-sm hover:shadow-md transition-shadow`}>
                  <CardContent className="p-5">
                    <h3 className="font-bold text-base mb-3">{branch.name}</h3>
                    <div className="space-y-2.5">
                      {branch.items.map((item, j) => (
                        <div key={j} className="flex items-center gap-3 text-sm">
                          <item.icon className="h-4 w-4 text-brand-orange shrink-0" />
                          <span className="text-muted-foreground">{item.text}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Form - Right side */}
          <motion.div
            className="lg:col-span-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="border-0 shadow-xl overflow-hidden">
              <div className="bg-brand-gray p-6">
                <h2 className="text-xl font-bold text-white">Envianos tu Consulta</h2>
                <p className="text-white/50 text-sm mt-1">Te respondemos en menos de 24hs hábiles.</p>
              </div>
              <CardContent className="p-6 space-y-5">
                {/* Motivo chips */}
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 block">
                    ¿Sobre qué querés consultar?
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {["Presupuesto", "Producto", "Obra", "Otro"].map((m) => (
                      <button
                        key={m}
                        onClick={() => setMotivo(m)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                          motivo === m
                            ? "bg-brand-orange text-white shadow-md shadow-brand-orange/20"
                            : "bg-muted text-muted-foreground hover:bg-brand-orange/10 hover:text-brand-orange"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Nombre completo</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                      <Input placeholder="Tu nombre" className="pl-10 h-12 rounded-xl border-border/60 focus:border-brand-orange" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Email</Label>
                    <div className="relative">
                      <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                      <Input type="email" placeholder="tu@email.com" className="pl-10 h-12 rounded-xl border-border/60 focus:border-brand-orange" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Teléfono / WhatsApp</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input placeholder="223-..." className="pl-10 h-12 rounded-xl border-border/60 focus:border-brand-orange" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Mensaje</Label>
                  <Textarea
                    placeholder="Contanos en qué podemos ayudarte... Incluí detalles como medidas, cantidades o tipo de proyecto."
                    rows={5}
                    className="rounded-xl border-border/60 focus:border-brand-orange resize-none"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button
                    className="flex-1 bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                    onClick={() => { setSent(true); toast.success("Mensaje enviado correctamente"); }}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Enviar Mensaje
                  </Button>
                  <a
                    href="https://wa.me/5492235903118"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1"
                  >
                    <Button variant="outline" className="w-full rounded-full h-12 font-medium">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Prefiero WhatsApp
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Map */}
        <motion.div
          className="mt-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h3 className="text-lg font-bold mb-4">Encontranos en el mapa</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="overflow-hidden border-0 shadow-md">
              <div className="p-3 bg-brand-gray text-white text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-brand-orange" />
                Casa Central - Av. Juan B. Justo 4153
              </div>
              <div className="h-52">
                <iframe
                  src="https://www.openstreetmap.org/export/embed.html?bbox=-57.5600,-38.0120,-57.5480,-38.0040&layer=mapnik&marker=-38.0080,-57.5540"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  title="Mapa Casa Central"
                />
              </div>
            </Card>
            <Card className="overflow-hidden border-0 shadow-md">
              <div className="p-3 bg-brand-gray text-white text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-brand-orange" />
                Aserradero - Canosa N°61
              </div>
              <div className="h-52">
                <iframe
                  src="https://www.openstreetmap.org/export/embed.html?bbox=-57.5570,-38.0200,-57.5450,-38.0120&layer=mapnik&marker=-38.0160,-57.5510"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  title="Mapa Aserradero"
                />
              </div>
            </Card>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
