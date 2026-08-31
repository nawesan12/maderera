import Link from "next/link";

/**
 * Ingresar / Crear cuenta.
 *
 * Se ve como un conmutador pero son dos enlaces, porque son dos rutas: cada
 * una tiene su propia acción de servidor y su propio `generateMetadata`.
 * Hacerlo con estado del cliente habría metido las dos pantallas en una URL y
 * roto el `?volver=`, que es lo que devuelve a la persona a donde estaba.
 */
export function PestanasAcceso({
  activa,
  volver,
}: {
  activa: "ingresar" | "registro";
  volver?: string;
}) {
  const sufijo = volver ? `?volver=${encodeURIComponent(volver)}` : "";

  const pestanas = [
    { id: "ingresar", label: "Ingresar", href: `/ingresar${sufijo}` },
    { id: "registro", label: "Crear cuenta", href: `/registro${sufijo}` },
  ] as const;

  return (
    <div className="flex gap-1.5 rounded-full border border-linea-suave bg-sitio-alt p-1.5">
      {pestanas.map((p) => (
        <Link
          key={p.id}
          href={p.href}
          aria-current={activa === p.id ? "page" : undefined}
          className={`flex h-10 flex-1 items-center justify-center rounded-full text-[14.5px] transition-colors ${
            activa === p.id
              ? "bg-card font-semibold text-foreground shadow-[0_1px_2px_rgb(60_50_40_/_0.12)]"
              : "text-texto-2 hover:text-foreground"
          }`}
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}
