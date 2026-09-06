import { Layers, Scissors, Truck, Wallet } from "lucide-react";

/**
 * Por qué la maderera y no la de al lado.
 *
 * Las cuatro frases salen del brief, de la pregunta "tres razones por las que
 * un cliente los elige y no va a la competencia". Antes eran genéricas
 * —"asesoramiento sin cargo", "envíos"— y decían lo mismo que diría cualquier
 * corralón: no distinguían nada. El cliente contestó, textual: resolver todo
 * en un lugar para ahorrar tiempo y dinero; cortes a medida, tapacantos y
 * logística; y facilidades de pago que se actualizan.
 *
 * **Es la misma en la portada y en el catálogo**, con dos fondos. Antes había
 * dos franjas distintas, con cuatro promesas distintas cada una, y eso era
 * parte de que el catálogo se sintiera otro sitio: el mismo negocio decía
 * cosas diferentes según la pantalla.
 */
const BENEFICIOS = [
  { icono: Layers, texto: "Todo para tu obra en un solo lugar" },
  { icono: Scissors, texto: "Cortes a medida y pegado de tapacantos" },
  { icono: Truck, texto: "Coordinamos la entrega y el flete" },
  { icono: Wallet, texto: "Facilidades de pago y cuenta corriente" },
];

export function FranjaBeneficios({
  tono = "oscuro",
}: {
  /** "oscuro" para la portada; "claro" para el catálogo, sobre la tarjeta. */
  tono?: "oscuro" | "claro";
}) {
  const esOscuro = tono === "oscuro";

  return (
    <section
      className={
        esOscuro
          ? "bg-[#3a352f] text-white"
          : "border-b border-linea-suave bg-card"
      }
    >
      <ul className="contenedor grid grid-cols-2 gap-x-6 gap-y-4 py-5 lg:grid-cols-4">
        {BENEFICIOS.map((b) => (
          <li key={b.texto} className="flex items-center gap-[11px]">
            <span
              className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] ${
                esOscuro
                  ? "bg-brand-orange/15 text-brand-orange-light"
                  : "bg-naranja-claro text-acento-texto"
              }`}
            >
              <b.icono className="h-[17px] w-[17px]" />
            </span>
            <span
              className={`text-[14.5px] leading-[1.35] ${
                esOscuro ? "text-white/85" : "text-texto-2"
              }`}
            >
              {b.texto}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
