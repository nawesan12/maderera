"use client";

import Image from "next/image";
import { MapPin, Phone, Mail, Clock, Navigation, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const branches = [
  {
    name: "Casa Central",
    address: "Av. Juan B. Justo 4153, Mar del Plata (7600), Buenos Aires",
    phone: "(0223) 474-3328",
    email: "info@mjbj.com.ar",
    whatsapp: "2235903118",
    hours: "Lunes a Viernes 08:00 - 16:00 hs | Sábados 08:00 - 12:00 hs",
    image: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80",
    mapEmbed: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3143.7!2d-57.55!3d-38.0!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMzjCsDAwJzAwLjAiUyA1N8KwMzMnMDAuMCJX!5e0!3m2!1ses!2sar!4v1",
    services: [
      "Servicio de corte de placas a medida con precisión",
      "Amplio stock de molduras y listonería Moldava",
      "Fenólicos, tablas y puntales para obra",
      "Exhibición de vestidores, placares y muebles de cocina",
      "Asesoramiento personalizado para tu proyecto",
      "Melaminas, MDF y terciados con servicio de fraccionamiento",
    ],
    highlights: ["Showroom de muebles", "Corte CNC", "Retiro en sucursal"],
  },
  {
    name: "Aserradero",
    address: "Canosa N°61, Mar del Plata (7600), Buenos Aires",
    phone: "(0223) 483-0535",
    email: "info@aserradero.mjbj.com.ar",
    whatsapp: "2235060817",
    hours: "Lunes a Viernes 08:00 - 16:00 hs | Sábados 08:00 - 12:00 hs",
    image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80",
    mapEmbed: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3143.7!2d-57.55!3d-38.0!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMzjCsDAwJzAwLjAiUyA1N8KwMzMnMDAuMCJX!5e0!3m2!1ses!2sar!4v1",
    services: [
      "Planta de fabricación con tecnología moderna",
      "Stock permanente de techos, escaleras y decks",
      "Machimbres en pino, saligna y grandis",
      "Molduras marca Moldava - producción propia",
      "Ferretería: lacas, diluyentes, selladores y más",
      "Maderas en bruto y elaboradas a medida",
    ],
    highlights: ["Fábrica propia", "Madera a medida", "Ferretería completa"],
  },
];

export default function SucursalesPage() {
  return (
    <div className="min-h-screen">
      <div className="bg-brand-gray text-white py-12">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-3 mb-2">
            <MapPin className="h-8 w-8 text-brand-orange" />
            <h1 className="text-3xl font-bold">Nuestras Sucursales</h1>
          </div>
          <p className="text-white/70">
            Dos ubicaciones en Mar del Plata para brindarte el mejor servicio.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="space-y-16">
          {branches.map((branch, i) => (
            <motion.div
              key={branch.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.2 }}
            >
              <Card className="overflow-hidden">
                <div className="grid lg:grid-cols-2">
                  <div className="relative h-64 lg:h-auto">
                    <Image src={branch.image} alt={branch.name} fill className="object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent lg:bg-gradient-to-r" />
                    <div className="absolute bottom-4 left-4 lg:bottom-6 lg:left-6">
                      <Badge className="bg-brand-orange border-0 text-white text-base px-4 py-1.5">
                        {branch.name}
                      </Badge>
                    </div>
                  </div>
                  <CardContent className="p-6 lg:p-8 space-y-6">
                    {/* Highlights */}
                    <div className="flex flex-wrap gap-2">
                      {branch.highlights.map((h) => (
                        <Badge key={h} variant="secondary" className="bg-brand-orange/10 text-brand-orange border-0">
                          {h}
                        </Badge>
                      ))}
                    </div>

                    {/* Contact info */}
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <MapPin className="h-5 w-5 text-brand-orange mt-0.5 shrink-0" />
                        <p className="text-sm">{branch.address}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-brand-orange shrink-0" />
                        <p className="text-sm">{branch.phone}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Mail className="h-5 w-5 text-brand-orange shrink-0" />
                        <p className="text-sm">{branch.email}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Clock className="h-5 w-5 text-brand-orange shrink-0" />
                        <p className="text-sm">{branch.hours}</p>
                      </div>
                    </div>

                    <Separator />

                    {/* Services */}
                    <div>
                      <h3 className="font-semibold mb-3">Servicios</h3>
                      <ul className="grid sm:grid-cols-2 gap-2">
                        {branch.services.map((s) => (
                          <li key={s} className="text-sm text-muted-foreground flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-brand-green mt-1.5 shrink-0" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-3">
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(branch.address)}`} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline">
                          <Navigation className="h-4 w-4 mr-2" />
                          Cómo llegar
                        </Button>
                      </a>
                      <a href={`https://wa.me/549${branch.whatsapp}`} target="_blank" rel="noopener noreferrer">
                        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white">
                          <MessageCircle className="h-4 w-4 mr-2" />
                          WhatsApp
                        </Button>
                      </a>
                      <a href={`tel:${branch.phone.replace(/[^0-9]/g, "")}`}>
                        <Button variant="outline">
                          <Phone className="h-4 w-4 mr-2" />
                          Llamar
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
