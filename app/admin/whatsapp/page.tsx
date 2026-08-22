import type { Metadata } from "next";
import Link from "next/link";
import { Maximize2 } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { VistaWhatsapp } from "./vista";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string; filtro?: string }>;
}) {
  const { chat, filtro } = await searchParams;

  return (
    <div className="space-y-5">
      <EncabezadoPanel
        titulo="WhatsApp"
        detalle="Las consultas de los clientes, con su pedido y su cuenta al lado."
      >
        <Link
          href="/atencion"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Maximize2 className="h-5 w-5" />
          Pantalla completa
        </Link>
      </EncabezadoPanel>

      <VistaWhatsapp chat={chat} filtro={filtro} />
    </div>
  );
}
