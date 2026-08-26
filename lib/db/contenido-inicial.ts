/**
 * El contenido con el que arrancó el sitio.
 *
 * Los seis artículos del blog y los cuatro testimonios vivían en
 * `lib/products.ts` como constantes de TypeScript: publicar una nota costaba un
 * deploy. `seed-contenido.ts` los pasó a la base y el mock se borró.
 *
 * Queda acá y no se borra por dos razones: es el registro de de dónde salió el
 * contenido inicial, y permite reconstruir la base desde cero sin perderlo.
 * **No lo lee ninguna pantalla**; el sitio consulta la base.
 */

export const TESTIMONIOS_INICIALES = [
  {
    name: "Arq. Carolina Méndez",
    role: "Estudio CM Arquitectura",
    text: "Trabajamos con MJBJ desde hace 8 años. Su servicio de corte de placas es impecable y nos ahorran mucho tiempo en obra.",
    avatar: "CM",
  },
  {
    name: "Roberto Fernández",
    role: "Constructor - RF Construcciones",
    text: "El stock que manejan entre las dos sucursales nos permite no parar nunca la obra. Siempre tienen lo que necesitamos.",
    avatar: "RF",
  },
  {
    name: "Martín Pérez",
    role: "Carpintero independiente",
    text: "La marca Moldava es la mejor relación calidad-precio en molduras. Y el asesoramiento del equipo es excelente.",
    avatar: "MP",
  },
  {
    name: "Ing. Laura Gómez",
    role: "Directora de Obras - Constructora del Sur",
    text: "El presupuesto sin cargo y la entrega en obra nos simplifica mucho la logística. Muy profesionales.",
    avatar: "LG",
  },
];

export interface PostInicial {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  image: string;
  category: string;
  date: string;
  readTime: string;
}

export const POSTS_INICIALES: PostInicial[] = [
  {
    id: "1",
    slug: "como-elegir-machimbre-para-techo",
    title: "Cómo elegir el machimbre correcto para tu techo",
    excerpt: "Guía completa sobre tipos de machimbre, espesores y maderas recomendadas según el uso y presupuesto.",
    content: `El machimbre es una de las terminaciones más elegantes y cálidas para techos, pero elegir el tipo correcto puede marcar la diferencia entre un resultado profesional y uno mediocre.

## Tipos de madera

Las opciones más comunes en nuestra zona son:

- **Pino Paraná**: La opción más económica y versátil. Ideal para espacios interiores y galerías cubiertas. Disponible en finger joint (sin nudos) o con nudos a la vista.
- **Pino Elliotis tratado**: Recomendado cuando hay exposición a humedad. El tratamiento CCA lo protege contra hongos e insectos.
- **Eucalyptus grandis**: Mayor dureza y durabilidad. Excelente para quinchos y espacios semi-cubiertos.

## Espesores recomendados

El espesor depende del uso y la distancia entre tirantes:

- **1/2" (12.5mm)**: Para cielorrasos decorativos sin función estructural, con tirantes cada 40cm máximo.
- **3/4" (19mm)**: El estándar para techos residenciales. Soporta bien el tránsito ocasional para mantenimiento.
- **1" (25mm)**: Para techos que recibirán sobrecarga como equipos de aire acondicionado o paneles solares.

## Consejos de instalación

Siempre dejá el machimbre aclimatar 48 horas en el ambiente donde se va a instalar. Esto evita deformaciones posteriores. Usá clavos galvanizados o de acero inoxidable para prevenir manchas de óxido, especialmente en zonas costeras como Mar del Plata.

En nuestra sucursal podés ver muestras de todas las opciones y recibir asesoramiento personalizado para tu proyecto.`,
    image: "https://images.unsplash.com/photo-1520333789090-1afc82db536a?w=600&q=80",
    category: "Techos",
    date: "15 Mar 2026",
    readTime: "5 min",
  },
  {
    id: "2",
    slug: "optimizacion-cortes-placas",
    title: "Optimización de cortes de placas: ahorrá material",
    excerpt: "Tips profesionales para planificar tus cortes y reducir el desperdicio de melamina y MDF.",
    content: `Uno de los mayores costos ocultos en carpintería y amoblamientos es el desperdicio de material. Una placa de melamina de 1.83 x 2.75m no es barata, y un mal plan de cortes puede significar perder hasta un 30% del material.

## Planificá antes de cortar

El error más común es ir cortando pieza por pieza sin un plan general. Antes de hacer el primer corte:

- **Listá todas las piezas** que necesitás con sus medidas exactas.
- **Agrupá por espesor y color**: cada variante requiere una placa distinta.
- **Considerá la veta**: en melaminas con textura, la dirección importa.

## Aprovechá nuestra calculadora online

En mjbj.ar tenemos una calculadora de cortes que optimiza automáticamente la distribución de piezas en la placa. Solo ingresá las medidas y te muestra el mejor aprovechamiento posible.

## El servicio de corte en nuestro aserradero

Nuestro aserradero cuenta con seccionadora industrial que garantiza cortes rectos y precisos. El servicio incluye:

- Corte con tolerancia de ±0.5mm
- Enchapado de cantos en melamina del mismo color
- Etiquetado de piezas para fácil armado

Traé tu lista de cortes o enviala por WhatsApp y te armamos el presupuesto en el día.`,
    image: "https://images.unsplash.com/photo-1520333789090-1afc82db536a?w=600&q=80",
    category: "Placas",
    date: "28 Feb 2026",
    readTime: "4 min",
  },
  {
    id: "3",
    slug: "deck-madera-vs-pvc-mar-del-plata",
    title: "Deck de madera vs PVC: qué conviene en Mar del Plata",
    excerpt: "Comparativa de durabilidad, mantenimiento y costo considerando el clima marítimo de la costa.",
    content: `Mar del Plata tiene un clima particular: humedad alta, vientos salinos y amplitud térmica considerable. Esto hace que la elección del material para decks sea especialmente importante.

## Deck de madera (Eucalyptus Grandis)

El grandis tratado es la opción tradicional y sigue siendo muy popular:

- **Ventajas**: Aspecto natural incomparable, se puede lijar y renovar, buen aislante térmico (no quema los pies en verano), más económico inicialmente.
- **Desventajas**: Requiere mantenimiento anual (aceite o lasur), puede deformarse si no se trata correctamente, la humedad costera acelera el deterioro.
- **Vida útil**: 15-20 años con mantenimiento adecuado.

## Deck de PVC / WPC (Wood Plastic Composite)

La alternativa moderna que viene ganando terreno:

- **Ventajas**: Cero mantenimiento, resistente a la humedad y salitre, no se astilla, colores uniformes, garantía de 25 años.
- **Desventajas**: Mayor costo inicial (2-3x), se calienta más al sol, aspecto menos natural, no se puede reparar localmente.
- **Vida útil**: 25+ años sin mantenimiento.

## Nuestra recomendación

Para balcones y terrazas pequeñas con mucha exposición al mar, el PVC es la mejor inversión a largo plazo. Para quinchos, jardines y espacios grandes donde el presupuesto importa, el grandis tratado sigue siendo imbatible.

Visitanos y te mostramos muestras de ambos materiales para que puedas comparar textura, color y sensación.`,
    image: "https://images.unsplash.com/photo-1591825729269-caeb344f6df2?w=600&q=80",
    category: "Decks",
    date: "10 Feb 2026",
    readTime: "6 min",
  },
  {
    id: "4",
    slug: "construccion-en-seco-ventajas-ampliaciones",
    title: "Construcción en seco: ventajas para ampliaciones",
    excerpt: "Por qué cada vez más arquitectos eligen steel frame y drywall para reformas y ampliaciones.",
    content: `La construcción en seco revolucionó el mercado de las reformas y ampliaciones. En lugar de ladrillos, cemento y tiempos de fraguado, se trabaja con perfiles de acero galvanizado y placas de yeso (Durlock).

## Velocidad de obra

Una ampliación de 20m² que en construcción tradicional lleva 3-4 meses, en seco se resuelve en 3-4 semanas. Esto significa:

- Menos mano de obra
- Menor costo financiero
- Menos molestias para la familia

## Aislación superior

Las paredes en seco permiten incorporar aislación térmica y acústica en su interior:

- **Lana de vidrio**: La opción estándar, excelente relación costo-beneficio.
- **Lana de roca**: Superior en aislación acústica y resistencia al fuego.
- **EPS (poliestireno expandido)**: Económico y eficiente térmicamente.

## Resistencia y durabilidad

Contrario al mito popular, una pared de Durlock bien ejecutada es extremadamente resistente. Las placas de 12.5mm estándar soportan hasta 30kg por punto de fijación con el taco adecuado.

## Nuestro stock

Manejamos stock permanente de todos los componentes: placas estándar, resistentes a la humedad (verdes) y resistentes al fuego (rosas), perfiles, tornillería, masilla y cintas. Todo lo que necesitás en un solo lugar.`,
    image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&q=80",
    category: "Construcción en Seco",
    date: "1 Feb 2026",
    readTime: "7 min",
  },
  {
    id: "5",
    slug: "molduras-detalle-transforma-ambientes",
    title: "Molduras: el detalle que transforma tus ambientes",
    excerpt: "Cómo usar zócalos, marcos y cornisas para darle personalidad a cualquier espacio.",
    content: `Las molduras son ese detalle que separa un ambiente "terminado" de uno realmente bien diseñado. Con la línea Moldava que trabajamos, las posibilidades son infinitas.

## Tipos de molduras y sus usos

- **Zócalos**: Protegen la base de la pared y dan terminación al encuentro pared-piso. Los más populares son los de 7cm y 10cm de alto.
- **Guardapolvo**: Similar al zócalo pero más bajo (3-5cm). Ideal para ambientes modernos y minimalistas.
- **Marco de puerta**: El más visible de la casa. Un buen marco transforma una puerta simple en un elemento decorativo.
- **Cornisas**: Para el encuentro pared-techo. Crean un efecto visual de mayor altura y elegancia.
- **Contramarcos**: El complemento del marco, se coloca del lado opuesto para dar terminación.

## ¿Por qué Moldava?

La marca Moldava trabaja con pino finger joint, que tiene ventajas clave:

- **Sin nudos**: Superficie uniforme perfecta para pintar o lacar.
- **Estabilidad dimensional**: El finger joint minimiza la deformación.
- **Variedad**: Más de 45 perfiles diferentes para cada necesidad.

## Tips de instalación

Para un resultado profesional, cortá siempre a 45° en las esquinas usando una caja de ingletes. Usá adhesivo de montaje y clavos sin cabeza. Sellá las uniones con masilla para madera antes de pintar.

Todas las molduras Moldava están disponibles en ambas sucursales con stock permanente.`,
    image: "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=600&q=80",
    category: "Molduras",
    date: "20 Ene 2026",
    readTime: "4 min",
  },
  {
    id: "6",
    slug: "guia-aislacion-termica-techos-zona-costera",
    title: "Guía de aislación térmica para techos en zona costera",
    excerpt: "Materiales y técnicas de aislación para combatir la humedad y los vientos de Mar del Plata.",
    content: `En una ciudad costera como Mar del Plata, un techo mal aislado significa frío en invierno, calor en verano y problemas de condensación todo el año. La buena noticia: con los materiales correctos, la solución es más simple de lo que parece.

## El sistema completo de aislación

Un techo bien aislado tiene varias capas, de abajo hacia arriba:

1. **Machimbre o cielorraso**: La terminación visible desde el interior.
2. **Barrera de vapor**: Membrana que evita que la humedad interior suba al aislante. Imprescindible en zona costera.
3. **Aislante térmico**: El corazón del sistema (ver opciones abajo).
4. **Membrana hidrófuga**: Protege el aislante de la lluvia y la humedad exterior.
5. **Cubierta**: Chapas, tejas o la terminación exterior elegida.

## Materiales de aislación

- **Lana de vidrio 50mm**: El estándar para viviendas. R=1.25 m²K/W. Económica y fácil de instalar.
- **Lana de vidrio 100mm**: Para máximo confort térmico. R=2.50 m²K/W. Recomendada para dormitorios.
- **Poliestireno expandido (EPS)**: No absorbe humedad, ideal para zonas muy expuestas. Disponible en distintos espesores.
- **Espuma de polietileno con aluminio**: Solución delgada (10mm) con barrera radiante incorporada. Práctica para renovaciones.

## Error común

El error más frecuente es poner aislante sin barrera de vapor. En Mar del Plata, la humedad interior condensa en el aislante frío y genera hongos. Siempre colocá la barrera de vapor del lado caliente (interior).

Consultanos y te armamos el presupuesto completo de aislación para tu techo.`,
    image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&q=80",
    category: "Techos",
    date: "5 Ene 2026",
    readTime: "8 min",
  },
];
