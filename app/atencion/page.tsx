import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Minimize2 } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { conversacionesSinLeer } from "@/lib/dal/admin/whatsapp";
import { VistaWhatsapp } from "@/app/admin/whatsapp/vista";

export const metadata: Metadata = {
  title: "Atención por WhatsApp",
  robots: { index: false, follow: false },
};

/**
 * Puesto de atención.
 *
 * Es la misma bandeja del panel pero sola en la pantalla, pensada para quien se
 * dedica a contestar y deja esta pestaña abierta todo el día: sin menú lateral
 * ni buscador arriba, con los mensajes ocupando todo el alto disponible.
 *
 * Vive fuera de `/admin` a propósito. El layout del panel trae el menú y la
 * cabecera, y lo que se busca acá es justamente que no estén; anidarla adentro
 * habría obligado a esconderlos con CSS, que es la clase de arreglo que después
 * se rompe sin que nadie sepa por qué.
 */
export default async function AtencionPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string; filtro?: string }>;
}) {
  const usuario = await requireStaff();
  const { chat, filtro } = await searchParams;
  const sinLeer = await conversacionesSinLeer();

  return (
    <div className="panel flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link href="/admin" className="flex items-center gap-2.5">
          <Image
            src="/cropped-icon-180x180.png"
            alt=""
            width={28}
            height={28}
            className="rounded-lg"
          />
          <span className="text-base font-semibold">Atención</span>
        </Link>

        {sinLeer > 0 && (
          <span className="tabular flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-green px-1.5 text-sm font-semibold text-white">
            {sinLeer}
          </span>
        )}

        <span className="ml-auto text-base text-muted-foreground">
          {usuario.name}
        </span>

        <Link
          href="/admin/whatsapp"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Minimize2 className="h-5 w-5" />
          <span className="hidden sm:inline">Volver al panel</span>
        </Link>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <VistaWhatsapp chat={chat} filtro={filtro} pantallaCompleta />
      </main>
    </div>
  );
}
