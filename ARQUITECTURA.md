# Arquitectura — cómo está hecha la app y cómo seguirla

Documento para quien continúe el proyecto (persona u otro modelo). Léelo entero antes de tocar nada.

## Reglas que no se rompen

1. **Sin servidor y sin librerías externas.** Solo HTML, CSS y JavaScript del navegador (módulos ES).
2. **Ningún dato del usuario en el repositorio**: ni clientes, ni importes, ni copias. El repositorio es público.
3. **Sin estilos ni scripts en línea.** La política de seguridad (CSP) de `index.html` los bloquea. Todo el CSS va en
   `css/app.css`; para ocultar algo se usa el atributo `hidden`.
4. **El neto siempre por delante del bruto.** La cifra grande de cada pantalla es neto cobrado (solo facturas
   cobradas). Lo pendiente va aparte: neto previsto si está apuntado; si no, «neto por confirmar» con su bruto.
   Una factura sin neto nunca se suma al neto.
5. **Navegación por pestañas abajo**, sin menú lateral ni en el ordenador. Crear factura siempre a un toque (botón
   flotante). Cualquier factura se edita desde donde aparezca: todas las listas usan `filaFactura()`.
6. Ningún porcentaje, cuota o límite fiscal fijo en los cálculos: todos salen de `ajustes.fiscal`, editables en
   *Más → Ajustes de autónomo*. Los valores de partida están en `fiscalPorDefecto()` (`modelo.js`) y nacen como
   «pendiente de confirmar», con enlace a la página oficial (`ENLACES` en `app.js`).
7. Al cambiar cualquier archivo, subir `VERSION` en `sw.js` y `js/app.js`, y añadir los archivos nuevos a la lista
   `ARCHIVOS` de `sw.js`.
8. Antes de entregar: `node pruebas/logica.mjs` y las dos pruebas de navegador (abajo) tienen que pasar.
9. Una regla fiscal no se cambia sin el visto bueno del usuario. Están resumidas en la cabecera de `js/fiscal.js`
   y cada una tiene su prueba con un ejemplo calculado a mano en `pruebas/logica.mjs`.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Cáscara y política de seguridad. |
| `css/app.css` | Todo el estilo (tema oscuro, acento turquesa). |
| `js/cripto.js` | PBKDF2-SHA256 (600.000 iteraciones) → AES-GCM 256. |
| `js/almacen.js` | Clave/valor sobre IndexedDB. |
| `js/boveda.js` | Estado completo cifrado en un bloque; copias automáticas; cambio de contraseña. |
| `js/modelo.js` | Forma de los datos, ajustes de partida, régimen de cada factura y cálculos de facturas (funciones puras). |
| `js/fiscal.js` | Cálculos de autónomo: gastos, trimestres (303 y 130), cuota, hucha, calendario, 347, simulación (funciones puras). |
| `js/migracion.js` | Importa la copia de la app antigua (`app: "mis-facturas"`, versión 2) con informe de control. |
| `js/copias.js` | Archivo de copia cifrado y fusión entre dispositivos. |
| `js/modelos.js` | Las cifras para presentar: casillas de los modelos 303, 130 y 390 y resumen para la renta. Solo ordena y explica lo que calcula `fiscal.js`. |
| `js/csv.js` | Exportación a CSV de facturas y de gastos, y los tres libros registro por año (emitidas, recibidas, bienes de inversión). |
| `js/enlace.js` | Enlace de solo lectura: reduce, comprime y cifra el estado dentro del propio enlace, y lo abre con su código. |
| `js/app.js` | Interfaz: vistas, fichas, diálogos, eventos delegados por `data-accion`. |
| `sw.js`, `manifest.webmanifest`, `iconos/` | Instalación y funcionamiento sin internet. |
| `pruebas/` | `logica.mjs` (Node, sin dependencias), `e2e.mjs` (fase 1) y `e2e-autonomo.mjs` (fases 2 y 3): Playwright + Chrome, dos dispositivos. |

## Datos

Está descrito en la cabecera de `js/modelo.js`. Resumen:

- `estado = { esquema, ajustes, clientes[], facturas[], gastos[], ayudas[] }`. Se cifra entero y se guarda en IndexedDB
  (clave `boveda`). Esquema actual: 4. El 1 no tenía `ajustes.fiscal` ni `gastos`; el 2 no tenía amortización,
  gastos de difícil justificación ni minoración; el 3 no tenía `ayudas`. `completar()` añade lo que falte con los valores de partida. Una app
  con un esquema menor rechaza importar una copia con uno mayor («actualiza la app»).
- Factura: `id, n, ref, clienteId, estado ('abierta'|'pendiente'|'cobrada'), fechaFactura, fechaCobro, neto, diasSS,
  nota, servicios[{evento, mod, fecha, dias, importe}]`. `antiguo` guarda campos de la app vieja que no se usan
  (`total`, `ajuste`). `fechaEstimada: true` = la fecha de factura la puso la migración (último servicio).
- Bruto = suma de importes de los servicios (nunca se guarda). El neto lo apunta el usuario al cobrar.
- Año de una factura = el de `fechaFactura` (o del último servicio si falta). No el de cobro.
- Cliente: `plazo` = `null`, `{tipo:'dias', dias}` o `{tipo:'mes', desde, hasta}` (días del mes siguiente a la factura).
- **Régimen de una factura** (`esAutonomo()`): autónomo si hay `ajustes.fechaAlta` y su fecha de factura es igual o
  posterior; si no, cooperativa. No se guarda: se deduce siempre de las fechas, así que cambiar la fecha de alta
  cambia de régimen las facturas afectadas sin tocar sus datos.
- Factura de autónomo: el importe de cada servicio es la base sin IVA. Guarda `ivaPct` y `retPct` (los porcentajes
  con los que se hizo; si faltan se usan los de ajustes). `desglose()` da IVA, retención, total a cobrar y neto.
  Su `neto` guardado no se usa y no lleva días cotizados. `netoDe()` y `totales(facturas, ajustes)` ya lo distinguen.
- Gasto: `id, fecha, proveedor, numFactura, categoria, base, ivaPct, iva, dedIva, dedIrpf, justificante, nota`.
  Si es material que se amortiza lleva además `amortiza: true` y `amortPct` (% al año): no cuenta como gasto de golpe,
  sino `valor × % × días en uso / días del año` cada año hasta agotar el valor (`amortizadoEnAnio()`). Su IVA se
  deduce entero en el trimestre de la compra.
- Ayuda: `id, fecha, concepto, importe, cuentaSS` (subvención puntual de la actividad; ver «Fase 3, parte B»).
- `ajustes.fiscal`: epígrafe, régimen de IVA, porcentajes, tramos de cuota (`cuotas[{desde:'AAAA-MM', importe}]`),
  categorías de gasto, `confirmados{}` (valores que el usuario ya ha comprobado) y `presentados{}` (modelos
  presentados, con id `AAAA-303-1`, `AAAA-130-1`, `AAAA-390`, `AAAA-347`, `AAAA-renta`).
- Todo registro lleva `_mod` y `_base`; los borrados quedan como `{ id, _borrado: true }`. Los ajustes son un único
  registro: al cambiarlos se llama a `guardarAjustes()` (`app.js`), que hace `M.tocar(ajustes)`.
- Datos solo de este dispositivo (fecha de la última copia) van sin cifrar en la clave `local` y no viajan.

### Añadir algo nuevo a los datos (por ejemplo, gastos)

1. Añádelo a `estadoVacio()`; `completar()` lo rellena en estados antiguos. Si cambia la forma de algo existente,
   sube `ESQUEMA` y añade la conversión en `completar()`.
2. Si es una lista de registros, añádela a `COLECCIONES` en `copias.js` para que entre en la fusión, y dale
   etiqueta y diferencias en `etiquetaItem()` (`app.js`) y `diferencias()` (`copias.js`).
3. Cada cambio de un registro llama a `M.tocar(registro)` y luego a `persistir()`.

## Fusión entre dispositivos (`copias.js`)

No hay servidor: el usuario exporta un archivo cifrado en un dispositivo y lo importa en el otro.
`_mod` = última modificación; `_base` = el `_mod` de la última versión compartida. Con L (aquí) y F (archivo):

- `L._mod === F._mod` → igual.
- `F._base === L._mod` → el archivo parte de mi versión: gana el archivo.
- `L._base === F._mod` → yo parto de la versión del archivo: gana lo mío.
- Un lado sin tocar desde que se compartió (`_mod === _base`) → gana el más reciente, sin conflicto. (Añadido en la
  1.1.0: sin esto, un registro creado en la app, importado en el otro dispositivo y editado después solo en el
  primero aparecía como conflicto.)
- Otro caso → conflicto: decide el usuario. Al quedarse con lo suyo, su registro pasa a ser «posterior al del archivo»
  para que la elección viaje al otro dispositivo en la siguiente copia.

Antes de aplicar se guarda una copia automática cifrada (`inst:<fecha>`, se conservan 5) para poder deshacer.

## Decisiones tomadas con el usuario

- Bloqueo con código, siempre al abrir. Mínimo 4 dígitos por decisión del usuario, que sabe que una copia con
  código corto se puede forzar; el teclado numérico es el de por defecto y se puede pasar a letras. Sin Face ID.
  Sin recuperación. Sin bloqueo automático en segundo plano.
- Justificantes de gastos: sin fotos; solo el apunte y una casilla «justificante guardado».
- Días cotizados: solo mientras factura por cooperativa. Filtro por año: siempre.
- Copia de la app antigua: se deja el hueco de numeración; fecha de factura ausente = último servicio; un neto mayor
  que el importe se descarta y se avisa; los plazos se enganchan por nombre parecido y el que no encaja se pregunta.
- Comparación con el año anterior: sobre lo facturado (bruto) de facturas cobradas o pendientes de cobro (las sin
  cerrar no cuentan), en pequeño, porque lo pendiente no tiene neto.
- Plazo `mes` (un cliente lo usa): se cobra entre dos días del mes siguiente a la fecha de factura.
- Avisos de plazos: al abrir la app (banda en Inicio) más un archivo de calendario `.ics` sin importes; sin servidor
  no hay notificaciones.

Fase 2 (12 de noviembre de 2026):

- Neto de autónomo = base − IRPF (la retención de la factura o, si no lleva, el % del pago trimestral como
  estimación). La cuota se resta del total del año en Inicio, Resumen e Impuestos, no de cada factura.
- Modelo 130: % del beneficio acumulado − retenciones − pagos anteriores. No se presenta (profesional o artística)
  si el 70 % de los ingresos del año anterior llevó retención; sin año anterior, cuenta el propio periodo.
- La cuota de autónomos cuenta sola como gasto del IRPF; no se apunta como gasto.
- Gasto para el IRPF = (base + IVA no deducible) × % deducible. Categoría «Gasolina y vehículo»: IVA 50 %, IRPF 0 %
  (elegido por el usuario: criterio prudente con vehículo de uso mixto).
- Epígrafe de partida: profesional con retención del 7 %. El usuario aún no lo ha decidido.
- Cuentan las facturas emitidas (pendientes o cobradas) por fecha de factura; las sin cerrar no.
- Hucha: IVA y 130 de trimestres empezados y no presentados + reserva para la renta (un % del beneficio que decide
  el usuario, menos retenciones y pagos del 130). Marcar un modelo como presentado lo saca de la hucha y de los avisos.
- Al cobrar una factura de autónomo no se pide el neto: se enseña el total que tiene que haber entrado.
- Los años anteriores al del alta (o todos, sin fecha) se ven en simulación; no cambia ningún dato real.

Fase 3, parte A (13 de noviembre de 2026):

- Para la renta la app da las cifras para copiar en Renta Web, por conceptos y sin números de casilla (cambian cada
  año). No estima el impuesto: eso lo hace Renta Web. La reserva de la hucha sigue siendo el % del usuario.
- Gastos de difícil justificación: % del beneficio antes de ellos, con tope anual. Van dentro de los gastos (casilla
  02 del 130) y bajan el beneficio. Con el % a 0 no se aplican.
- Modelo 130 casilla a casilla (`t.c130`): la 05 suma las casillas 07 positivas anteriores (no lo pagado); la 13 es la
  minoración según el beneficio del año anterior (sin año anterior cuenta como 0); la 15 descuenta los resultados
  negativos de trimestres anteriores. Lo que se paga es la casilla 19 si es positiva.
- Modelo 303: IVA devengado por tipo; gastos en «corrientes» (28-29) o «bienes de inversión» (30-31) si se amortizan
  y su base llega al importe de `umbralInversionIva`. El saldo a favor se arrastra dentro del año (110/78/87); se
  supone que en el 4T se pide la devolución, así que el año siguiente empieza sin arrastre.
- Los números de casilla están solo en `js/modelos.js`. En pantalla se avisa de que manda el nombre, no el número.
- La reducción por inicio de actividad está desactivada de partida y solo sale en el resumen de la renta.

Fase 3, parte B (15 de noviembre de 2026; plan completo en la sección 14 del documento del proyecto):

- Tarifa plana (1.2.1, `tarifaPlana()` y `ritmoSS()` en `fiscal.js`): dura los meses naturales completos siguientes al
  alta (con alta el día 1, ese mes ya cuenta). La prórroga se pide antes de que acabe el primer periodo y exige que el
  beneficio de cada año natural que toca quede por debajo del salario mínimo (`smiAnual`). El usuario marca «He pedido
  la prórroga» (`prorrogaPedida`). La app NO cambia la cuota sola: los tramos los pone el usuario y la app avisa si
  falta el del primer mes sin tarifa plana.
- Beneficio para la Seguridad Social (`beneficioSS()`) = beneficio fiscal + cuota pagada, menos `genericosSSPct` (7 %).
  Es el que se compara con el salario mínimo y, en el punto 4, con los tramos de cuota. «A este ritmo» = lo que llevas
  × días de actividad del año / días transcurridos.

- Cuota sin tarifa plana (1.2.2, `cuotaEstimada()`, `tramoDe()`, `cuotaDeTramo()`): beneficio al mes = beneficio para la
  Seguridad Social del año (a este ritmo) / días de actividad × 30. La tabla `tramosCuota` (`hasta` al mes, `null` = sin
  límite; `base` mínima) y `tipoCotizacionPct` son las de 2026, editables. Cuota = base mínima × tipo. `limiteCuota`
  (300 € de partida, decisión del usuario): la app dice cuánto gasto deducible falta en el año para no pasarlo; cada
  euro de gasto baja el beneficio (1 − genéricos) × (1 − difícil justificación, salvo que ya esté en su tope). Es solo
  una estimación: NO cambia la cuota que la app resta, que sigue saliendo de `cuotas`.

- Ayuda puntual (1.2.3, `estado.ayudas`, Más → Ayudas y subvenciones): es ingreso de la actividad en el trimestre de su
  fecha. Entra en el beneficio, en la casilla 01 del 130, en la reserva de la hucha y en el resumen de la renta
  («Subvenciones corrientes»). No lleva IVA ni retención, no es «facturado» (`a.base` sigue siendo solo facturas; las
  ayudas van en `a.ayudas`) y no cambia el neto. Cuenta como ingreso sin retención para la regla del 70 % (criterio
  prudente: una ayuda grande obliga a presentar el 130). `cuentaSS` (activado de partida): si está apagado, la ayuda no
  entra en el beneficio para la Seguridad Social (`anioFiscal(..., { ayudas: 'ss' })`). En `ritmoSS()` la ayuda se suma
  una sola vez: «a este ritmo» solo alarga el beneficio sin ayudas. DUDA ABIERTA: no hay criterio oficial publicado
  sobre la ayuda de Garantía Juvenil; el usuario tiene que confirmarlo si se la conceden.
- Libros registro (1.2.4, `libroEmitidas()`, `libroRecibidas()`, `libroBienes()` en `csv.js`; Más → Copias de seguridad):
  un CSV por libro y año, solo con actividad de autónomo. Emitidas: una fila por factura emitida (las ayudas al final,
  marcadas como «no es factura»). No son el formato electrónico oficial; la columna de NIF va vacía (la app no lo guarda).
- Gráficos (1.3.0, `mesesDelAnio()` en `fiscal.js`, `impGraficos()` y `graficoMeses()` en `app.js`; Impuestos → Gráficos):
  por mes y por fecha de factura, neto = base − IRPF − cuota, impuestos = IVA + IRPF + cuota (neto + impuestos = lo
  cobrado con IVA) y gastos = lo pagado. Los gastos no se restan del neto y las ayudas no entran. El SVG se hace a mano,
  sin librerías ni estilos en línea; los tres tonos (`.g-neto`, `.g-gastos`, `.g-impuestos` en `app.css`) están
  comprobados sobre el fondo oscuro para daltonismo y contraste: no los cambies sin volver a comprobarlos. Tocar un mes
  (o su fila en la tabla) elige `S.mes` y enseña su detalle y sus facturas, editables desde ahí.
- Actualización (1.3.1): `sw.js` pide los archivos con `cache: 'reload'` al instalarse; antes podía guardar archivos
  viejos de la caché del navegador y dejar una mezcla de versiones. Si llega una versión nueva con la app abierta, se
  recarga sola en la pantalla del código o avisa si ya está desbloqueada. `index.html`, el manifest y los iconos no
  cambian de una versión a otra: es normal que en GitHub conserven su fecha antigua.
- Vista de PC (1.4.0): el usuario usa la app sobre todo en el PC; el móvil es para consultar o apuntar algo urgente.
  Desde 1000 px de ancho el contenido va en columnas (`.cols` > `.col`, al final de `app.css`) para que cada pantalla
  quepa sin bajar; por debajo, `.cols` y `.col` son `display: contents` y el móvil queda exactamente igual. Las pestañas
  siguen abajo (decisión del usuario). Una pantalla nueva debe envolver sus bloques en `.cols`/`.col`.
- Enlace de solo lectura (1.5.0, `enlace.js`; Más → Compartir en solo lectura): para enseñar la app a otra persona sin
  pasarle una copia. Los datos van dentro del enlace, tras «#» (no viajan al servidor), reducidos, comprimidos y cifrados
  con un código que el usuario dice aparte. Quien lo abre ve la app en memoria con `S.lectura` puesto. TRES BARRERAS que
  no se pueden quitar: `persistir()` no escribe; solo se atienden las acciones de `LECTURA_OK`; los eventos `input`,
  `change` y `submit` se ignoran. La bóveda del dispositivo ni se abre ni se crea. Una acción nueva que solo enseñe
  datos hay que añadirla a `LECTURA_OK`; una que cambie algo, NUNCA. Un campo nuevo en los datos hay que añadirlo a
  `reducir()` y `ampliar()`. El usuario sabe que quien tenga enlace y código lo ve todo y que un enlace enviado no se
  puede anular. No se puede acortar más sin un servidor (unos 4.500 caracteres con todo; 2.500 con un solo año).
- `leerNumero()` (1.2.3): «1.000» escrito sin coma se lee como mil (antes, como uno). «1.5» sigue siendo 1,5.

## Lo que falta

**Fases 1 y 2 y fase 3 parte A: hechas** (desde la versión 1.2.0). La parte A: casillas de los modelos 303, 130 y 390 con
explicación, resumen para la renta, material que se amortiza, gastos de difícil justificación, minoración del 130 y
reducción por inicio de actividad.

**Fase 3, parte B: hecha** (versión 1.5.0, con la vista de PC y el enlace de solo lectura): tarifa plana (1.2.1), cuota según el beneficio (1.2.2), ayuda puntual
(1.2.3), libros registro (1.2.4) y gráficos (1.3.0). El comparador cooperativa / autónomo NO se hace (decisión del usuario).

Pendiente: probar la vista de PC en la pantalla real del usuario y ajustar lo que pida; confirmar
la tabla de tramos y el salario mínimo de cada año; resolver la duda de la ayuda de Garantía Juvenil si se la conceden.

Limitaciones conocidas: no hay prorrata de IVA, recargo de equivalencia ni operaciones con el extranjero; el material
comprado antes del alta no se amortiza; la cuota del mes del alta cuenta entera.

Pendiente de la fase 1: probar en un iPhone real y decidir si las copias llevan una contraseña larga aparte.

## Pruebas

```
node pruebas/logica.mjs                         # lógica, con datos inventados
node pruebas/logica.mjs ruta/a/copia-antigua.json   # además comprueba las cifras de una copia real

python3 -m http.server 8765                     # en la carpeta de la app
PLAYWRIGHT=/ruta/playwright/index.mjs CHROME=/usr/bin/google-chrome \
  node pruebas/e2e.mjs http://127.0.0.1:8765/ ruta/a/copia-antigua.json /tmp/salida
PLAYWRIGHT=/ruta/playwright/index.mjs CHROME=/usr/bin/google-chrome \
  node pruebas/e2e-autonomo.mjs http://127.0.0.1:8765/ ruta/a/copia-antigua.json /tmp/salida2
```

`e2e-autonomo.mjs` no lleva cifras escritas: las calcula con `modelo.js` y `fiscal.js` y las compara con la pantalla.
Recorre simulación, tarifa plana, cuota, ayuda, libros, gráficos, enlace de solo lectura, gasto, fecha de alta, impuestos reales, hucha, presentar, calendario, factura de autónomo, cobro,
las casillas de los modelos una a una, material que se amortiza, copia entre dos dispositivos y vuelta a cooperativa. Las carpetas de salida contienen copias con datos: bórralas.

La prueba de navegador simula un móvil y un PC: crea contraseñas, importa, crea/edita/cobra/borra, exporta e importa
copias en los dos sentidos con un conflicto, deshace, cambia la contraseña y abre sin internet. No se ha probado en un
iPhone real: lo primero que hay que revisar ahí es el selector de fecha, el de mes (tramos de cuota), *Compartir* al
exportar (copia, CSV y calendario) y la lista de modalidades.
