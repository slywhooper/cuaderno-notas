# Mis servicios y facturas

App personal para llevar servicios, facturas y cobros. Funciona sin internet, se instala en el móvil y en el
ordenador como app web (PWA) y guarda los datos **cifrados y solo en el dispositivo**: sin nube, sin cuenta y sin
servidor. Este repositorio contiene únicamente el código; no hay ningún dato dentro.

Versión 1.2.0 — facturas, clientes, cobros, copias cifradas, días cotizados, filtro por año y CSV; la parte de
autónomo (fecha de alta, IVA, IRPF, gastos, cuota, hucha de impuestos, calendario y simulación); y las cifras para
presentar: casillas de los modelos 303, 130 y 390 y resumen para la renta.

## Instalarla

1. **Súbela a GitHub Pages.** Crea un repositorio nuevo (aparte del de la app anterior), sube todo el contenido de
   esta carpeta y activa Pages en *Settings → Pages* eligiendo la rama `main` y la carpeta raíz. GitHub te dará una
   dirección del tipo `https://tu-usuario.github.io/nombre-del-repo/`.
2. **iPhone:** abre esa dirección en Safari → botón Compartir → *Añadir a pantalla de inicio*. Ábrela siempre desde
   ese icono. Necesita iOS 15.4 o posterior.
3. **PC (Windows):** abre la dirección en Chrome o Edge → icono de instalar en la barra de direcciones
   (o menú → *Instalar esta aplicación*).
4. La primera vez que la abras con internet se guarda entera en el dispositivo. A partir de ahí funciona sin conexión.

## Primera vez

1. Crea tu código (mínimo 4 dígitos; también admite letras). **Si lo olvidas no hay forma de recuperar los datos.**
2. *Importar copia* → elige la copia de la app anterior (`copia-facturas-….json`). Antes de aplicar verás qué entra;
   después, una tabla que compara las cifras del archivo con las de la app.
3. Haz esto **dentro de la app instalada** (el icono), no en una pestaña de Safari: en el iPhone son almacenes distintos.

## Autónomo

- **Mientras no pongas fecha de alta** todo sigue como cooperativa. La pestaña *Impuestos* enseña una simulación:
  tus facturas reales como si hubieras sido autónomo. No cambia ningún dato.
- **Al darte de alta:** *Más → Ajustes de autónomo → Fecha de alta*. Las facturas con fecha de factura desde ese día
  son de autónomo: el importe de cada servicio es la base sin IVA y la app calcula IVA, retención, lo que te entra en
  el banco y el neto. Las anteriores siguen siendo de cooperativa.
- **Comprueba los valores** (IVA, retención, modelo 130, cuota…) en la página oficial enlazada y marca «Lo he
  comprobado». Vienen puestos de partida, no confirmados.
- **Gastos:** apúntalos en la pestaña *Gastos*. La cuota de autónomos se cuenta sola: ponla en *Ajustes de autónomo*.
- **Impuestos:** resumen del año con la hucha (lo que tienes que tener apartado), cada trimestre con su IVA y su
  IRPF, y los plazos. Marca cada modelo como presentado cuando lo presentes.
- **Para presentar:** *Impuestos → Modelos* da la cifra de cada casilla del 303, el 130 y el 390, y las cifras para
  la renta. Toca una casilla para ver de dónde sale. Si un número de casilla no coincide con el que ves en la Sede
  electrónica, guíate por el nombre.
- **Material caro** (cámara, ordenador…): al apuntar el gasto marca «Se amortiza». Su IVA se deduce al comprarlo y
  al IRPF entra poco a poco, cada año.

La app es una ayuda para llevar tus cuentas, no una asesoría: lo que presentas a Hacienda es responsabilidad tuya.

## Copia de seguridad

*Más → Copias de seguridad → Exportar copia cifrada.* En el iPhone se abre *Compartir*: elige *Guardar en Archivos*
(o envíatela). En el PC se descarga. El archivo va cifrado con la contraseña que tenga la app en ese momento.
La app avisa cuando llevas varios días sin exportar.

## Pasar los datos entre el móvil y el PC

Exporta la copia en un dispositivo e impórtala en el otro. Te pedirá la contraseña del dispositivo que la creó.
La importación no pisa nada sin enseñártelo: lista lo nuevo, lo actualizado y los **conflictos** (algo cambiado en los
dos sitios), y eliges. Antes de aplicar guarda una copia automática; *Deshacer la última importación* vuelve atrás.

## Qué pasa con los datos si…

- **Borras la app de la pantalla de inicio:** sus datos se borran con ella. Recupéralos importando tu última copia.
- **Cambias de móvil:** los datos no viajan solos. Exporta la copia en el viejo e impórtala en el nuevo.
- **Borras los datos de sitios web en los ajustes de Safari:** cuenta con que también pueden borrarse los de la app.
- **No abres la app en mucho tiempo:** Safari limpia los datos de webs que no se usan, pero las apps añadidas a la
  pantalla de inicio quedan fuera de esa limpieza, y la app pide además almacenamiento persistente.
- **Olvidas la contraseña:** no se puede recuperar. Solo sirve una copia cuya contraseña recuerdes.

La única protección real contra todo lo anterior es **exportar la copia con frecuencia y guardarla fuera del móvil**.

## Privacidad

- Los datos se cifran con AES-GCM de 256 bits; la clave sale de tu código (PBKDF2, 600.000 iteraciones).
- Un código de 4 dígitos protege de quien coja el móvil, pero quien consiga un archivo de copia puede probar los
  10.000 códigos posibles con un ordenador. Guarda las copias solo en sitios de confianza, o usa un código más largo.
- La app no puede conectarse a ningún sitio que no sea su propia dirección (política de seguridad en `index.html`).
- **No subas nunca a este repositorio una copia de seguridad ni un CSV.** El CSV no va cifrado.
- El archivo de calendario (`.ics`) no lleva importes ni nombres, por si tu calendario se guarda en la nube.
- Activa la verificación en dos pasos en GitHub: quien entre en tu cuenta podría cambiar el código que carga la app.

## Actualizar la app

Al cambiar cualquier archivo, sube el número `VERSION` en `sw.js` y en `js/app.js`. Si no, los dispositivos seguirán
usando la versión guardada. Después de subirlo, abre la app con internet y vuelve a abrirla.

Para continuar el desarrollo, lee `ARQUITECTURA.md`.
