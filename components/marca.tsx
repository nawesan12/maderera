import Image from "next/image";

/**
 * La marca: la «M» del logo y el nombre, escrito como en el logo —MADERERA
 * espaciada y fina, JUAN B. JUSTO en negrita—.
 *
 * El nombre va en texto y no en la imagen del logo completo
 * (`public/marca/logo-maderera.png`, 463 × 89): esa tiene el nombre en gris,
 * que no se lee sobre el pie ni el panel oscuros, y no se puede agrandar sin
 * que se pixele. El ícono sí: es de 180 px, y a doble densidad alcanza hasta
 * 90 px en pantalla.
 *
 * Una sola pieza para todo el sistema (notas del 9/11/2026: «más presencia a
 * la marca, logo y nombre más grandes en todos lados»); antes cada pantalla
 * tenía su copia, con tamaños distintos.
 */
const TAMANOS = {
  // Entre 1024 y 1280 la barra lleva todos los enlaces: ahí va un poco más
  // chica para no correr la página de costado.
  barra: {
    icono: 56,
    clase: "h-12 w-12 xl:h-14 xl:w-14",
    nombre: "text-[18px] xl:text-[21px]",
    arriba: "text-[10px] xl:text-[11px]",
    radio: "rounded-[13px]",
  },
  pie: { icono: 60, nombre: "text-[23px]", arriba: "text-[11.5px]", radio: "rounded-[15px]" },
  panel: { icono: 38, nombre: "text-[16px]", arriba: "text-[9.5px]", radio: "rounded-[10px]" },
  grande: { icono: 84, nombre: "text-[34px]", arriba: "text-[14px]", radio: "rounded-[20px]" },
} as const;

export function Marca({
  tamano = "barra",
  tono = "claro",
  etiqueta,
}: {
  tamano?: keyof typeof TAMANOS;
  /** «oscuro» es sobre fondo oscuro: el pie, el menú del panel. */
  tono?: "claro" | "oscuro";
  /** Lo que reemplaza a MADERERA arriba del nombre: «Panel», «Taller». */
  etiqueta?: string;
}) {
  const t = TAMANOS[tamano];
  return (
    <span className="flex items-center gap-3">
      <Image
        src="/cropped-icon-180x180.png"
        alt=""
        width={t.icono}
        height={t.icono}
        className={`${t.radio} ${"clase" in t ? t.clase : ""} shrink-0`}
        priority={tamano === "barra"}
      />
      <span className="whitespace-nowrap leading-none">
        <span
          className={`block ${t.arriba} font-medium uppercase tracking-[0.42em] ${
            tono === "oscuro" ? "text-white/65" : "text-texto-3"
          }`}
        >
          {etiqueta ?? "Maderera"}
        </span>
        <span
          className={`mt-1 block ${t.nombre} font-extrabold uppercase tracking-[0.03em] ${
            tono === "oscuro" ? "text-white" : "text-foreground"
          }`}
        >
          Juan B. Justo
        </span>
      </span>
      <span className="sr-only">Maderera Juan B. Justo</span>
    </span>
  );
}
