/**
 * La portada de cada rubro: una foto por categoría.
 *
 * **Vive en su propio archivo y no en `seed.ts` a propósito.** `seed.ts` corre
 * `main()` apenas se lo importa, así que cualquiera que quisiera leer este mapa
 * desde otro script sembraría la base entera sin querer. Pasó: el script de
 * portadas importó `seed.ts` para reusar la lista y resembró el catálogo.
 * Un módulo de datos no tiene que hacer nada al cargarse.
 *
 * **Verificadas de dos maneras, y las dos hacen falta.** Que la URL responda
 * —varias de Unsplash que parecían válidas devolvían 404, y una portada rota
 * deja la tarjeta en gris— y que la foto muestre el rubro. Lo segundo faltaba:
 * «Techos» era una pala con tierra, «Construcción en seco» alguien dibujando un
 * plano y «Pisos» un living donde el piso casi no se ve. Daba igual mientras
 * nadie las miraba; desde que el menú las muestra en tarjetas grandes, es lo
 * primero que ve quien entra.
 *
 * Si se cambia alguna, **mirarla** después de comprobar que carga.
 *
 * Siguen siendo provisorias: una foto del depósito o del aserradero le dice más
 * a un cliente de Mar del Plata que cualquier banco de imágenes, porque muestra
 * el stock que hay de verdad.
 */
export const PORTADA: Record<string, string> = {
  // Machimbre y tirantes a la vista, que es lo que se vende para un techo.
  techos: "https://images.unsplash.com/photo-1776624383828-e1bf5d141aa7?w=800&q=80",
  // Placas apiladas y de canto: las chapas del fenólico se ven una por una.
  placas: "https://images.unsplash.com/photo-1700973408133-b45276ec8feb?w=800&q=80",
  pisos: "https://images.unsplash.com/photo-1573869908170-64b53a60d8da?w=800&q=80",
  molduras: "https://images.unsplash.com/photo-1764283824453-02cd00e49143?w=800&q=80",
  ferreteria: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
  // Gris y de intemperie, para no confundirse con el piso interior de arriba.
  "decks-y-escaleras": "https://images.unsplash.com/photo-1585597985125-9ad0229ae71d?w=800&q=80",
  // Perfiles metálicos, placa y aislante: las tres cosas que dice el rubro.
  "construccion-en-seco": "https://images.unsplash.com/photo-1768321903269-8a1f17a45c25?w=800&q=80",
  cubiertas: "https://images.unsplash.com/photo-1632759145351-1d592919f522?w=800&q=80",
};
