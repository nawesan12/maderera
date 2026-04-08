import Link from "next/link";
import Image from "next/image";
import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export function Footer() {
  return (
    <footer className="bg-brand-gray text-white">
      <div className="container mx-auto px-4 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Image
                src="/cropped-icon-180x180.png"
                alt="Maderera Juan B. Justo"
                width={40}
                height={40}
                className="rounded-lg"
              />
              <div>
                <p className="font-bold leading-tight">Maderera</p>
                <p className="text-sm text-white/60 leading-tight">Juan B. Justo</p>
              </div>
            </div>
            <p className="text-sm text-white/70 mb-4">
              Desde 1981 abasteciendo a Mar del Plata con los mejores productos
              de la industria maderera.
            </p>
            <div className="flex gap-3">
              <a href="#" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-brand-orange transition-colors">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>
              </a>
              <a href="#" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-brand-orange transition-colors">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
              </a>
            </div>
          </div>

          {/* Products */}
          <div>
            <h3 className="font-semibold mb-4">Productos</h3>
            <ul className="space-y-2.5 text-sm text-white/70">
              {[
                ["Techos", "/catalogo?cat=techos"],
                ["Placas", "/catalogo?cat=placas"],
                ["Pisos", "/catalogo?cat=pisos"],
                ["Molduras", "/catalogo?cat=molduras"],
                ["Ferretería", "/catalogo?cat=ferreteria"],
                ["Decks y Escaleras", "/catalogo?cat=decks"],
                ["Construcción en Seco", "/catalogo?cat=construccion-seco"],
                ["Cubiertas", "/catalogo?cat=cubiertas"],
              ].map(([name, href]) => (
                <li key={href}>
                  <Link href={href} className="hover:text-brand-orange transition-colors">
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="font-semibold mb-4">Navegación</h3>
            <ul className="space-y-2.5 text-sm text-white/70">
              {[
                ["Catálogo", "/catalogo"],
                ["Calculadora de Medidas", "/calculadora"],
                ["Stock entre Sucursales", "/stock"],
                ["Pedir Presupuesto", "/presupuesto"],
                ["Portal Profesionales", "/profesionales"],
                ["Sucursales", "/sucursales"],
                ["Quiénes Somos", "/nosotros"],
                ["Blog", "/blog"],
                ["Contacto", "/contacto"],
              ].map(([name, href]) => (
                <li key={href}>
                  <Link href={href} className="hover:text-brand-orange transition-colors">
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold mb-4">Contacto</h3>
            <ul className="space-y-3 text-sm text-white/70">
              <li className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-brand-orange" />
                <div>
                  <p className="font-medium text-white">Casa Central</p>
                  <p>Av. Juan B. Justo 4153, Mar del Plata</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-brand-orange" />
                <div>
                  <p className="font-medium text-white">Aserradero</p>
                  <p>Canosa N°61, Mar del Plata</p>
                </div>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-brand-orange" />
                (0223) 474-3328
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-brand-orange" />
                info@mjbj.com.ar
              </li>
              <li className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-brand-orange" />
                Lun-Vie 8-16hs | Sáb 8-12hs
              </li>
            </ul>
          </div>
        </div>

        <Separator className="my-8 bg-white/10" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/50">
          <p>&copy; {new Date().getFullYear()} Maderera Juan B. Justo. Todos los derechos reservados.</p>
          <p>Desde 1981 en Mar del Plata</p>
        </div>
      </div>
    </footer>
  );
}
