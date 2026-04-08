"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Users,
  ShieldCheck,
  FileText,
  TrendingUp,
  MessageCircle,
  Building2,
  Percent,
  Clock,
  ChevronRight,
  Lock,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ProfesionalesPage() {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <div className="min-h-screen">
      <div className="bg-brand-gray text-white py-16">
        <div className="container mx-auto px-4">
          <motion.div
            className="max-w-3xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Badge className="bg-brand-orange/20 text-brand-orange border-brand-orange/30 mb-4">
              Portal Profesionales
            </Badge>
            <h1 className="text-4xl font-bold mb-4">
              Acompañamos tu obra de{" "}
              <span className="text-brand-orange">inicio a fin</span>
            </h1>
            <p className="text-white/70 text-lg">
              Beneficios exclusivos para arquitectos, constructoras, carpinteros y profesionales
              de la construcción.
            </p>
          </motion.div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        {/* Benefits */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {[
            { icon: Percent, title: "Precios Especiales", desc: "Descuentos por volumen y precios diferenciados para profesionales registrados." },
            { icon: FileText, title: "Cuenta Corriente", desc: "Financiación a medida con cuenta corriente exclusiva para tu empresa." },
            { icon: Clock, title: "Presupuestos Express", desc: "Respuesta en menos de 24hs para presupuestos de obra completos." },
            { icon: Users, title: "Asesor Dedicado", desc: "Un ejecutivo de cuenta asignado con contacto directo por WhatsApp." },
          ].map((benefit, i) => (
            <motion.div
              key={benefit.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="h-full hover:shadow-lg hover:border-brand-orange/30 transition-all">
                <CardContent className="p-6">
                  <div className="w-12 h-12 bg-brand-orange/10 rounded-xl flex items-center justify-center mb-4">
                    <benefit.icon className="h-6 w-6 text-brand-orange" />
                  </div>
                  <h3 className="font-semibold mb-2">{benefit.title}</h3>
                  <p className="text-sm text-muted-foreground">{benefit.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Portal section */}
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          {/* Features */}
          <div>
            <h2 className="text-2xl font-bold mb-6">¿Qué incluye el Portal?</h2>
            <div className="space-y-4">
              {[
                { icon: TrendingUp, title: "Historial de compras", desc: "Accedé al detalle de todas tus compras y facturas." },
                { icon: FileText, title: "Presupuestos guardados", desc: "Guardá y reutilizá presupuestos para proyectos similares." },
                { icon: Building2, title: "Stock en tiempo real", desc: "Consultá disponibilidad en ambas sucursales al instante." },
                { icon: MessageCircle, title: "Chat directo con asesor", desc: "Comunicación directa con tu ejecutivo de cuenta." },
                { icon: ShieldCheck, title: "Certificados y fichas técnicas", desc: "Descargá documentación técnica de todos los productos." },
              ].map((feat) => (
                <div key={feat.title} className="flex gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors">
                  <div className="w-10 h-10 bg-brand-green/10 rounded-lg flex items-center justify-center shrink-0">
                    <feat.icon className="h-5 w-5 text-brand-green" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">{feat.title}</h4>
                    <p className="text-sm text-muted-foreground">{feat.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Login / Register */}
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle>Accedé al Portal</CardTitle>
              <CardDescription>
                Registrate o iniciá sesión para acceder a beneficios exclusivos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="login">
                <TabsList className="w-full">
                  <TabsTrigger value="login" className="flex-1">Iniciar Sesión</TabsTrigger>
                  <TabsTrigger value="register" className="flex-1">Registrarse</TabsTrigger>
                </TabsList>
                <TabsContent value="login" className="space-y-4 mt-4">
                  <div>
                    <Label>Email</Label>
                    <Input type="email" placeholder="tu@empresa.com" />
                  </div>
                  <div>
                    <Label>Contraseña</Label>
                    <Input type="password" placeholder="••••••••" />
                  </div>
                  <Button className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white">
                    <Lock className="h-4 w-4 mr-2" />
                    Ingresar
                  </Button>
                </TabsContent>
                <TabsContent value="register" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Nombre</Label>
                      <Input placeholder="Tu nombre" />
                    </div>
                    <div>
                      <Label>Apellido</Label>
                      <Input placeholder="Tu apellido" />
                    </div>
                  </div>
                  <div>
                    <Label>Empresa / Razón Social</Label>
                    <Input placeholder="Nombre de tu empresa" />
                  </div>
                  <div>
                    <Label>CUIT</Label>
                    <Input placeholder="XX-XXXXXXXX-X" />
                  </div>
                  <div>
                    <Label>Email profesional</Label>
                    <Input type="email" placeholder="tu@empresa.com" />
                  </div>
                  <div>
                    <Label>Teléfono</Label>
                    <Input placeholder="223-..." />
                  </div>
                  <div>
                    <Label>Rubro</Label>
                    <Input placeholder="Arquitectura, Construcción, Carpintería..." />
                  </div>
                  <Button className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white">
                    <Mail className="h-4 w-4 mr-2" />
                    Solicitar acceso
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Tu solicitud será evaluada y recibirás una respuesta en 24hs hábiles.
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <Card className="bg-brand-orange/5 border-brand-orange/20">
            <CardContent className="p-10">
              <h3 className="text-2xl font-bold mb-3">¿Preferís hablar con un asesor?</h3>
              <p className="text-muted-foreground mb-6">
                Contactanos directamente y te asignamos un ejecutivo de cuenta para tu empresa.
              </p>
              <div className="flex flex-wrap gap-3 justify-center">
                <a href="https://wa.me/5492235051535" target="_blank" rel="noopener noreferrer">
                  <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white">
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Hablar con un asesor
                  </Button>
                </a>
                <a href="tel:02234743328">
                  <Button variant="outline">
                    Llamar: (0223) 474-3328
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
