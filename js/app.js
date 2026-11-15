// app.js — Interfaz. Pinta las pantallas a partir del estado y reacciona a los toques.
// Toda la lógica de datos está en modelo.js, copias.js, migracion.js y boveda.js; aquí solo hay pantalla.
//
// Cómo está organizado:
//   S            estado de la interfaz (datos descifrados, pestaña, año, filtros, hoja abierta)
//   render()     repinta la pestaña actual
//   VISTAS       una función por pestaña que devuelve { titulo, html }
//   ACCIONES     una función por cada data-accion="..." del HTML
//   hojas        fichas que suben desde abajo (factura, cliente, gasto, importación)
// Las pantallas de autónomo (Gastos, Impuestos, Ajustes de autónomo) solo pintan: los números salen de fiscal.js.

import * as B from './boveda.js';
import * as M from './modelo.js';
import * as C from './copias.js';
import { migrarCopiaV2, esCopiaAntigua } from './migracion.js';
import * as F from './fiscal.js';
import * as MO from './modelos.js';
import { aCSV, gastosCSV } from './csv.js';

const VERSION = '1.2.2'; // cambiar también en sw.js
const MIN_CLAVE = 4; // decisión del usuario: código corto tipo PIN (él sabe que una copia así se puede forzar)

const S = {
  estado: null,                               // datos descifrados (null = bloqueada)
  local: {},                                  // datos de este dispositivo (última copia)
  vista: 'inicio', sub: null,                 // pestaña y subpantalla de "Más"
  anio: String(new Date().getFullYear()),     // año elegido o 'todo'
  f: { q: '', cliente: '', estado: '' },      // filtros de la lista de facturas
  imp: 'resumen', trim: 0, modelo: '303',     // apartado de Impuestos, trimestre elegido (0 = el actual) y modelo
  hoja: null,                                 // ficha abierta: { tipo, datos, ... }
  instantaneas: [],
};

// ---------- utilidades ----------
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtEur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const eur = (n) => (n == null ? '—' : fmtEur.format(n));
const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: '2-digit' });
const fechaCorta = (iso) => { if (!iso) return '—'; const [a, m, d] = iso.split('-').map(Number); return fmtFecha.format(new Date(a, m - 1, d)); };
const rango = (p) => (p.desde === p.hasta ? fechaCorta(p.hasta) : `${Number(p.desde.slice(8))}–${fechaCorta(p.hasta)}`);
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, uno, varios = uno + 's') => `${n} ${n === 1 ? uno : varios}`;
const numEntrada = (n) => (n == null ? '' : String(n).replace('.', ','));
function leerNumero(txt) {
  let s = String(txt ?? '').trim().replace(/\s|€/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const facturas = () => M.vivos(S.estado.facturas);
const clientes = () => M.vivos(S.estado.clientes).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
const mapaClientes = () => new Map(S.estado.clientes.map((c) => [c.id, c]));
const nombreCliente = (id) => mapaClientes().get(id)?.nombre || 'Sin cliente';
const persistir = () => B.guardarEstado(S.estado);
const fiscal = () => S.estado.ajustes.fiscal;
const gastos = () => M.vivos(S.estado.gastos);
const redondo = (n) => Math.round(n * 100) / 100;
const diasHasta = (iso) => Math.round((new Date(iso + 'T12:00:00') - new Date(M.hoyISO() + 'T12:00:00')) / 864e5);
const cuando = (iso) => { const d = diasHasta(iso); return d < 0 ? `venció hace ${plural(-d, 'día')}` : d === 0 ? 'vence hoy' : `faltan ${plural(d, 'día')}`; };
const mesLargo = (ym) => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1));
const kv = (et, valor, clase = '') => `<div class="kv ${clase}"><span>${et}</span><span class="num">${typeof valor === 'number' ? eur(valor === 0 ? 0 : valor) : valor}</span></div>`;
/** Guarda un cambio de ajustes (marca los ajustes como modificados para que viajen en la copia). */
function guardarAjustes(repintar = false) {
  M.tocar(S.estado.ajustes);
  return persistir().then(() => { if (repintar) render(); aviso('Guardado'); }).catch(fallo);
}

// Páginas oficiales donde comprobar cada valor (los valores están en ajustes; aquí solo los enlaces).
const ENLACES = {
  iva: 'https://sede.agenciatributaria.gob.es/Sede/iva/calculo-iva-repercutido-clientes/tipos-impositivos-iva.html',
  retenciones: 'https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/folleto-actividades-economicas/7-otras-obligaciones-fiscales-retenciones.html',
  modelos: 'https://sede.agenciatributaria.gob.es/Sede/presentacion-declaraciones-calendario-contribuyente.html',
  calendario: 'https://sede.agenciatributaria.gob.es/Sede/calendario-contribuyente.html',
  cuota: 'https://portal.seg-social.gob.es/wps/portal/importass/importass/Colectivos/Trabajo+Autonomo/guia',
  m303: 'https://sede.agenciatributaria.gob.es/Sede/todas-gestiones/impuestos-tasas/iva/modelo-303-iva-autoliquidacion_/instrucciones-2026/instrucciones-02-12-2t-4t-2026.html',
  m130: 'https://sede.agenciatributaria.gob.es/Sede/impuestos-tasas/impuesto-sobre-renta-personas-fisicas/modelo-130-irpf______esionales-estimacion-directa-fraccionado_/instrucciones.html',
  m390: 'https://sede.agenciatributaria.gob.es/static_files/Sede/Procedimiento_ayuda/G412/Instrucciones_modelo_390-2025.pdf',
  simplificada: 'https://sede.agenciatributaria.gob.es/Sede/irpf/empresarios-individuales-profesionales/regimenes-determinar-rendimiento-actividad/estimacion-directa-simplificada.html',
  amortizacion: 'https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/folleto-actividades-economicas/3-impuesto-sobre-renta-personas-fisicas/3_5-estimacion-directa-simplificada/3_5_4-tabla-amortizacion-simplificada.html',
  tarifa: 'https://www.seg-social.es/descarga/es/142496',
  smi: 'https://boe.es/buscar/pdf/2026/BOE-A-2026-3815-consolidado.pdf',
  reduccion: 'https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c07-rendimientos-actividades-economicas-estimacion-directa/fase-3-determinacion-rendimiento-neto-total/reduccion-rendimiento-neto-inicio-actividad-economica.html',
};
const enlace = (k, texto = 'Página oficial') => `<a class="oficial" href="${ENLACES[k]}" target="_blank" rel="noopener noreferrer">${texto} ↗</a>`;
// Valores oficiales editables: [clave en ajustes.fiscal, etiqueta, unidad, enlace]
const PARAMETROS = [
  ['ivaPct', 'IVA de mis facturas', '%', 'iva'],
  ['retencionPct', 'Retención de IRPF en factura', '%', 'retenciones'],
  ['pagoFraccionadoPct', 'Modelo 130: parte del beneficio', '%', 'm130'],
  ['umbralRetenidoPct', 'Sin modelo 130 si lleva retención al menos el', '%', 'm130'],
  ['difJustPct', 'Gastos de difícil justificación: parte del beneficio', '%', 'simplificada'],
  ['difJustMax', 'Gastos de difícil justificación: tope al año', '€', 'simplificada'],
  ['umbralInversionIva', 'IVA: un bien es «de inversión» desde', '€', 'm303'],
  ['amortizacionLibreMax', 'Material: puede ir como gasto normal hasta (por unidad)', '€', 'amortizacion'],
  ['umbral347', 'Modelo 347: importe anual por cliente', '€', 'modelos'],
  ['tarifaPlanaMeses', 'Tarifa plana: meses completos tras el alta', 'meses', 'tarifa'],
  ['prorrogaMeses', 'Tarifa plana: meses de prórroga', 'meses', 'tarifa'],
  ['smiAnual', 'Salario mínimo al año (límite para la prórroga)', '€', 'smi'],
  ['genericosSSPct', 'Seguridad Social: descuento por gastos genéricos', '%', 'cuota'],
  ['diaTrimestre', 'Último día en abril, julio y octubre', 'día', 'calendario'],
  ['diaEnero', 'Último día en enero (4T y resumen anual)', 'día', 'calendario'],
];
// Valores que son decisión mía, no oficiales.
const PROPIOS = [
  ['reservaRentaPct', 'Reserva para la renta: parte del beneficio', '%'],
  ['subidaSimPct', 'Simulación: subida de mi tarifa', '%'],
  ['avisoPlazoDias', 'Avisarme de un plazo con esta antelación', 'días'],
  ['avisoTarifaDias', 'Avisarme de que acaba la tarifa plana con esta antelación', 'días'],
  ['limiteCuota', 'Cuota al mes que no quiero pasar (sin tarifa plana)', '€'],
];

function aviso(texto) {
  const a = $('#aviso');
  a.textContent = texto; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => { a.hidden = true; }, 3200);
}

/** Diálogo centrado. Devuelve { valor, datos } con el botón pulsado y los campos con name. */
function dialogo({ titulo, cuerpo = '', botones }) {
  return new Promise((resolver) => {
    const capa = document.createElement('div');
    capa.className = 'dlg-capa';
    capa.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><h2>${esc(titulo)}</h2><div class="dlg-c">${cuerpo}</div>
      <div class="dlg-b">${botones.map((b, i) => `<button type="button" class="btn ${b.clase || ''}" data-i="${i}">${esc(b.texto)}</button>`).join('')}</div></div>`;
    const cerrar = (i) => {
      const datos = Object.fromEntries([...capa.querySelectorAll('[name]')].map((el) => [el.name, el.value]));
      capa.remove(); resolver({ valor: botones[i].valor, datos });
    };
    capa.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) cerrar(Number(b.dataset.i)); });
    capa.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); cerrar(botones.length - 1); } });
    document.body.append(capa);
    (capa.querySelector('input,select') || capa.querySelector('button:last-child')).focus();
  });
}
const alerta = (titulo, texto) => dialogo({ titulo, cuerpo: `<p>${esc(texto)}</p>`, botones: [{ texto: 'Entendido', valor: true }] });
const confirmar = async (titulo, texto, ok = 'Aceptar', clase = '') =>
  (await dialogo({ titulo, cuerpo: `<p>${esc(texto)}</p>`, botones: [{ texto: 'Cancelar', valor: false, clase: 'sec' }, { texto: ok, valor: true, clase }] })).valor;

/** Entrega un archivo: en el móvil abre "Compartir" (Guardar en Archivos); en el ordenador lo descarga. */
async function entregarArchivo(nombre, contenido, tipo) {
  const archivo = new File([contenido], nombre, { type: tipo });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo] }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(archivo); a.download = nombre;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
  return true;
}

// ---------- puerta: crear contraseña / desbloquear ----------
/** Campo de código. Por defecto con teclado numérico; el botón "teclado" lo cambia a letras. */
const campoClave = (nombre, etiqueta, auto, numerico = true) =>
  `<label>${etiqueta}<input type="password" name="${nombre}" autocomplete="${auto}" data-clave ${numerico ? 'inputmode="numeric" pattern="[0-9]*"' : ''}></label>`;
const botonTeclado = (numerico = true) =>
  `<button type="button" class="enlace teclado" data-accion="teclado">${numerico ? 'Usar letras en vez de números' : 'Usar solo números'}</button>`;

function pantallaCrear(error = '', numerico = true) {
  $('#app').innerHTML = `<form class="puerta" data-form="crear" novalidate>
    <div class="logo" aria-hidden="true"></div><h1>Mis servicios y facturas</h1>
    <p>Crea el código que protegerá tus datos. Se guardan cifrados solo en este dispositivo.</p>
    ${campoClave('pw', `Código (mínimo ${MIN_CLAVE} dígitos)`, 'new-password', numerico)}
    ${campoClave('pw2', 'Repite el código', 'new-password', numerico)}
    ${botonTeclado(numerico)}
    <p class="ojo">Si olvidas el código no hay forma de recuperar los datos. Un código corto protege de quien coja tu móvil, pero no una copia de seguridad que acabe en otras manos.</p>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <button class="btn" type="submit">Crear y entrar</button></form>`;
}

function pantallaDesbloqueo(error = '') {
  const numerico = B.esPin();
  $('#app').innerHTML = `<form class="puerta" data-form="abrir" novalidate>
    <div class="logo" aria-hidden="true"></div><h1>Mis servicios y facturas</h1>
    ${campoClave('pw', 'Código', 'current-password', numerico)}
    ${botonTeclado(numerico)}
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <button class="btn" type="submit">Desbloquear</button></form>`;
  $('input[name=pw]').focus();
}

async function entrar(estado) {
  S.estado = M.completar(estado); S.local = await B.local(); S.instantaneas = await B.instantaneas();
  S.vista = 'inicio'; S.sub = null;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  render();
}

const FORMULARIOS = {
  async crear(f) {
    const pw = f.pw.value, pw2 = f.pw2.value;
    const numerico = f.pw.hasAttribute('inputmode');
    if (pw.length < MIN_CLAVE) return pantallaCrear(`El código necesita al menos ${MIN_CLAVE} ${numerico ? 'dígitos' : 'caracteres'}.`, numerico);
    if (pw !== pw2) return pantallaCrear('Los dos códigos no coinciden.', numerico);
    const estado = M.estadoVacio();
    await B.crear(pw, estado);
    await entrar(estado);
  },
  async abrir(f) {
    const boton = f.querySelector('button'); boton.disabled = true; boton.textContent = 'Abriendo…';
    try { await entrar(await B.abrir(f.pw.value)); }
    catch { pantallaDesbloqueo('Código incorrecto.'); }
  },
  factura() { return guardarFactura(); },
  cliente() { return guardarCliente(); },
  gasto() { return guardarGasto(); },
};

// ---------- piezas comunes ----------
const ICONOS = {
  inicio: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  facturas: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  gastos: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  impuestos: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M19 5L5 19"/>',
  mas: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
};
const PESTANAS = [['inicio', 'Inicio'], ['facturas', 'Facturas'], ['gastos', 'Gastos'], ['impuestos', 'Impuestos'], ['mas', 'Más']];

function barra() {
  return `<nav class="barra" aria-label="Apartados">${PESTANAS.map(([id, txt]) =>
    `<button data-accion="ir" data-vista="${id}" class="${S.vista === id ? 'activa' : ''}" ${S.vista === id ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[id]}</svg><span>${txt}</span></button>`).join('')}</nav>
    <button class="fab" data-accion="nueva-factura" aria-label="Nueva factura">＋<span>Factura</span></button>`;
}

function chipsAnio(lista = [...M.anios(S.estado), 'todo'], activo = S.anio) {
  return `<div class="chips" role="group" aria-label="Año">${lista.map((a) =>
    `<button data-accion="anio" data-anio="${a}" class="chip ${activo === a ? 'activa' : ''}" aria-pressed="${activo === a}">${a === 'todo' ? 'Todo' : a}</button>`).join('')}</div>`;
}
/** Año para las pantallas fiscales: con «Todo» elegido se usa el año en curso. */
const anioFiscalElegido = () => (S.anio === 'todo' ? String(new Date().getFullYear()) : S.anio);

/** Fila de factura. Se usa en todas las listas: tocarla abre siempre la misma ficha de edición. */
function filaFactura(f, { cobrar = false } = {}) {
  const c = mapaClientes().get(f.clienteId);
  const b = M.bruto(f);
  let cuando, vencida = false;
  if (f.estado === 'cobrada') cuando = `Cobrada · ${fechaCorta(f.fechaCobro || M.fechaDeFactura(f))}`;
  else if (f.estado === 'abierta') cuando = 'Sin cerrar';
  else {
    const p = M.cobroPrevisto(f, c);
    if (!p) cuando = 'Pendiente · cliente sin plazo';
    else { vencida = p.hasta < M.hoyISO(); cuando = `${vencida ? 'Atrasada ·' : 'Se cobra'} ${rango(p)}`; }
  }
  const aut = M.esAutonomo(f, S.estado.ajustes);
  const neto = M.netoDe(f, S.estado.ajustes);       // autónomo: calculado; cooperativa: el apuntado al cobrar
  const etB = aut ? 'base' : 'bruto';              // en autónomo lo facturado es la base sin IVA
  const importe = neto != null
    ? `<div class="imp num">${eur(neto)}</div><div class="sub num">${f.estado === 'cobrada' ? '' : 'previsto · '}${etB} ${eur(b)}</div>`
    : `<div class="imp pc">neto por confirmar</div><div class="sub num">bruto ${eur(b)}</div>`;
  return `<div class="fila e-${f.estado}${vencida ? ' vencida' : ''}" role="button" tabindex="0" data-accion="abrir-factura" data-id="${esc(f.id)}">
    <div class="fila-a"><div class="fila-t">${esc(c?.nombre || 'Sin cliente')} <span class="nfac">#${esc(f.n ?? '')}</span></div>
      <div class="fila-s">${esc(f.ref || '')}</div><div class="fila-c"><i class="punto"></i>${esc(cuando)}</div></div>
    <div class="fila-b">${importe}${cobrar && f.estado === 'pendiente' ? `<button class="btn chico" data-accion="cobrar" data-id="${esc(f.id)}">Cobrar</button>` : ''}</div></div>`;
}

const ordenFecha = (a, b) => (M.fechaDeFactura(b) || '').localeCompare(M.fechaDeFactura(a) || '') || (b.n || 0) - (a.n || 0);

// ---------- vistas ----------
const VISTAS = {
  inicio() {
    const fs = facturas();
    if (!fs.length) {
      return { titulo: 'Inicio', html: `<section class="vacio"><h2>Aún no hay facturas</h2>
        <p>Importa tu copia de seguridad (la de la app anterior también sirve) o crea tu primera factura.</p>
        <button class="btn" data-accion="importar-copia">Importar copia</button>
        <button class="btn sec" data-accion="nueva-factura">Crear factura</button></section>` };
    }
    const delAnio = S.anio === 'todo' ? fs : fs.filter((f) => M.anioDe(f) === S.anio);
    const A = S.estado.ajustes;
    const t = M.totales(delAnio, A);
    const cuota = F.cuotaPagada(S.estado, S.anio);    // como autónomo, la cuota se resta del total, no de cada factura
    const pend = fs.filter((f) => f.estado !== 'cobrada')
      .map((f) => ({ f, p: M.cobroPrevisto(f, mapaClientes().get(f.clienteId)) }))
      .sort((a, b) => (a.p ? a.p.hasta : '9999').localeCompare(b.p ? b.p.hasta : '9999'));
    const tp = M.totales(pend.map((x) => x.f), A);
    const cerca = F.plazosCercanos(S.estado);
    const plazo = cerca.length ? `<button class="banda" data-accion="ir-imp" data-imp="calendario">${esc(cerca[0].titulo)} (${esc(cerca[0].periodo)}): ${cuando(cerca[0].fecha)}${cerca.length > 1 ? ` · y ${cerca.length - 1} más` : ''}</button>` : '';
    const plana = F.tarifaPlana(S.estado);
    const tarifa = plana && plana.avisar ? `<button class="banda" data-accion="ir-imp" data-imp="resumen">${plana.avisar === 'fin'
      ? `La tarifa plana acaba el ${fechaCorta(plana.fin1)} (${cuando(plana.fin1).replace('vence', 'acaba')}). La prórroga se pide antes de ese día`
      : `Tarifa plana: falta apuntar tu cuota desde ${mesLargo(plana.mesNuevo)}`} ›</button>` : '';
    const h = A.fechaAlta ? F.hucha(S.estado) : null;
    const lineaHucha = h && h.total > 0 ? `<button class="comp hucha" data-accion="ir-imp" data-imp="resumen">Hucha de impuestos: ten apartados ${eur(h.total)}</button>` : '';
    const ultimas = fs.filter((f) => f.estado === 'cobrada').sort(ordenFecha).slice(0, 5);

    let comp = '';
    if (S.anio !== 'todo') {
      const k = M.comparativa(S.estado, S.anio);
      if (k.pct != null) comp = `<button class="comp ${k.pct >= 0 ? 'sube' : 'baja'}" data-accion="detalle-comparativa">
        ${k.pct >= 0 ? '▲' : '▼'} ${Math.abs(k.pct).toFixed(0)} % facturado frente a ${k.previo}</button>`;
    }
    const dias = S.local.ultimaCopia ? Math.floor((Date.now() - S.local.ultimaCopia) / 864e5) : null;
    const copia = dias === null || dias >= (S.estado.ajustes.avisoCopiaDias || 7)
      ? `<button class="banda" data-accion="sub" data-sub="copias">${dias === null ? 'Todavía no has hecho ninguna copia de seguridad' : `Llevas ${dias} días sin copia de seguridad`} · Hacer copia</button>` : '';

    return { titulo: 'Inicio', cab: chipsAnio(), html: `${copia}${plazo}${tarifa}
      <section class="heroe">
        <div class="et">Neto cobrado · ${S.anio === 'todo' ? 'todo' : S.anio}</div>
        <div class="grande num">${eur(redondo(t.netoCobrado - cuota))}</div>
        <div class="mini num">${plural(t.nCobradas, 'factura cobrada', 'facturas cobradas')} · facturado (bruto) ${eur(t.bruto)}${cuota ? ` · ya restada la cuota de autónomos (${eur(cuota)})` : ''}</div>
        ${comp}${lineaHucha}
      </section>
      <section class="tarjeta porcobrar">
        <div><div class="et">Por cobrar · neto previsto</div><div class="medio num">${eur(tp.netoPrevisto)}</div>
          <div class="mini">${tp.nPrevistas} con neto ${tp.nAutonomo ? 'apuntado o calculado' : 'apuntado'}</div></div>
        <div><div class="et">Neto por confirmar</div><div class="medio pc num">${tp.nSinNeto} fact.</div>
          <div class="mini num">bruto ${eur(tp.brutoSinNeto)}</div></div>
      </section>
      <h2 class="tit">Próximos cobros</h2>
      <div class="lista">${pend.length ? pend.map((x) => filaFactura(x.f, { cobrar: true })).join('') : '<p class="nada">No tienes nada pendiente de cobro.</p>'}</div>
      <h2 class="tit">Últimas cobradas <button class="enlace" data-accion="ir" data-vista="facturas">Ver todas</button></h2>
      <div class="lista">${ultimas.map((f) => filaFactura(f)).join('')}</div>` };
  },

  facturas() {
    const ops = (lista, sel) => lista.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
    return { titulo: 'Facturas', cab: chipsAnio(), html: `
      <div class="filtros">
        <input type="search" placeholder="Buscar cliente, referencia, evento…" data-filtro="q" value="${esc(S.f.q)}" aria-label="Buscar">
        <select data-filtro="cliente" aria-label="Cliente">${ops([['', 'Cliente: todos'], ...clientes().map((c) => [c.id, c.nombre])], S.f.cliente)}</select>
        <select data-filtro="estado" aria-label="Estado">${ops([['', 'Estado: todos'], ...Object.entries(M.ESTADOS)], S.f.estado)}</select>
      </div><div id="lista-facturas">${listaFacturas()}</div>` };
  },

  gastos() {
    const fi = fiscal(), alta = S.estado.ajustes.fechaAlta;
    const cats = new Map(fi.categorias.map((c) => [c.id, c.nombre]));
    const lista = gastos().filter((g) => S.anio === 'todo' || (g.fecha || '').slice(0, 4) === S.anio).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    let total = 0, ivaDed = 0, irpf = 0;
    const filas = lista.map((g) => {
      const c = F.calculoGasto(g, fi);
      total += M.cent(c.total); ivaDed += M.cent(c.ivaDed); if (!g.amortiza) irpf += M.cent(c.gastoIrpf);
      return `<div class="fila${g.justificante ? '' : ' e-pendiente'}" role="button" tabindex="0" data-accion="abrir-gasto" data-id="${esc(g.id)}">
        <div class="fila-a"><div class="fila-t">${esc(g.proveedor || 'Sin proveedor')}</div><div class="fila-s">${esc(cats.get(g.categoria) || 'Sin categoría')}</div>
          <div class="fila-c"><i class="punto"></i>${fechaCorta(g.fecha)}${g.justificante ? '' : ' · falta el justificante'}</div></div>
        <div class="fila-b"><div class="imp num">${eur(c.total)}</div><div class="sub num">recuperas IVA ${eur(c.ivaDed)}</div><div class="sub num">${g.amortiza ? `se amortiza · ${numEntrada(g.amortPct)} % al año` : `gasto IRPF ${eur(c.gastoIrpf)}`}</div></div></div>`;
    }).join('');
    const a = S.anio === 'todo' ? null : F.anioFiscal(S.estado, S.anio);
    const cuota = a && a.cuota ? `<p class="pie">La cuota de autónomos se cuenta sola: ${plural(a.mesesCuota, 'mes', 'meses')} · ${eur(a.cuota)}${a.modo === 'simulacion' ? ' (simulación)' : ''}. No la apuntes aquí.</p>` : '';
    return { titulo: 'Gastos', cab: chipsAnio(), html: `
      <button class="btn sec ancho arriba" data-accion="nuevo-gasto">＋ Añadir gasto</button>
      <section class="tarjeta tres">
        <div><div class="et">Pagado</div><div class="medio num">${eur(total / 100)}</div><div class="mini">${plural(lista.length, 'gasto')}</div></div>
        <div><div class="et">IVA que recuperas</div><div class="medio num">${eur(ivaDed / 100)}</div></div>
        <div><div class="et">Gasto para el IRPF</div><div class="medio num">${eur(irpf / 100)}</div></div>
      </section>${cuota}${a && a.amortizacion ? `<p class="pie">Amortización del material en ${S.anio}: ${eur(a.amortizacion)}. Se suma al gasto para el IRPF.</p>` : ''}
      ${alta ? '' : '<p class="pie">Aún no has puesto tu fecha de alta: los gastos solo cuentan en la simulación de Impuestos.</p>'}
      <h2 class="tit">Gastos ${S.anio === 'todo' ? '' : S.anio}</h2>
      <div class="lista">${filas || '<p class="nada">No hay gastos apuntados.</p>'}</div>` };
  },

  impuestos() {
    const alta = S.estado.ajustes.fechaAlta, anio = anioFiscalElegido();
    const lista = [...new Set([...M.anios(S.estado), ...(alta ? [alta.slice(0, 4)] : [])])].sort().reverse();
    const a = F.anioFiscal(S.estado, anio), sim = a.modo === 'simulacion', fi = fiscal();
    const tabs = `<div class="chips seg" role="group" aria-label="Apartado">${[['resumen', 'Resumen'], ['trimestres', 'Trimestres'], ['modelos', 'Modelos'], ['calendario', 'Plazos']].map(([id, txt]) =>
      `<button data-accion="imp" data-imp="${id}" class="chip ${S.imp === id ? 'activa' : ''}" aria-pressed="${S.imp === id}">${txt}</button>`).join('')}</div>`;
    const banda = sim ? `<button class="banda sim" data-accion="sub" data-sub="fiscal"><b>Simulación.</b> ${anio} como si hubieras sido autónomo: ${esc(M.EPIGRAFES[fi.epigrafe] || '').toLowerCase()}${a.subidaPct ? `, tarifa +${numEntrada(a.subidaPct)} %` : ''}. Cambiar ›</button>` : '';
    const cuerpo = S.imp === 'trimestres' ? impTrimestres(a) : S.imp === 'modelos' ? impModelos(a) : S.imp === 'calendario' ? impCalendario(a) : impResumen(a);
    return { titulo: 'Impuestos', cab: chipsAnio(lista, anio) + tabs, html: banda + cuerpo };
  },

  mas() {
    if (S.sub && SUBVISTAS[S.sub]) return SUBVISTAS[S.sub]();
    const item = (sub, t, d) => `<button class="fila menu" data-accion="sub" data-sub="${sub}"><div class="fila-a"><div class="fila-t">${t}</div><div class="fila-s">${d}</div></div><div class="flecha" aria-hidden="true">›</div></button>`;
    return { titulo: 'Más', html: `<div class="lista">
      ${item('resumen', 'Resumen por año y días cotizados', 'Neto, facturado y días cotizados de cada año')}
      ${item('clientes', 'Clientes', 'Nombres y plazos de cobro')}
      ${item('fiscal', 'Ajustes de autónomo', 'Fecha de alta, epígrafe, IVA, IRPF, cuota y categorías de gasto')}
      ${item('copias', 'Copias de seguridad', 'Exportar, importar, CSV')}
      ${item('seguridad', 'Código de acceso', 'Cambiar el código, cerrar la app con código')}
      </div><p class="pie">Versión ${VERSION} · Los datos están cifrados y solo en este dispositivo.</p>` };
  },
};

// --- apartados de Impuestos ---
/** Barra «de cada 100 € facturados»: neto, IRPF y cuota. Es un SVG porque la política de seguridad no deja estilos en línea. */
function barraReparto(a) {
  if (!(a.base > 0)) return '';
  const p = (x) => Math.max(0, Math.min(100, x / a.base * 100));
  const irpf = p(a.irpfFacturas), cuota = Math.min(p(a.cuota), 100 - irpf), neto = Math.max(0, 100 - irpf - cuota);
  const n = (x) => x.toFixed(2);
  return `<svg class="reparto" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="Reparto de lo facturado">
      <rect class="r-neto" x="0" y="0" height="4" width="${n(neto)}"/><rect class="r-irpf" x="${n(neto)}" y="0" height="4" width="${n(irpf)}"/><rect class="r-cuota" x="${n(neto + irpf)}" y="0" height="4" width="${n(cuota)}"/></svg>
    <div class="leyenda mini"><span class="l-neto">Neto ${Math.round(neto)} %</span><span class="l-irpf">IRPF ${Math.round(irpf)} %</span><span class="l-cuota">Cuota ${Math.round(cuota)} %</span></div>`;
}

/** Tarjeta «Tarifa plana»: cuándo acaba y si el beneficio del año queda por debajo del salario mínimo (requisito de la prórroga). */
function tarjetaTarifa(a) {
  const fi = fiscal(), sim = a.modo === 'simulacion';
  const linea = (r) => `${kv(`Beneficio para la Seguridad Social · ${r.anio}${r.cerrado || sim ? '' : ' · llevas'}`, r.llevas)}
      ${r.cerrado || r.llevas === r.proyeccion ? '' : kv('A este ritmo acabarías el año en', r.proyeccion)}`;
  const veredicto = (r, texto) => `<p class="veredicto ${r.cumple ? 'ok' : 'amb'}">${r.cumple ? '✓' : '⚠'} ${texto}</p>`;
  const de = '<button class="enlace" data-accion="detalle-ss" data-anio="ANIO">Ver de dónde sale</button>';
  if (sim) {
    const r = F.ritmoSS(S.estado, a.anio);
    return `<section class="tarjeta sep" data-et="tarifa">
      <div class="et">Tarifa plana · requisito del segundo año</div>
      ${linea(r)}${kv('Salario mínimo al año', r.smi)}
      ${veredicto(r, r.cumple ? `Con un año así habrías quedado por debajo del salario mínimo: podrías pedir la prórroga.` : `Con un año así habrías pasado del salario mínimo: sin prórroga.`)}
      ${de.replace('ANIO', a.anio)}</section>`;
  }
  const tp = F.tarifaPlana(S.estado);
  if (!tp) return '';
  const falta = cuando(tp.fin).replace('vence', 'acaba');
  const cab = tp.fase === 'acabada' ? `Acabó el ${fechaCorta(tp.fin)}` : tp.pedida ? `Hasta el ${fechaCorta(tp.fin)}` : `Acaba el ${fechaCorta(tp.fin)}`;
  const sub = tp.fase === 'acabada' ? '' : `<div class="mini">${tp.pedida ? 'con la prórroga · ' : ''}${falta}</div>`;
  const aniosTxt = tp.anios.map((r) => r.anio).join(' y ');
  let cuerpo;
  if (tp.fase === 'acabada') cuerpo = `<p class="pie arriba0">Ya pagas la cuota normal según tu beneficio.</p>`;
  else if (tp.fase === 'primer' && !tp.pedida) {
    const r = tp.actual;
    cuerpo = `<p class="pie arriba0">Para seguir ${numEntrada(fi.prorrogaMeses)} meses más (hasta el ${fechaCorta(tp.fin2)}) tienes que pedir la prórroga <b>antes del ${fechaCorta(tp.fin1)}</b> y prever que tu beneficio de ${aniosTxt} quedará por debajo del salario mínimo.</p>
      ${linea(r)}${kv('Salario mínimo al año', r.smi)}
      ${veredicto(r, r.cumple ? 'A este ritmo quedas por debajo del salario mínimo: podrías pedir la prórroga.' : 'A este ritmo pasas del salario mínimo: la prórroga no te valdría.')}
      ${de.replace('ANIO', r.anio)}`;
  } else {
    cuerpo = `<p class="pie arriba0">El beneficio tiene que quedar por debajo del salario mínimo en cada año: ${aniosTxt}. Si un año lo pasas, la Seguridad Social te reclama la diferencia de cuota de ese año.</p>
      ${tp.anios.map((r) => (r.futuro ? kv(`Beneficio para la Seguridad Social · ${r.anio}`, 'Aún sin datos')
        : `${linea(r)}${veredicto(r, r.cumple ? `${r.anio}: por debajo del salario mínimo (${eur(r.smi)}).` : `${r.anio}: ${r.cerrado ? 'pasaste' : 'a este ritmo pasas'} del salario mínimo (${eur(r.smi)}).`)}${de.replace('ANIO', r.anio)}`)).join('')}`;
  }
  const tramo = tp.faltaTramo && (tp.fase === 'acabada' || tp.avisar) ? `<p class="veredicto amb">⚠ Desde ${mesLargo(tp.mesNuevo)} ya no vale la tarifa plana y no tienes apuntada la cuota nueva. Con tu beneficio de ahora serían unos ${eur(F.cuotaEstimada(S.estado, M.hoyISO().slice(0, 4)).cuota)} al mes. <button class="enlace" data-accion="sub" data-sub="fiscal">Añadir el tramo</button></p>` : '';
  const boton = tp.fase === 'acabada' && tp.pedida ? '' : `<button class="btn chico ${tp.pedida ? '' : 'sec'}" data-accion="prorroga">${tp.pedida ? '✓ Prórroga pedida' : 'He pedido la prórroga'}</button>`;
  return `<section class="tarjeta sep" data-et="tarifa">
    <div class="cab-t"><div><div class="et">Tarifa plana</div><div class="medio">${cab}</div>${sub}</div>${boton}</div>
    ${cuerpo}${tramo}
    <p class="pie">La app no cambia tu cuota sola: los tramos los pones tú en Ajustes de autónomo. Comprueba la fecha exacta en tu resolución de alta. ${enlace('tarifa', 'Seguridad Social')}</p></section>`;
}

/** Tarjeta «Cuota sin tarifa plana»: la cuota que tocaría con el beneficio del año y el gasto que falta para no pasar del límite. */
function tarjetaCuota(a) {
  const c = F.cuotaEstimada(S.estado, a.anio);
  if (!c.tramo) return '';
  const enCurso = a.modo === 'real' && a.anio === M.hoyISO().slice(0, 4);
  const v = c.falta == null ? `<p class="veredicto amb">⚠ Ningún tramo de la tabla baja de ${eur(c.limite)} al mes.</p>`
    : c.falta === 0 ? `<p class="veredicto ok">✓ No pasas de tu límite de ${eur(c.limite)} al mes.</p>`
    : `<p class="veredicto amb">⚠ Para no pasar de ${eur(c.limite)} al mes te faltan <b class="num">${eur(c.falta)}</b> de gasto deducible en el año: bajarías al tramo de ${eur(c.objetivo.cuota)}.</p>`;
  return `<section class="tarjeta sep" data-et="cuota">
    <div class="et">Cuota sin tarifa plana · estimación</div>
    <div class="medio"><span class="num">${eur(c.cuota)}</span> <span class="mini">al mes</span></div>
    ${kv(`Beneficio para la Seguridad Social al mes${enCurso ? ' · a este ritmo' : ''}`, c.mensual)}
    ${kv('Tu tramo', c.tramo.hasta == null ? 'El último de la tabla' : `hasta ${eur(c.tramo.hasta)} al mes`)}
    ${v}
    <button class="enlace" data-accion="detalle-cuota" data-anio="${a.anio}">Ver de dónde sale</button>
    <p class="pie">Lo que pagarías con un año como ${a.anio} cuando se acabe la tarifa plana, cotizando por la base mínima de tu tramo. La tabla de tramos y tu límite se cambian en <button class="enlace" data-accion="sub" data-sub="fiscal">Ajustes de autónomo</button>.</p></section>`;
}

function impResumen(a) {
  const sim = a.modo === 'simulacion', fi = fiscal();
  const h = sim ? { iva: a.total303, m130: a.total130, renta: a.reservaRenta, total: redondo(a.total303 + a.total130 + a.reservaRenta) } : F.hucha(S.estado);
  return `<section class="heroe">
      <div class="et">${sim ? 'Te habría quedado neto' : 'Neto'} · ${a.anio}</div>
      <div class="grande num">${eur(a.neto)}</div>
      <div class="mini num">de ${eur(a.base)} facturados sin IVA · ${plural(a.n, 'factura emitida', 'facturas emitidas')}${a.sinCerrar ? ` · ${a.sinCerrar} sin cerrar no cuentan` : ''}</div>
      ${barraReparto(a)}
    </section>
    <section class="tarjeta">
      <div class="et">${sim ? 'Hucha · habrías tenido que apartar' : 'Hucha · ten apartado hoy'}</div>
      <div class="medio num amb">${eur(h.total)}</div>
      ${kv('IVA para el modelo 303', h.iva)}${kv('IRPF para el modelo 130', a.obligado130 || h.m130 ? h.m130 : 'No toca')}${kv(`Reserva para la renta (${numEntrada(fi.reservaRentaPct)} % del beneficio)`, h.renta)}
      ${sim ? '' : '<button class="enlace" data-accion="detalle-hucha">Ver de dónde sale</button>'}
    </section>
    ${tarjetaTarifa(a)}${tarjetaCuota(a)}
    <p class="pie">El IVA no es tuyo: lo cobras y lo ingresas. La reserva para la renta sale de tu neto; es una estimación tuya y se cambia en Ajustes de autónomo.</p>
    <h2 class="tit">${a.anio} en números</h2>
    <section class="tarjeta">
      ${kv('Facturado sin IVA', a.base)}
      ${a.general ? kv('IVA cobrado a clientes', a.iva) + kv('IVA deducible de gastos', -a.ivaDeducible) + kv('IVA a ingresar en el año', a.total303, 'fuerte') + (a.aDevolver303 ? kv('IVA a tu favor al cerrar el año', a.aDevolver303) : '') : kv('IVA', 'Franquicia: sin IVA')}
      ${kv('Retenciones en tus facturas', a.retencion)}
      ${kv('Pagos del modelo 130', a.obligado130 ? a.total130 : 'No toca')}
      ${kv(`Cuota de autónomos (${plural(a.mesesCuota, 'mes', 'meses')})`, a.cuota)}
      ${kv('Gastos apuntados que bajan el IRPF', a.gastoIrpf)}
      ${a.amortizacion ? kv('Amortización del material', a.amortizacion) : ''}
      ${a.dificil ? kv(`Gastos de difícil justificación (${numEntrada(fi.difJustPct)} %)`, a.dificil) : ''}
      ${kv('Beneficio para Hacienda', a.rendimiento, 'fuerte')}
    </section>
    <p class="pie">Beneficio = facturado − gastos deducibles − cuota − amortización − gastos de difícil justificación. Cuentan las facturas emitidas (pendientes o cobradas) por su fecha de factura. <button class="enlace" data-accion="sub" data-sub="fiscal">Ajustes de autónomo</button></p>`;
}

function impTrimestres(a) {
  const hoy = M.hoyISO(), sim = a.modo === 'simulacion', fi = fiscal();
  const q = S.trim || (a.anio === hoy.slice(0, 4) ? F.trimestreDe(hoy) : 4), t = a.t[q - 1];
  const pl = F.plazosDelAnio(S.estado, a.anio), p303 = pl.find((p) => p.id === `${a.anio}-303-${q}`), p130 = pl.find((p) => p.id === `${a.anio}-130-${q}`);
  const chips = `<div class="chips" role="group" aria-label="Trimestre">${a.t.map((x) => `<button data-accion="trim" data-q="${x.q}" class="chip ${x.q === q ? 'activa' : ''}" aria-pressed="${x.q === q}">${x.q}T</button>`).join('')}</div>`;
  const marca = (p) => (sim || !p || !p.aplica ? '' : `<button class="btn chico ${p.presentado ? '' : 'sec'}" data-accion="presentar" data-id="${p.id}">${p.presentado ? '✓ Presentado' : 'Marcar como presentado'}</button>`);
  const plazo = (p) => (p ? `<div class="mini">Hasta el ${fechaCorta(p.fecha)}${sim || p.presentado || !p.aplica ? '' : ' · ' + cuando(p.fecha)}</div>` : '<div class="mini">Antes de tu fecha de alta</div>');
  const iva = !a.general ? '<p class="pie">Con franquicia de IVA no hay IVA ni modelo 303.</p>' : `
      ${kv('IVA de tus facturas', t.iva)}${kv('IVA deducible de gastos', -t.ivaDeducible)}${t.compensa ? kv('A tu favor del trimestre anterior', t.compensa) : ''}
      ${kv(t.iva303 + t.compensa < 0 ? 'A compensar en el siguiente' : 'A ingresar', t.iva303 + t.compensa < 0 ? redondo(-(t.iva303 + t.compensa)) : t.aIngresar303, 'fuerte')}`;
  const irpf = !t.obligado130 ? `<p class="pie">No tienes que presentarlo: el ${Math.round(t.pctRetenido)} % de tus ingresos lleva retención (mínimo ${numEntrada(fi.umbralRetenidoPct)} %).</p>${kv('Retenido en tus facturas del trimestre', t.retencion)}` : `
      ${kv('Ingresos desde enero', t.acum.ingresos)}${kv('Gastos desde enero (con cuota y demás)', -t.acum.gastos)}${kv('Beneficio acumulado', t.acum.rendimiento)}
      ${kv(`El ${numEntrada(fi.pagoFraccionadoPct)} %`, t.c130['04'])}${kv('Retenciones desde enero', -t.c130['06'])}${kv('Calculado en trimestres anteriores', -t.c130['05'])}
      ${kv('Rebaja fija del trimestre (minoración)', -t.c130['13'])}${t.c130['15'] ? kv('Negativo de trimestres anteriores', -t.c130['15']) : ''}
      ${kv(t.c130['19'] < 0 ? 'Sale negativo: no pagas' : 'A ingresar', t.c130['19'] < 0 ? t.c130['19'] : t.pago130, 'fuerte')}`;
  return `${chips}
    <section class="tarjeta sep"><div class="cab-t"><div><div class="et">IVA · modelo 303 · ${q}T</div>${plazo(p303)}</div>${marca(p303)}</div>${iva}</section>
    <section class="tarjeta sep"><div class="cab-t"><div><div class="et">IRPF · modelo 130 · ${q}T</div>${plazo(p130)}</div>${marca(p130)}</div>${irpf}</section>
    <p class="pie num">${plural(t.n, 'factura emitida', 'facturas emitidas')} · ${eur(t.base)} sin IVA · ${plural(t.nGastos, 'gasto')} · cuota ${eur(t.cuota)}</p>
    <button class="btn sec ancho" data-accion="imp" data-imp="modelos">Ver las casillas para presentarlo</button>`;
}

/** Apartado «Modelos»: las cifras de cada casilla, listas para copiar. Tocar una casilla explica de dónde sale. */
function impModelos(a) {
  const hoy = M.hoyISO(), sim = a.modo === 'simulacion', mod = S.modelo, trimestral = mod === '303' || mod === '130';
  const q = S.trim || (a.anio === hoy.slice(0, 4) ? F.trimestreDe(hoy) : 4);
  const sel = `<div class="chips" role="group" aria-label="Modelo">${[['303', '303'], ['130', '130'], ['390', '390'], ['renta', 'Renta']].map(([id, txt]) =>
    `<button data-accion="modelo" data-m="${id}" class="chip ${mod === id ? 'activa' : ''}" aria-pressed="${mod === id}">${txt}</button>`).join('')}</div>`;
  const chipsQ = trimestral ? `<div class="chips sep" role="group" aria-label="Trimestre">${a.t.map((x) => `<button data-accion="trim" data-q="${x.q}" class="chip ${x.q === q ? 'activa' : ''}" aria-pressed="${x.q === q}">${x.q}T</button>`).join('')}</div>` : '';
  const casilla = (c) => `<details class="cas${c.fuerte ? ' fuerte' : ''}"><summary>${c.n ? `<span class="cas-n num">${esc(c.n)}</span>` : ''}<span class="cas-t">${esc(c.nombre)}</span><span class="cas-v num">${typeof c.valor === 'number' ? eur(c.valor === 0 ? 0 : c.valor) : esc(c.valor)}</span></summary><p>${esc(c.de)}</p></details>`;
  const id = mod === 'renta' ? `${a.anio}-renta` : trimestral ? `${a.anio}-${mod}-${q}` : `${a.anio}-${mod}`;
  const p = F.plazosDelAnio(S.estado, a.anio).find((x) => x.id === id);
  const cab = (titulo) => `<div class="cab-t sep"><div><div class="et">${titulo}</div>${p ? `<div class="mini">Hasta el ${fechaCorta(p.fecha)}${sim || p.presentado || !p.aplica ? '' : ' · ' + cuando(p.fecha)}</div>` : '<div class="mini">Antes de tu fecha de alta</div>'}</div>
      ${sim || !p || !p.aplica ? '' : `<button class="btn chico ${p.presentado ? '' : 'sec'}" data-accion="presentar" data-id="${p.id}">${p.presentado ? '✓ Presentado' : 'Marcar como presentado'}</button>`}</div>`;
  if (mod === 'renta') {
    const r = MO.resumenRenta(S.estado, a.anio);
    return `${sel}${cab(`Renta ${a.anio} · cifras para Renta Web`)}
      ${r.secciones.map((s) => `<h2 class="tit">${esc(s.titulo)}</h2>${s.nota ? `<p class="pie arriba0">${esc(s.nota)}</p>` : ''}<div class="casillas">${s.filas.map(casilla).join('')}</div>`).join('')}
      <p class="pie">La app te da las cifras; el impuesto lo calcula Renta Web cuando las metes. No se ponen números de casilla porque cambian cada año: busca cada concepto por su nombre. Toca una línea para ver de dónde sale.
        ${fiscal().reduccionInicio ? '' : 'La reducción por inicio de actividad está desactivada en Ajustes de autónomo.'}</p>`;
  }
  const m = mod === '303' ? MO.modelo303(S.estado, a.anio, q) : mod === '130' ? MO.modelo130(S.estado, a.anio, q) : MO.modelo390(S.estado, a.anio);
  const titulo = mod === '303' ? `Modelo 303 · IVA · ${q}T ${a.anio}` : mod === '130' ? `Modelo 130 · IRPF · ${q}T ${a.anio}` : `Modelo 390 · resumen anual del IVA · ${a.anio}`;
  const res = m.resultado ? `<section class="tarjeta sep"><div class="et">Resultado</div><div class="medio${m.aplica ? ' amb' : ''}">${esc(m.resultado.texto)}${m.resultado.importe != null && m.resultado.importe > 0 ? ` · <span class="num">${eur(m.resultado.importe)}</span>` : ''}</div></section>` : '';
  return `${sel}${chipsQ}${cab(titulo)}
    ${m.motivo ? `<p class="banda">${esc(m.motivo)}</p>` : ''}
    <div class="casillas">${m.casillas.map(casilla).join('')}</div>${m.aplica && m.casillas.length ? res : ''}
    <p class="pie">Toca una casilla para ver de dónde sale. Los números de casilla son los del modelo de 2026: si no coinciden con lo que ves en la Sede, guíate por el nombre. ${enlace('m' + mod, 'Instrucciones oficiales')}</p>`;
}

function impCalendario(a) {
  const sim = a.modo === 'simulacion', hoy = M.hoyISO();
  const pl = F.plazosDelAnio(S.estado, a.anio);
  const filas = pl.map((p) => {
    const estado = !p.aplica ? esc(p.motivo) : p.presentado ? 'Presentado' : sim ? 'Fecha orientativa' : cuando(p.fecha);
    const clase = !p.aplica ? 'no' : p.presentado ? 'e-cobrada' : !sim && p.fecha < hoy ? 'vencida' : !sim && diasHasta(p.fecha) <= fiscal().avisoPlazoDias ? 'e-pendiente' : '';
    return `<div class="fila plazo ${clase}">
      <div class="fila-a"><div class="fila-t">${esc(p.titulo)}</div><div class="fila-s">${esc(p.periodo)} · hasta el ${fechaCorta(p.fecha)}</div><div class="fila-c"><i class="punto"></i>${estado}</div></div>
      <div class="fila-b">${p.aplica && p.importe != null ? `<div class="imp num">${eur(p.importe)}</div>${p.modelo === 'renta' ? '<div class="sub">reserva estimada</div>' : ''}` : ''}
        ${sim || !p.aplica ? '' : `<button class="btn chico ${p.presentado ? '' : 'sec'}" data-accion="presentar" data-id="${p.id}">${p.presentado ? '✓ Hecho' : 'Presentado'}</button>`}</div></div>`;
  }).join('');
  return `<div class="lista">${filas}</div>
    ${sim ? '<p class="pie">Los avisos y el archivo de calendario se activan cuando pongas tu fecha de alta.</p>' : '<button class="btn sec ancho" data-accion="exportar-ics">Añadir al calendario del móvil</button><p class="pie">Crea un archivo con los plazos que te tocan y aún no has presentado, con aviso una semana y un día antes. No lleva importes.</p>'}
    <p class="pie">Si el último día cae en fin de semana pasa al lunes, pero la app no conoce los festivos. ${enlace('calendario', 'Calendario oficial')}</p>`;
}

function listaFacturas() {
  let fs = facturas();
  if (S.anio !== 'todo') fs = fs.filter((f) => M.anioDe(f) === S.anio);
  if (S.f.cliente) fs = fs.filter((f) => f.clienteId === S.f.cliente);
  if (S.f.estado) fs = fs.filter((f) => f.estado === S.f.estado);
  if (S.f.q.trim()) {
    const q = sinAcentos(S.f.q.trim());
    fs = fs.filter((f) => sinAcentos([f.n, f.ref, nombreCliente(f.clienteId), f.nota, ...f.servicios.map((s) => s.evento + ' ' + s.mod)].join(' ')).includes(q));
  }
  fs.sort(ordenFecha);
  const t = M.totales(fs, S.estado.ajustes);
  return `<p class="cuenta num">${plural(t.n, 'factura')} · neto cobrado <b>${eur(t.netoCobrado)}</b>${t.n - t.nCobradas ? ` · ${t.n - t.nCobradas} sin cobrar` : ''}</p>
    <div class="lista">${fs.length ? fs.map((f) => filaFactura(f, { cobrar: true })).join('') : '<p class="nada">Ninguna factura con esos filtros.</p>'}</div>`;
}

const volver = '<button class="atras" data-accion="sub" data-sub="">‹ Más</button>';

const SUBVISTAS = {
  resumen() {
    const filas = M.resumenPorAnio(S.estado).map((r) => `<button class="anio-fila" data-accion="ver-anio" data-anio="${r.anio}">
      <div class="a">${r.anio}</div>
      <div><div class="l1"><span class="medio num">${eur(redondo(r.netoCobrado - F.cuotaPagada(S.estado, r.anio)))}</span><span class="mini num">${plural(r.dias, 'día cotizado', 'días cotizados')}</span></div>
        <div class="mini num">neto cobrado · ${r.nCobradas} de ${plural(r.n, 'factura')}</div>
        <div class="mini num">facturado (bruto) ${eur(r.bruto)}</div></div></button>`).join('');
    const t = M.totales(facturas(), S.estado.ajustes);
    return { titulo: 'Resumen por año', cab: volver, html: `<div class="lista">${filas}</div>
      <section class="tarjeta total"><div class="et">Total</div><div class="medio num">${eur(redondo(t.netoCobrado - F.cuotaPagada(S.estado, 'todo')))} netos cobrados</div>
      <div class="mini num">${t.n} facturas · facturado (bruto) ${eur(t.bruto)} · ${t.dias} días cotizados</div></section>
      <p class="pie">Toca un año para ver sus facturas. Los días cotizados son los que apuntas en cada factura mientras factures por cooperativa. Como autónomo, el neto ya lleva restada la cuota.</p>` };
  },

  clientes() {
    const fs = facturas();
    const filas = clientes().map((c) => {
      const t = M.totales(fs.filter((f) => f.clienteId === c.id), S.estado.ajustes);
      return `<div class="fila" role="button" tabindex="0" data-accion="abrir-cliente" data-id="${esc(c.id)}">
        <div class="fila-a"><div class="fila-t">${esc(c.nombre)}</div><div class="fila-s">${esc(M.textoPlazo(c.plazo))}</div></div>
        <div class="fila-b"><div class="imp num">${eur(t.netoCobrado)}</div><div class="sub num">${plural(t.n, 'factura')}</div></div></div>`;
    }).join('');
    return { titulo: 'Clientes', cab: volver, html: `<div class="lista">${filas || '<p class="nada">Sin clientes todavía.</p>'}</div>
      <button class="btn sec ancho" data-accion="abrir-cliente" data-id="">＋ Añadir cliente</button>` };
  },

  copias() {
    const dias = S.local.ultimaCopia ? Math.floor((Date.now() - S.local.ultimaCopia) / 864e5) : null;
    const ult = S.instantaneas[0];
    return { titulo: 'Copias de seguridad', cab: volver, html: `
      <section class="tarjeta"><div class="et">Última copia exportada desde este dispositivo</div>
        <div class="medio">${dias === null ? 'Nunca' : dias === 0 ? 'Hoy' : `Hace ${dias} días`}</div></section>
      <button class="btn ancho" data-accion="exportar-copia">Exportar copia cifrada</button>
      <p class="pie">Se cifra con tu código actual. Guárdala fuera del dispositivo (ordenador, pendrive). Es también el archivo que importas en el otro dispositivo para sincronizar.</p>
      <button class="btn sec ancho" data-accion="importar-copia">Importar copia</button>
      <p class="pie">Antes de aplicar nada verás qué cambia y podrás elegir. Sirve la copia cifrada de esta app y la copia de la app anterior.</p>
      ${ult ? `<button class="btn sec ancho" data-accion="deshacer-importacion">Deshacer la última importación</button>
      <p class="pie">Vuelve a como estaba todo el ${new Date(ult.ts).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}.</p>` : ''}
      <button class="btn sec ancho" data-accion="exportar-csv">Exportar facturas a CSV</button>
      <button class="btn sec ancho" data-accion="exportar-gastos-csv">Exportar gastos a CSV</button>
      <p class="pie">El CSV es para abrirlo en Excel y <b>no va cifrado</b>.</p>
      <label class="linea">Avisarme si llevo sin copia <input inputmode="numeric" data-ajuste="avisoCopiaDias" value="${esc(S.estado.ajustes.avisoCopiaDias)}" aria-label="Días"> días</label>` };
  },

  fiscal() {
    const fi = fiscal(), alta = S.estado.ajustes.fechaAlta;
    const ops = (obj, sel) => Object.entries(obj).map(([v, t]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${t}</option>`).join('');
    const estado = (k) => `<div class="par-e">${fi.confirmados[k] ? '<span class="tag ok">Confirmado</span>' : '<span class="tag">Pendiente de confirmar</span>'}
        <label class="marca chica"><input type="checkbox" data-confirmar="${k}" ${fi.confirmados[k] ? 'checked' : ''}><span>Lo he comprobado</span></label></div>`;
    const campo = ([k, et, unidad]) => `<label>${et}<span class="con"><input inputmode="decimal" data-fiscal="${k}" value="${numEntrada(fi[k])}"><i>${unidad}</i></span></label>`;
    const oficiales = PARAMETROS.map((p) => `<div class="par">${campo(p)}${estado(p[0])}${enlace(p[3])}</div>`).join('');
    const tramos = fi.cuotas.map((t, i) => `<div class="tramo" data-i="${i}">
        <label>Desde el mes<input type="month" data-cuota="desde" value="${esc(t.desde || '')}"></label>
        <label>Importe al mes €<input inputmode="decimal" data-cuota="importe" value="${numEntrada(t.importe)}"></label>
        ${fi.cuotas.length > 1 ? `<button type="button" class="quitar" data-accion="quitar-cuota" data-i="${i}">Quitar tramo</button>` : ''}</div>`).join('');
    const cats = fi.categorias.map((c) => `<button class="fila menu" data-accion="abrir-categoria" data-id="${esc(c.id)}"><div class="fila-a"><div class="fila-t">${esc(c.nombre)}</div>
        <div class="fila-s num">IVA ${numEntrada(c.ivaPct)} % · deducible: IVA ${numEntrada(c.dedIva)} % · IRPF ${numEntrada(c.dedIrpf)} %</div></div><div class="flecha" aria-hidden="true">›</div></button>`).join('');
    return { titulo: 'Ajustes de autónomo', cab: volver, html: `
      <section class="tarjeta">
        <label>Fecha de alta como autónomo<input type="date" data-fecha-alta value="${esc(alta || '')}"></label>
        <p class="pie">${alta ? `Las facturas con fecha de factura desde el ${fechaCorta(alta)} son de autónomo; las anteriores, de cooperativa.` : 'Vacía: todo es cooperativa, como hasta ahora, y los impuestos se ven en simulación.'}
          ${alta ? '<button class="enlace" data-accion="quitar-alta">Quitar la fecha</button>' : ''}</p>
        <div class="campos sep">
          <label class="c2">Epígrafe de actividad (IAE)<select data-fiscal-sel="epigrafe">${ops(M.EPIGRAFES, fi.epigrafe)}</select></label>
          <label class="c2">Régimen de IVA<select data-fiscal-sel="regimenIva">${ops({ general: 'General (cobro IVA y presento el 303)', franquicia: 'Franquicia (sin IVA, si se aprueba)' }, fi.regimenIva)}</select></label>
        </div>
        <p class="pie">El epígrafe decide si tus facturas llevan retención y si presentas el modelo 130. Las facturas ya guardadas conservan sus porcentajes.</p>
      </section>
      <h2 class="tit">Valores oficiales</h2>
      <p class="pie arriba0">Vienen puestos de partida. Compruébalos en la página oficial cuando te des de alta y marca «Lo he comprobado».</p>
      ${oficiales}
      <div class="par"><div class="et">Modelo 130: rebaja fija por trimestre (minoración)</div>
        ${fi.minoracion130.map((t, i) => `<div class="tramo" data-i="${i}">
          <label>Beneficio del año anterior hasta €<input inputmode="decimal" data-minoracion="hasta" value="${numEntrada(t.hasta)}"></label>
          <label>Rebaja €<input inputmode="decimal" data-minoracion="importe" value="${numEntrada(t.importe)}"></label></div>`).join('')}
        <p class="pie">Si el año anterior no fuiste autónomo, cuenta como beneficio cero (la rebaja mayor).</p>${estado('minoracion130')}${enlace('m130')}</div>
      <div class="par"><label>Reducción por inicio de actividad en la renta<select data-fiscal-sel="reduccionInicio"><option value="false" ${fi.reduccionInicio ? '' : 'selected'}>No aplicarla</option><option value="true" ${fi.reduccionInicio ? 'selected' : ''}>Aplicarla</option></select></label>
        ${campo(['reduccionInicioPct', 'Parte del beneficio que reduce', '%'])}
        <p class="pie">Solo sale en el resumen para la renta. Vale el primer año con beneficio y el siguiente, y no se aplica si más de la mitad de tus ingresos vienen de alguien que te pagó una nómina el año antes del alta. Lee los requisitos antes de activarla.</p>${estado('reduccionInicio')}${enlace('reduccion')}</div>
      <h2 class="tit">Cuota de autónomos</h2>
      <div class="par">${tramos}<button class="btn sec chico" data-accion="add-cuota">＋ Añadir tramo</button>
        <p class="pie">El primer tramo vale desde el alta si no le pones mes. Añade otro cuando cambie la cuota (fin de la tarifa plana, subida anual). La de partida es la tarifa plana con el recargo MEI.</p>
        ${estado('cuotas')}${enlace('cuota')}</div>
      <h2 class="tit">Cuota según tu beneficio (sin tarifa plana)</h2>
      <div class="par">${campo(['tipoCotizacionPct', 'Tipo de cotización', '%'])}
        ${fi.tramosCuota.map((t, i) => `<div class="tramo" data-i="${i}">
          <label>Beneficio al mes hasta €<input inputmode="decimal" data-tramoc="hasta" placeholder="sin límite" value="${numEntrada(t.hasta)}"></label>
          <label>Base mínima €<input inputmode="decimal" data-tramoc="base" value="${numEntrada(t.base)}"></label>
          <div class="mini num" data-et="cuota-tramo">cuota ${eur(F.cuotaDeTramo(t, fi))} al mes</div>
          ${fi.tramosCuota.length > 1 ? `<button type="button" class="quitar corto" data-accion="quitar-tramoc" data-i="${i}">Quitar</button>` : ''}</div>`).join('')}
        <button class="btn sec chico" data-accion="add-tramoc">＋ Añadir tramo</button>
        <p class="pie">Es la tabla de 2026. La cuota de cada tramo es su base mínima por el tipo de cotización. El último tramo va con el «hasta» vacío. Sirve para estimar tu cuota cuando se acabe la tarifa plana; no cambia la cuota que la app te resta, que es la de «Cuota de autónomos».</p>
        ${estado('tramosCuota')}${enlace('cuota')}</div>
      <h2 class="tit">Decisiones mías</h2>
      <div class="par">${PROPIOS.map(campo).join('')}</div>
      <h2 class="tit">Categorías de gasto</h2>
      <div class="lista">${cats}</div>
      <button class="btn sec ancho" data-accion="abrir-categoria" data-id="">＋ Añadir categoría</button>
      <p class="pie">Los porcentajes de cada categoría son los que se proponen al apuntar un gasto; luego se pueden cambiar gasto a gasto.</p>
      <div class="par sep">${estado('categorias')}</div>
      <h2 class="tit">Material que se amortiza</h2>
      <div class="lista">${fi.amortizaciones.map((x) => `<button class="fila menu" data-accion="abrir-amortizacion" data-id="${esc(x.id)}"><div class="fila-a"><div class="fila-t">${esc(x.nombre)}</div>
        <div class="fila-s num">${numEntrada(x.pct)} % al año como máximo</div></div><div class="flecha" aria-hidden="true">›</div></button>`).join('')}</div>
      <button class="btn sec ancho" data-accion="abrir-amortizacion" data-id="">＋ Añadir tipo de material</button>
      <p class="pie">El material caro que dura años no es gasto de golpe: cada año cuenta su porcentaje. Lo que cueste hasta ${numEntrada(fi.amortizacionLibreMax)} € por unidad puedes apuntarlo como gasto normal.</p>
      <div class="par sep">${estado('amortizaciones')}${enlace('amortizacion')}</div>` };
  },

  seguridad() {
    return { titulo: 'Código de acceso', cab: volver, html: `
      <button class="btn ancho" data-accion="cambiar-password">Cambiar el código</button>
      <p class="pie">Puedes pasar de un código corto a uno más largo, o a una contraseña con letras, cuando quieras. Las copias que ya hayas exportado se siguen abriendo con el código que tenías al hacerlas.</p>
      <button class="btn sec ancho" data-accion="bloquear">Cerrar con código ahora</button>
      <p class="pie">La app pide el código cada vez que la abres. Este botón lo pide ya, sin tener que cerrarla.</p>` };
  },
};

function render() {
  if (!S.estado) return;
  const misma = $('#app').dataset.vista === S.vista + '/' + (S.sub || '');
  const desplazamiento = misma ? window.scrollY : 0;
  const v = VISTAS[S.vista]();
  $('#app').dataset.vista = S.vista + '/' + (S.sub || '');
  $('#app').innerHTML = `<header class="cab"><h1>${esc(v.titulo)}</h1>${v.cab || ''}</header>
    <main class="cuerpo">${v.html}</main>${barra()}
    <input type="file" id="archivo" accept=".json,application/json" hidden>`;
  window.scrollTo(0, desplazamiento);
}

// ---------- hojas (fichas que suben desde abajo) ----------
function abrirHoja(html) {
  $('#capa').innerHTML = `<div class="velo" data-accion="cerrar-hoja"></div><section class="hoja" role="dialog" aria-modal="true">${html}</section>`;
  document.documentElement.classList.add('con-hoja');
}
function cerrarHoja() { S.hoja = null; $('#capa').innerHTML = ''; document.documentElement.classList.remove('con-hoja'); }

// --- ficha de factura ---
function hojaFactura(id) {
  const orig = id ? S.estado.facturas.find((f) => f.id === id) : null;
  const datos = orig ? structuredClone(orig) : {
    id: null, n: M.siguienteNumero(S.estado), ref: '', clienteId: '', estado: 'abierta', fechaFactura: null, fechaCobro: null,
    neto: null, diasSS: null, nota: '', servicios: [{ evento: '', mod: '', fecha: M.hoyISO(), dias: 1, importe: null }],
  };
  S.hoja = { tipo: 'factura', datos, orig, clienteNuevo: '' };
  pintarHojaFactura();
}

function pintarHojaFactura() {
  const { datos: d, orig } = S.hoja;
  const servicios = d.servicios.map((s, i) => `<div class="serv" data-i="${i}">
      <label class="c2">Evento<input data-serv="evento" value="${esc(s.evento)}"></label>
      <label>Modalidad<input data-serv="mod" list="modalidades" value="${esc(s.mod)}" autocomplete="off"></label>
      <label>Fecha<input type="date" data-serv="fecha" value="${esc(s.fecha || '')}"></label>
      <label>Días<input inputmode="numeric" data-serv="dias" data-tipo="entero" value="${numEntrada(s.dias)}"></label>
      <label>Importe €<input inputmode="decimal" data-serv="importe" data-tipo="decimal" value="${numEntrada(s.importe)}"></label>
      <button type="button" class="quitar" data-accion="quitar-servicio" data-i="${i}">Quitar servicio</button></div>`).join('');
  abrirHoja(`<form data-form="factura" novalidate>
    <header class="hoja-cab"><h2>${orig ? `Factura #${esc(d.n ?? '')}` : 'Nueva factura'}</h2><button type="button" class="x" data-accion="cerrar-hoja" aria-label="Cerrar">✕</button></header>
    <div class="campos">
      <label class="c2">Cliente<select data-campo="clienteId"><option value="">Elige un cliente…</option>
        ${clientes().map((c) => `<option value="${esc(c.id)}" ${c.id === d.clienteId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
        <option value="__nuevo" ${d.clienteId === '__nuevo' ? 'selected' : ''}>＋ Cliente nuevo…</option></select></label>
      <label class="c2" data-si="nuevo">Nombre del cliente nuevo<input data-hoja="clienteNuevo" value="${esc(S.hoja.clienteNuevo)}"></label>
      <label>Nº<input inputmode="numeric" data-campo="n" data-tipo="entero" value="${numEntrada(d.n)}"></label>
      <label>Estado<select data-campo="estado">${Object.entries(M.ESTADOS).map(([v, t]) => `<option value="${v}" ${v === d.estado ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="c2">Referencia<input data-campo="ref" value="${esc(d.ref)}" placeholder="Servei 26"></label>
      <label>Fecha de factura<input type="date" data-campo="fechaFactura" value="${esc(d.fechaFactura || '')}"></label>
      <label data-si="cobrada">Fecha de cobro<input type="date" data-campo="fechaCobro" value="${esc(d.fechaCobro || '')}"></label>
      <label data-si="coop"><span data-et="neto"></span><input inputmode="decimal" data-campo="neto" data-tipo="decimal" value="${numEntrada(d.neto)}"></label>
      <label data-si="coop">Días cotizados<input inputmode="numeric" data-campo="diasSS" data-tipo="entero" value="${numEntrada(d.diasSS)}"></label>
      <label data-si="aut">IVA %<input inputmode="decimal" data-campo="ivaPct" data-tipo="decimal" value="${numEntrada(d.ivaPct)}" placeholder="${numEntrada(M.ivaPorDefecto(fiscal()))}"></label>
      <label data-si="aut">Retención IRPF %<input inputmode="decimal" data-campo="retPct" data-tipo="decimal" value="${numEntrada(d.retPct)}" placeholder="${numEntrada(M.retencionPorDefecto(fiscal()))}"></label>
      <div class="c2 desglose" data-si="aut" data-et="desglose"></div>
    </div>
    <h3>Servicios <span class="num" data-et="bruto"></span></h3>
    <div id="servicios">${servicios}</div>
    <datalist id="modalidades">${M.modalidadesEnUso(S.estado).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <button type="button" class="btn sec ancho" data-accion="add-servicio">＋ Añadir servicio</button>
    <div class="campos"><label class="c2">Nota<textarea data-campo="nota" rows="2">${esc(d.nota)}</textarea></label></div>
    <p class="error" data-et="error" role="alert" hidden></p>
    <footer class="hoja-pie">${orig ? '<button type="button" class="btn peligro" data-accion="borrar-factura">Borrar</button>' : ''}
      <button type="submit" class="btn">Guardar</button></footer></form>`);
  ajustarHojaFactura();
}

/** Muestra u oculta lo que depende del estado y recalcula el bruto, sin repintar (para no perder el foco). */
function ajustarHojaFactura() {
  const d = S.hoja.datos, h = $('#capa');
  const aut = M.esAutonomo(d, S.estado.ajustes);   // depende de la fecha de factura: se recalcula al cambiarla
  h.querySelector('[data-si=cobrada]').hidden = d.estado !== 'cobrada';
  h.querySelector('[data-si=nuevo]').hidden = d.clienteId !== '__nuevo';
  for (const el of h.querySelectorAll('[data-si=aut]')) el.hidden = !aut;
  for (const el of h.querySelectorAll('[data-si=coop]')) el.hidden = aut;
  h.querySelector('[data-et=neto]').textContent = d.estado === 'cobrada' ? 'Neto cobrado €' : 'Neto previsto € (opcional)';
  h.querySelector('[data-et=bruto]').textContent = `${aut ? 'base sin IVA' : 'bruto'} ${eur(M.bruto(d))}`;
  if (aut) {
    const x = M.desglose(d, fiscal());
    h.querySelector('[data-et=desglose]').innerHTML = `<b>Factura de autónomo.</b> Los importes de los servicios van sin IVA.
      ${kv('IVA', x.iva)}${kv('Retención', -x.retencion)}${kv('Te entra en el banco', x.total)}${kv('Neto (tras apartar IVA e IRPF)', x.neto, 'fuerte')}`;
  }
}

function errorHoja(texto) { const e = $('#capa [data-et=error]'); e.textContent = texto; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); }

async function guardarFactura() {
  const { datos: d, orig } = S.hoja;
  if (!d.clienteId) return errorHoja('Elige un cliente.');
  if (d.clienteId === '__nuevo' && !S.hoja.clienteNuevo.trim()) return errorHoja('Escribe el nombre del cliente nuevo.');
  const aut = M.esAutonomo(d, S.estado.ajustes);
  if (d.estado === 'cobrada' && d.neto == null && !aut) return errorHoja('Para marcarla como cobrada, apunta el neto que te ha entrado.');
  const servicios = d.servicios.filter((s) => s.evento.trim() || s.importe != null)
    .map((s) => ({ evento: s.evento.trim(), mod: s.mod.trim(), fecha: s.fecha || null, dias: s.dias, importe: s.importe || 0 }));
  if (d.clienteId === '__nuevo') {
    const c = { id: M.nuevoId('c'), nombre: S.hoja.clienteNuevo.trim(), plazo: null, _mod: Date.now(), _base: 0 };
    S.estado.clientes.push(c); d.clienteId = c.id;
  }
  const limpia = { ...d, ref: d.ref.trim(), nota: d.nota.trim(), servicios, fechaFactura: d.fechaFactura || null, fechaCobro: d.estado === 'cobrada' ? d.fechaCobro || null : null };
  // Factura de autónomo: guarda los porcentajes con los que se hizo. De cooperativa: no los lleva.
  if (aut) { limpia.ivaPct = d.ivaPct ?? M.ivaPorDefecto(fiscal()); limpia.retPct = d.retPct ?? M.retencionPorDefecto(fiscal()); }
  else { delete limpia.ivaPct; delete limpia.retPct; }
  if (orig) {
    const antes = JSON.stringify(orig);
    if (limpia.fechaFactura !== orig.fechaFactura) delete limpia.fechaEstimada; // la fecha ya la ha puesto el usuario
    for (const k of Object.keys(orig)) if (!(k in limpia)) delete orig[k];
    Object.assign(orig, limpia);
    if (JSON.stringify(orig) !== antes) M.tocar(orig); // sin cambios reales no cuenta como modificada
  } else S.estado.facturas.push({ ...limpia, id: M.nuevoId('f'), _mod: Date.now(), _base: 0 });
  await persistir(); cerrarHoja(); render(); aviso('Factura guardada');
}

// --- ficha de cliente ---
function hojaCliente(id) {
  const orig = id ? S.estado.clientes.find((c) => c.id === id) : null;
  const p = orig?.plazo;
  S.hoja = { tipo: 'cliente', orig, datos: { nombre: orig?.nombre || '', tipo: p ? p.tipo : 'sin', dias: p?.dias ?? 30, desde: p?.desde ?? 1, hasta: p?.hasta ?? 10 } };
  const d = S.hoja.datos;
  const usos = orig ? facturas().filter((f) => f.clienteId === orig.id).length : 0;
  abrirHoja(`<form data-form="cliente" novalidate>
    <header class="hoja-cab"><h2>${orig ? 'Cliente' : 'Cliente nuevo'}</h2><button type="button" class="x" data-accion="cerrar-hoja" aria-label="Cerrar">✕</button></header>
    <div class="campos">
      <label class="c2">Nombre<input data-campo="nombre" value="${esc(d.nombre)}"></label>
      <label class="c2">Cuándo paga<select data-campo="tipo">
        <option value="sin" ${d.tipo === 'sin' ? 'selected' : ''}>Sin plazo fijo</option>
        <option value="dias" ${d.tipo === 'dias' ? 'selected' : ''}>A los X días de la factura</option>
        <option value="mes" ${d.tipo === 'mes' ? 'selected' : ''}>Entre dos días del mes siguiente</option></select></label>
      <label class="c2" data-si="dias">Días desde la fecha de factura<input inputmode="numeric" data-campo="dias" data-tipo="entero" value="${numEntrada(d.dias)}"></label>
      <label data-si="mes">Desde el día<input inputmode="numeric" data-campo="desde" data-tipo="entero" value="${numEntrada(d.desde)}"></label>
      <label data-si="mes">Hasta el día<input inputmode="numeric" data-campo="hasta" data-tipo="entero" value="${numEntrada(d.hasta)}"></label>
    </div>
    <p class="error" data-et="error" role="alert" hidden></p>
    <footer class="hoja-pie">${orig ? `<button type="button" class="btn peligro" data-accion="borrar-cliente" ${usos ? 'disabled' : ''}>${usos ? `Tiene ${usos} facturas` : 'Borrar'}</button>` : ''}
      <button type="submit" class="btn">Guardar</button></footer></form>`);
  ajustarHojaCliente();
}
function ajustarHojaCliente() {
  for (const el of $('#capa').querySelectorAll('[data-si]')) el.hidden = el.dataset.si !== S.hoja.datos.tipo;
}

async function guardarCliente() {
  const { datos: d, orig } = S.hoja;
  const nombre = d.nombre.trim();
  if (!nombre) return errorHoja('Escribe el nombre.');
  if (clientes().some((c) => c !== orig && sinAcentos(c.nombre) === sinAcentos(nombre))) return errorHoja('Ya tienes un cliente con ese nombre.');
  const plazo = d.tipo === 'dias' ? { tipo: 'dias', dias: d.dias || 0 }
    : d.tipo === 'mes' ? { tipo: 'mes', desde: d.desde || 1, hasta: Math.max(d.hasta || d.desde || 1, d.desde || 1) } : null;
  if (orig) {
    const antes = JSON.stringify(orig);
    orig.nombre = nombre; orig.plazo = plazo;
    if (JSON.stringify(orig) !== antes) M.tocar(orig);
  }
  else S.estado.clientes.push({ id: M.nuevoId('c'), nombre, plazo, _mod: Date.now(), _base: 0 });
  await persistir(); cerrarHoja(); render(); aviso('Cliente guardado');
}

// --- ficha de gasto ---
function hojaGasto(id) {
  const orig = id ? S.estado.gastos.find((g) => g.id === id) : null;
  const c = fiscal().categorias[0];
  const datos = orig ? structuredClone(orig) : { id: null, fecha: M.hoyISO(), proveedor: '', numFactura: '', categoria: c ? c.id : '', base: null,
    ivaPct: c ? c.ivaPct : M.ivaPorDefecto(fiscal()), iva: null, dedIva: c ? c.dedIva : 100, dedIrpf: c ? c.dedIrpf : 100, justificante: false, nota: '' };
  S.hoja = { tipo: 'gasto', datos, orig };
  const d = datos, cats = fiscal().categorias;
  abrirHoja(`<form data-form="gasto" novalidate>
    <header class="hoja-cab"><h2>${orig ? 'Gasto' : 'Gasto nuevo'}</h2><button type="button" class="x" data-accion="cerrar-hoja" aria-label="Cerrar">✕</button></header>
    <div class="campos">
      <label>Fecha<input type="date" data-campo="fecha" value="${esc(d.fecha || '')}"></label>
      <label>Nº de factura<input data-campo="numFactura" value="${esc(d.numFactura)}"></label>
      <label class="c2">Proveedor<input data-campo="proveedor" value="${esc(d.proveedor)}"></label>
      <label class="c2">Categoría<select data-campo="categoria">${cats.map((x) => `<option value="${esc(x.id)}" ${x.id === d.categoria ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}
        ${cats.some((x) => x.id === d.categoria) ? '' : `<option value="${esc(d.categoria)}" selected>Sin categoría</option>`}</select></label>
      <label>Base sin IVA €<input inputmode="decimal" data-campo="base" data-tipo="decimal" value="${numEntrada(d.base)}"></label>
      <label>IVA %<input inputmode="decimal" data-campo="ivaPct" data-tipo="decimal" value="${numEntrada(d.ivaPct)}"></label>
      <label>IVA €<input inputmode="decimal" data-campo="iva" data-tipo="decimal" value="${numEntrada(d.iva)}"></label>
      <label>Total pagado<input data-et="total" readonly tabindex="-1"></label>
      <label>Deducible de IVA %<input inputmode="decimal" data-campo="dedIva" data-tipo="decimal" value="${numEntrada(d.dedIva)}"></label>
      <label>Deducible de IRPF %<input inputmode="decimal" data-campo="dedIrpf" data-tipo="decimal" value="${numEntrada(d.dedIrpf)}"></label>
      <label class="c2 marca"><input type="checkbox" data-campo="amortiza" ${d.amortiza ? 'checked' : ''}><span>Se amortiza (material de más de ${numEntrada(fiscal().amortizacionLibreMax)} € que dura años)</span></label>
      <label data-si="amortiza">Tipo de material<select data-et="grupo">${fiscal().amortizaciones.map((x) => `<option value="${numEntrada(x.pct)}" ${Number(d.amortPct) === Number(x.pct) ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}<option value="" ${d.amortiza && !fiscal().amortizaciones.some((x) => Number(x.pct) === Number(d.amortPct)) ? 'selected' : ''}>Otro porcentaje</option></select></label>
      <label data-si="amortiza">Amortización al año %<input inputmode="decimal" data-campo="amortPct" data-tipo="decimal" value="${numEntrada(d.amortPct)}"></label>
      <label class="c2 marca"><input type="checkbox" data-campo="justificante" ${d.justificante ? 'checked' : ''}><span>Justificante guardado (factura o tique a mi nombre)</span></label>
      <div class="c2 desglose" data-et="efecto"></div>
      <label class="c2">Nota<textarea data-campo="nota" rows="2">${esc(d.nota)}</textarea></label>
    </div>
    <p class="error" data-et="error" role="alert" hidden></p>
    <footer class="hoja-pie">${orig ? '<button type="button" class="btn peligro" data-accion="borrar-gasto">Borrar</button>' : ''}
      <button type="submit" class="btn">Guardar</button></footer></form>`);
  ajustarHojaGasto();
}

/** Al cambiar la categoría propone sus porcentajes; al cambiar base o IVA % recalcula el IVA en euros (que se puede corregir a mano). */
function ajustarHojaGasto(campo) {
  const d = S.hoja.datos, h = $('#capa');
  const pon = (k) => { h.querySelector(`[data-campo=${k}]`).value = numEntrada(d[k]); };
  if (campo === 'categoria') {
    const c = fiscal().categorias.find((x) => x.id === d.categoria);
    if (c) { d.ivaPct = c.ivaPct; d.dedIva = c.dedIva; d.dedIrpf = c.dedIrpf; pon('ivaPct'); pon('dedIva'); pon('dedIrpf'); }
  }
  if (['categoria', 'base', 'ivaPct'].includes(campo)) { d.iva = d.base == null ? null : redondo(d.base * (d.ivaPct || 0) / 100); pon('iva'); }
  if (campo === 'amortiza' && d.amortiza && d.amortPct == null) { d.amortPct = fiscal().amortizaciones[0] ? fiscal().amortizaciones[0].pct : null; pon('amortPct'); }
  if (campo === 'amortPct') { const g = h.querySelector('[data-et=grupo]'); g.value = [...g.options].some((o) => o.value === numEntrada(d.amortPct)) ? numEntrada(d.amortPct) : ''; }
  for (const el of h.querySelectorAll('[data-si=amortiza]')) el.hidden = !d.amortiza;
  const c = F.calculoGasto(d, fiscal());
  h.querySelector('[data-et=total]').value = eur(c.total);
  const alAnio = redondo(c.gastoIrpf * (d.amortPct || 0) / 100);
  h.querySelector('[data-et=efecto]').innerHTML = `${kv('IVA que recuperas', c.ivaDed)}${d.amortiza
    ? kv('Baja tu IRPF poco a poco, cada año', alAnio, 'fuerte') + `<p class="mini">Hasta completar ${eur(c.gastoIrpf)}${alAnio ? ` (unos ${String(Math.ceil(c.gastoIrpf / alAnio))} años)` : ''}. El primer año cuenta solo desde la fecha de compra.</p>`
    : kv('Gasto que baja tu IRPF', c.gastoIrpf, 'fuerte')}`;
}

async function guardarGasto() {
  const { datos: d, orig } = S.hoja;
  if (!d.fecha) return errorHoja('Pon la fecha del gasto.');
  if (d.base == null) return errorHoja('Pon la base (el importe sin IVA).');
  if (d.amortiza && !(d.amortPct > 0)) return errorHoja('Pon el porcentaje de amortización al año.');
  const limpio = { ...d, proveedor: d.proveedor.trim(), numFactura: d.numFactura.trim(), nota: d.nota.trim(), ivaPct: d.ivaPct || 0, iva: d.iva || 0,
    dedIva: d.dedIva || 0, dedIrpf: d.dedIrpf || 0, justificante: !!d.justificante };
  if (d.amortiza) limpio.amortiza = true; else { delete limpio.amortiza; delete limpio.amortPct; }
  if (orig) {
    const antes = JSON.stringify(orig);
    Object.assign(orig, limpio);
    for (const k of ['amortiza', 'amortPct']) if (!(k in limpio)) delete orig[k];
    if (JSON.stringify(orig) !== antes) M.tocar(orig);
  } else S.estado.gastos.push({ ...limpio, id: M.nuevoId('g'), _mod: Date.now(), _base: 0 });
  await persistir(); cerrarHoja(); render(); aviso('Gasto guardado');
}

/** Añadir o editar una categoría de gasto (nombre y porcentajes que propone). */
async function editarCategoria(id, error = '') {
  const cats = fiscal().categorias, c = cats.find((x) => x.id === id);
  const v = c || { nombre: '', ivaPct: M.ivaPorDefecto(fiscal()), dedIva: 100, dedIrpf: 100 };
  const usos = c ? gastos().filter((g) => g.categoria === c.id).length : 0;
  const r = await dialogo({ titulo: c ? 'Categoría de gasto' : 'Categoría nueva', cuerpo: `
      <label>Nombre<input name="nombre" value="${esc(v.nombre)}"></label>
      <label>IVA habitual %<input name="ivaPct" inputmode="decimal" value="${numEntrada(v.ivaPct)}"></label>
      <label>Deducible de IVA %<input name="dedIva" inputmode="decimal" value="${numEntrada(v.dedIva)}"></label>
      <label>Deducible de IRPF %<input name="dedIrpf" inputmode="decimal" value="${numEntrada(v.dedIrpf)}"></label>
      <p class="pie">Cambiarla no toca los gastos ya apuntados${usos ? ` (${usos} con esta categoría)` : ''}.</p>${error ? `<p class="error">${esc(error)}</p>` : ''}`,
    botones: [{ texto: 'Cancelar', valor: false, clase: 'sec' }, ...(c && cats.length > 1 ? [{ texto: 'Borrar', valor: 'borrar', clase: 'peligro' }] : []), { texto: 'Guardar', valor: true }] });
  if (!r.valor) return;
  if (r.valor === 'borrar') cats.splice(cats.indexOf(c), 1);
  else {
    const nombre = r.datos.nombre.trim(), n = (k) => Math.max(0, leerNumero(r.datos[k]) ?? 0);
    if (!nombre) return editarCategoria(id, 'Escribe el nombre.');
    const datos = { nombre, ivaPct: n('ivaPct'), dedIva: Math.min(100, n('dedIva')), dedIrpf: Math.min(100, n('dedIrpf')) };
    if (c) Object.assign(c, datos); else cats.push({ id: M.nuevoId('k'), ...datos });
  }
  guardarAjustes(true);
}

/** Añadir o editar un tipo de material de la tabla de amortización (nombre y % al año). */
async function editarAmortizacion(id, error = '') {
  const lista = fiscal().amortizaciones, x = lista.find((y) => y.id === id), v = x || { nombre: '', pct: null };
  const r = await dialogo({ titulo: x ? 'Tipo de material' : 'Tipo de material nuevo', cuerpo: `
      <label>Nombre<input name="nombre" value="${esc(v.nombre)}"></label>
      <label>Amortización máxima al año %<input name="pct" inputmode="decimal" value="${numEntrada(v.pct)}"></label>
      <p class="pie">Cambiarlo no toca los gastos ya apuntados.</p>${error ? `<p class="error">${esc(error)}</p>` : ''}`,
    botones: [{ texto: 'Cancelar', valor: false, clase: 'sec' }, ...(x && lista.length > 1 ? [{ texto: 'Borrar', valor: 'borrar', clase: 'peligro' }] : []), { texto: 'Guardar', valor: true }] });
  if (!r.valor) return;
  if (r.valor === 'borrar') lista.splice(lista.indexOf(x), 1);
  else {
    const nombre = r.datos.nombre.trim(), pct = leerNumero(r.datos.pct);
    if (!nombre || !(pct > 0)) return editarAmortizacion(id, 'Escribe el nombre y un porcentaje mayor que cero.');
    if (x) Object.assign(x, { nombre, pct }); else lista.push({ id: M.nuevoId('a'), nombre, pct });
  }
  guardarAjustes(true);
}

/** Cambia (o quita) la fecha de alta. Avisa de cuántas facturas cambian de régimen antes de hacerlo. */
async function cambiarFechaAlta(nueva) {
  const A = S.estado.ajustes, antes = A.fechaAlta;
  nueva = nueva || null;
  if (nueva === antes) return;
  const cambian = facturas().filter((f) => M.esAutonomo(f, { fechaAlta: antes }) !== M.esAutonomo(f, { fechaAlta: nueva }));
  const aAutonomo = cambian.filter((f) => M.esAutonomo(f, { fechaAlta: nueva })).length;
  if (cambian.length && !await confirmar('Fecha de alta', `${plural(cambian.length, 'factura cambia', 'facturas cambian')} de régimen: ${aAutonomo} pasan a contarse como de autónomo (importe = base sin IVA, neto calculado) y ${cambian.length - aAutonomo} vuelven a cooperativa. No se borra ningún dato y se puede deshacer cambiando la fecha.`, 'Cambiar')) return render();
  A.fechaAlta = nueva;
  guardarAjustes(true);
}

// --- cobrar ---
async function cobrar(id, error = '', fecha = M.hoyISO()) {
  const f = S.estado.facturas.find((x) => x.id === id);
  if (M.esAutonomo(f, S.estado.ajustes)) {       // autónomo: el neto se calcula; solo se confirma que ha entrado el total
    const x = M.desglose(f, fiscal());
    const r = await dialogo({ titulo: 'Marcar como cobrada', cuerpo: `<p>${esc(nombreCliente(f.clienteId))} · #${esc(f.n ?? '')}</p>
        ${kv('Base', x.base)}${kv(`IVA ${numEntrada(x.ivaPct)} %`, x.iva)}${kv(`Retención ${numEntrada(x.retPct)} %`, -x.retencion)}${kv('Te tiene que haber entrado', x.total, 'fuerte')}
        <label>Fecha de cobro<input type="date" name="fecha" value="${esc(fecha)}"></label>`,
      botones: [{ texto: 'Cancelar', valor: false, clase: 'sec' }, { texto: 'Cobrada', valor: true }] });
    if (!r.valor) return;
    f.estado = 'cobrada'; f.fechaCobro = r.datos.fecha || M.hoyISO(); M.tocar(f);
    await persistir(); render(); return aviso('Factura cobrada');
  }
  const r = await dialogo({ titulo: 'Marcar como cobrada', cuerpo: `<p>${esc(nombreCliente(f.clienteId))} · #${esc(f.n ?? '')} · bruto ${eur(M.bruto(f))}</p>
      <label>Neto que te ha entrado €<input name="neto" inputmode="decimal" value="${numEntrada(f.neto)}"></label>
      <label>Fecha de cobro<input type="date" name="fecha" value="${esc(fecha)}"></label>${error ? `<p class="error">${esc(error)}</p>` : ''}`,
    botones: [{ texto: 'Cancelar', valor: false, clase: 'sec' }, { texto: 'Cobrada', valor: true }] });
  if (!r.valor) return;
  const neto = leerNumero(r.datos.neto);
  if (neto == null) return cobrar(id, 'Apunta el neto que te ha entrado en el banco.', r.datos.fecha);
  f.neto = neto; f.estado = 'cobrada'; f.fechaCobro = r.datos.fecha || M.hoyISO(); M.tocar(f);
  await persistir(); render(); aviso('Factura cobrada');
}

// ---------- copias: exportar, importar, revisar ----------
async function exportarCopia() {
  const copia = await C.crearCopia(S.estado, B.claveActual(), B.kdf());
  const ok = await entregarArchivo(`copia-facturas-${M.hoyISO()}.json`, JSON.stringify(copia), 'application/json');
  if (!ok) return;
  S.local.ultimaCopia = Date.now(); await B.guardarLocal(S.local);
  render(); aviso('Copia cifrada creada');
}

async function importarArchivo(archivoElegido) {
  let o;
  try { o = JSON.parse(await archivoElegido.text()); } catch { return alerta('No se puede leer', 'El archivo no es una copia de seguridad válida.'); }
  let archivo = null, informe = null;
  if (esCopiaAntigua(o)) ({ estado: archivo, informe } = migrarCopiaV2(o));
  else if (C.esCopiaCifrada(o)) {
    if (C.mismaSal(o, B.kdf())) { try { archivo = await C.abrirCopia(o, { clave: B.claveActual() }); } catch { /* se pedirá la contraseña */ } }
    let error = '';
    while (!archivo) {
      const r = await dialogo({ titulo: 'Código de la copia', cuerpo: `<p>Escribe el código que tenía la app del otro dispositivo cuando se hizo esta copia.</p>
          ${campoClave('pw', 'Código', 'off')}${botonTeclado()}${error ? `<p class="error">${error}</p>` : ''}`,
        botones: [{ texto: 'Cancelar', valor: false, clase: 'sec' }, { texto: 'Abrir', valor: true }] });
      if (!r.valor) return;
      try { archivo = await C.abrirCopia(o, { password: r.datos.pw }); } catch { error = 'Código incorrecto.'; }
    }
    if ((archivo.esquema || 1) > M.ESQUEMA) return alerta('Copia más nueva', 'Esta copia es de una versión más reciente de la app. Actualiza la app en este dispositivo antes de importarla.');
  } else return alerta('Archivo no reconocido', 'No es una copia de esta app ni de la app anterior.');

  M.completar(archivo);
  const items = C.comparar(S.estado, archivo);
  const cambios = items.filter((i) => ['nueva', 'archivo', 'conflicto'].includes(i.caso));
  if (!cambios.length) {
    const mios = items.filter((i) => i.caso === 'local' || i.caso === 'solo_local').length;
    return alerta('Nada que importar', mios ? `La copia no trae nada nuevo. Este dispositivo tiene ${mios} registros más recientes o que no están en la copia.` : 'La copia y este dispositivo tienen lo mismo.');
  }
  S.hoja = { tipo: 'importacion', archivo, items, informe, elecciones: C.eleccionesPorDefecto(items) };
  pintarHojaImportacion();
}

function etiquetaItem(it) {
  const r = it.F && !it.F._borrado ? it.F : it.L || it.F;
  if (it.col === 'ajustes') return 'Ajustes de la app';
  if (it.col === 'clientes') return `Cliente: ${r.nombre || '(borrado)'}`;
  if (it.col === 'gastos') return `Gasto: ${r.fecha || ''} · ${r.proveedor || ''}${r.base != null ? ' · ' + eur(redondo((r.base || 0) + (r.iva || 0))) : ''}`;
  const nombres = new Map([...S.hoja.archivo.clientes, ...S.estado.clientes].map((c) => [c.id, c.nombre]));
  return `Factura #${r.n ?? '?'} · ${nombres.get(r.clienteId) || ''} · ${r.ref || ''}`;
}

function pintarHojaImportacion() {
  const { items, elecciones, archivo } = S.hoja;
  const nombres = new Map([...archivo.clientes, ...S.estado.clientes].map((c) => [c.id, c.nombre]));
  const de = (caso) => items.filter((i) => i.caso === caso);
  const val = (v) => (v === null || v === '' ? '—' : typeof v === 'number' ? numEntrada(v) : v);
  const cambios = (it) => `<ul class="dif">${C.diferencias(it.col, it.L, it.F, (id) => nombres.get(id) || '—').map((d) =>
    `<li><b>${esc(d.campo)}:</b> aquí «${esc(val(d.aqui))}» → archivo «${esc(val(d.archivo))}»</li>`).join('')}</ul>`;
  const cuando = (r) => new Date(r._mod).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const marca = (it) => `<label class="marca"><input type="checkbox" data-eleccion="${esc(it.col + ':' + it.id)}" ${elecciones[it.col + ':' + it.id] === 'archivo' ? 'checked' : ''}><span>${esc(etiquetaItem(it))}</span></label>`;

  const conf = de('conflicto'), arch = de('archivo'), nuevas = de('nueva'), mias = [...de('local'), ...de('solo_local')];
  const bloque = (titulo, ayuda, html, abierto) => html ? `<details class="grupo" ${abierto ? 'open' : ''}><summary>${titulo}</summary><p class="pie">${ayuda}</p>${html}</details>` : '';
  abrirHoja(`<header class="hoja-cab"><h2>Revisar importación</h2><button type="button" class="x" data-accion="cerrar-hoja" aria-label="Cerrar">✕</button></header>
    <p class="resumen-imp">${nuevas.length} nuevos · ${arch.length} actualizados · ${conf.length} conflictos · ${de('igual').length} iguales · ${mias.length} solo o más recientes aquí</p>
    ${bloque(`Conflictos (${conf.length})`, 'Se han cambiado en los dos dispositivos. Elige con cuál te quedas.', conf.map((it) => {
      const k = it.col + ':' + it.id;
      return `<fieldset class="conf"><legend>${esc(etiquetaItem(it))}</legend>${cambios(it)}
        <label class="marca"><input type="radio" name="${esc(k)}" value="local" data-eleccion-radio="${esc(k)}" ${elecciones[k] === 'local' ? 'checked' : ''}><span>Este dispositivo (${cuando(it.L)})</span></label>
        <label class="marca"><input type="radio" name="${esc(k)}" value="archivo" data-eleccion-radio="${esc(k)}" ${elecciones[k] === 'archivo' ? 'checked' : ''}><span>El archivo (${cuando(it.F)})</span></label></fieldset>`;
    }).join(''), true)}
    ${bloque(`Cambios que trae el archivo (${arch.length})`, 'Son más recientes en el archivo. Desmarca lo que no quieras traer.', arch.map((it) => `<div class="cambio">${marca(it)}${cambios(it)}</div>`).join(''), true)}
    ${bloque(`Nuevo en el archivo (${nuevas.length})`, 'No están en este dispositivo. Desmarca lo que no quieras traer.', nuevas.map(marca).join(''), nuevas.length <= 6)}
    ${bloque(`Se queda como está aquí (${mias.length})`, 'Solo están en este dispositivo o aquí son más recientes. La importación no los toca.', `<ul class="dif">${mias.map((it) => `<li>${esc(etiquetaItem(it))}</li>`).join('')}</ul>`, false)}
    <p class="pie">Antes de aplicar se guarda una copia automática para poder deshacerlo.</p>
    <footer class="hoja-pie"><button type="button" class="btn sec" data-accion="cerrar-hoja">Cancelar</button>
      <button type="button" class="btn" data-accion="aplicar-importacion">Aplicar</button></footer>`);
}

async function aplicarImportacion() {
  const { archivo, items, elecciones, informe } = S.hoja;
  await B.instantanea(S.estado, 'Antes de importar');
  S.estado = C.fusionar(S.estado, archivo, items, elecciones);
  await persistir();
  S.instantaneas = await B.instantaneas();
  cerrarHoja(); render();
  if (informe) await mostrarInforme(informe); else aviso('Importación aplicada');
}

/** Tras importar la copia de la app antigua: comprueba que las cifras de la app cuadran con las del archivo. */
async function mostrarInforme(inf) {
  const ids = new Set(inf.idsFacturas);
  const dentro = facturas().filter((f) => ids.has(f.id));
  const t = M.totales(dentro);
  const neto = dentro.reduce((a, f) => a + Math.round((f.neto || 0) * 100), 0) / 100;
  const descartado = inf.netosDescartados.reduce((a, x) => a + Math.round(x.neto * 100), 0) / 100;
  const fila = (et, a, b, ok, fmt = (x) => x) => `<tr><th>${et}</th><td class="num">${fmt(a)}</td><td class="num">${fmt(b)}</td><td class="${ok ? 'ok' : 'mal'}">${ok ? '✓' : '✗'}</td></tr>`;
  const netoOk = Math.abs(inf.archivo.neto - descartado - neto) < 0.005;
  const sueltos = inf.plazosSinCliente.map((p, i) => `<label>Plazo de «${esc(p.nombre)}» (${esc(M.textoPlazo(p.plazo))}): asignar a
      <select name="plazo${i}"><option value="">No asignar</option>${clientes().map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}</select></label>`).join('');
  const r = await dialogo({ titulo: 'Resultado de la importación', cuerpo: `
    <table class="control"><thead><tr><th></th><th>Archivo</th><th>App</th><th></th></tr></thead><tbody>
      ${fila('Facturas', inf.archivo.facturas, t.n, inf.archivo.facturas === t.n)}
      ${fila('Servicios', inf.archivo.servicios, t.servicios, inf.archivo.servicios === t.servicios)}
      ${fila('Importes', inf.archivo.bruto, t.bruto, Math.abs(inf.archivo.bruto - t.bruto) < 0.005, eur)}
      ${fila('Netos', inf.archivo.neto, neto, netoOk, eur)}
      ${fila('Días cotizados', inf.archivo.dias, t.dias, inf.archivo.dias === t.dias)}</tbody></table>
    ${inf.netosDescartados.length ? `<p class="pie">Neto no importado por ser mayor que el importe de la factura: ${inf.netosDescartados.map((x) => `nº ${esc(x.n)} (${eur(x.neto)})`).join(', ')}. La diferencia de netos es exactamente esa.</p>` : ''}
    ${inf.fechasPuestas ? `<p class="pie">${inf.fechasPuestas} facturas no tenían fecha de factura: llevan la de su último servicio.</p>` : ''}
    ${inf.huecos.length ? `<p class="pie">Números de factura que no existen en la copia: ${inf.huecos.join(', ')}.</p>` : ''}
    ${inf.plazosAsignados.length ? `<p class="pie">Plazos de cobro asignados: ${inf.plazosAsignados.map((x) => esc(x.cliente)).join(', ')}.</p>` : ''}
    ${sueltos}`, botones: [{ texto: 'Aceptar', valor: true }] });
  let tocado = false;
  inf.plazosSinCliente.forEach((p, i) => {
    const c = S.estado.clientes.find((x) => x.id === r.datos['plazo' + i]);
    if (c) { c.plazo = p.plazo; M.tocar(c); tocado = true; }
  });
  if (tocado) { await persistir(); render(); }
}

// ---------- acciones (data-accion) ----------
const ACCIONES = {
  ir(el) { S.vista = el.dataset.vista; S.sub = null; render(); window.scrollTo(0, 0); },
  sub(el) { S.vista = 'mas'; S.sub = el.dataset.sub || null; render(); window.scrollTo(0, 0); },
  anio(el) { S.anio = el.dataset.anio; render(); },
  'ver-anio'(el) { S.anio = el.dataset.anio; S.f = { q: '', cliente: '', estado: '' }; S.vista = 'facturas'; S.sub = null; render(); window.scrollTo(0, 0); },
  'nueva-factura'() { hojaFactura(null); },
  'abrir-factura'(el) { hojaFactura(el.dataset.id); },
  cobrar(el) { cobrar(el.dataset.id); },
  'cerrar-hoja'() { cerrarHoja(); },
  'add-servicio'() {
    const s = S.hoja.datos.servicios, ult = s[s.length - 1];
    s.push({ evento: '', mod: ult?.mod || '', fecha: ult?.fecha || M.hoyISO(), dias: 1, importe: null });
    pintarHojaFactura();
    $('#servicios .serv:last-child input').focus();
  },
  'quitar-servicio'(el) { S.hoja.datos.servicios.splice(Number(el.dataset.i), 1); pintarHojaFactura(); },
  async 'borrar-factura'() {
    const f = S.hoja.orig;
    if (!await confirmar('Borrar factura', `Se borrará la factura #${f.n ?? ''} con sus servicios.`, 'Borrar', 'peligro')) return;
    const i = S.estado.facturas.indexOf(f);
    S.estado.facturas[i] = M.tocar({ id: f.id, n: f.n, _borrado: true, _mod: f._mod, _base: f._base });
    await persistir(); cerrarHoja(); render(); aviso('Factura borrada');
  },
  'abrir-cliente'(el) { hojaCliente(el.dataset.id || null); },
  // --- autónomo ---
  imp(el) { S.imp = el.dataset.imp; render(); },
  'ir-imp'(el) { S.vista = 'impuestos'; S.sub = null; S.imp = el.dataset.imp; render(); window.scrollTo(0, 0); },
  trim(el) { S.trim = Number(el.dataset.q); render(); },
  modelo(el) { S.modelo = el.dataset.m; render(); },
  'abrir-amortizacion'(el) { editarAmortizacion(el.dataset.id || null); },
  'nuevo-gasto'() { hojaGasto(null); },
  'abrir-gasto'(el) { hojaGasto(el.dataset.id); },
  async 'borrar-gasto'() {
    const g = S.hoja.orig;
    if (!await confirmar('Borrar gasto', `Se borrará el gasto de «${g.proveedor || 'sin proveedor'}» del ${fechaCorta(g.fecha)}.`, 'Borrar', 'peligro')) return;
    const i = S.estado.gastos.indexOf(g);
    S.estado.gastos[i] = M.tocar({ id: g.id, fecha: g.fecha, proveedor: g.proveedor, _borrado: true, _mod: g._mod, _base: g._base });
    await persistir(); cerrarHoja(); render(); aviso('Gasto borrado');
  },
  /** Marca o desmarca un modelo como presentado: deja de avisar y sale de la hucha. */
  presentar(el) {
    const p = fiscal().presentados, id = el.dataset.id;
    if (p[id]) delete p[id]; else p[id] = true;
    guardarAjustes(true);
  },
  prorroga() { fiscal().prorrogaPedida = !fiscal().prorrogaPedida; guardarAjustes(true); },
  'detalle-ss'(el) {
    const r = F.ritmoSS(S.estado, el.dataset.anio), fi = fiscal(), suma = redondo(r.rendimiento + r.cuota);
    dialogo({ titulo: `Beneficio para la Seguridad Social · ${r.anio}`, cuerpo: `<p>La Seguridad Social no mira el mismo beneficio que Hacienda: le vuelve a sumar la cuota que has pagado y le descuenta un ${numEntrada(fi.genericosSSPct)} % por gastos genéricos.</p>
      ${kv('Beneficio para Hacienda', r.rendimiento)}${kv('Cuota de autónomos pagada', r.cuota)}${kv(`Descuento del ${numEntrada(fi.genericosSSPct)} %`, redondo(r.llevas - suma))}${kv('Beneficio para la Seguridad Social', r.llevas, 'fuerte')}
      ${r.cerrado || r.futuro || r.llevas === r.proyeccion ? '' : `${kv('A este ritmo, al acabar el año', r.proyeccion)}<p class="pie">«A este ritmo» reparte lo que llevas por los días que han pasado y lo alarga hasta el 31 de diciembre. Es una estimación.</p>`}
      ${kv('Salario mínimo al año', r.smi)}
      <p class="pie">El salario mínimo y el descuento se cambian en Ajustes de autónomo.</p>`, botones: [{ texto: 'Cerrar', valor: true }] });
  },
  'detalle-cuota'(el) {
    const c = F.cuotaEstimada(S.estado, el.dataset.anio), fi = fiscal();
    const tope = c.objetivo && c.objetivo.hasta != null ? redondo(c.objetivo.hasta * c.dias / 30) : null;
    dialogo({ titulo: `Cuota sin tarifa plana · ${c.anio}`, cuerpo: `<p>Sin tarifa plana pagas según tu beneficio para la Seguridad Social al mes: el del año, repartido por los días de actividad y multiplicado por 30.</p>
      ${kv('Beneficio para la Seguridad Social al año', c.anual)}${kv('Días de actividad del año', String(c.dias))}${kv('Al mes', c.mensual)}
      ${kv('Tu tramo', c.tramo.hasta == null ? 'El último de la tabla' : `hasta ${eur(c.tramo.hasta)}`)}${kv('Base mínima del tramo', c.tramo.base)}${kv('Tipo de cotización', `${numEntrada(fi.tipoCotizacionPct)} %`)}${kv('Cuota al mes', c.cuota, 'fuerte')}
      ${c.falta ? `<p>Para caer en el tramo de ${eur(c.objetivo.cuota)} (hasta ${eur(c.objetivo.hasta)} al mes), tu beneficio del año tiene que bajar a ${eur(tope)}. Cada 100 € de gasto deducible lo bajan ${numEntrada(redondo(c.porEuro * 100))} €.</p>${kv('Gasto deducible que te falta en el año', c.falta, 'fuerte')}` : ''}
      <p class="pie">Es una estimación: la Seguridad Social hace la cuenta definitiva al año siguiente con los datos de tu renta. Puedes cotizar por una base más alta que la mínima; la app no lo tiene en cuenta.</p>`, botones: [{ texto: 'Cerrar', valor: true }] });
  },
  'add-tramoc'() { fiscal().tramosCuota.push({ hasta: null, base: 0 }); guardarAjustes(true); },
  'quitar-tramoc'(el) { fiscal().tramosCuota.splice(Number(el.dataset.i), 1); guardarAjustes(true); },
  'detalle-hucha'() {
    const h = F.hucha(S.estado);
    dialogo({ titulo: 'Hucha de impuestos', cuerpo: `<p>Lo que deberías tener apartado hoy para Hacienda. Cada línea sale de la hucha cuando marcas ese modelo como presentado.</p>
      ${h.detalle.map((d) => kv(esc(d.texto), d.importe)).join('') || '<p>Ahora mismo no tienes nada que apartar.</p>'}${kv('Total', h.total, 'fuerte')}
      <p class="pie">La reserva para la renta es el ${numEntrada(fiscal().reservaRentaPct)} % del beneficio del año menos lo que ya te han retenido o has pagado con el modelo 130.</p>`, botones: [{ texto: 'Cerrar', valor: true }] });
  },
  async 'exportar-ics'() {
    const hoy = M.hoyISO(), alta = S.estado.ajustes.fechaAlta;
    const anios = [...new Set([anioFiscalElegido(), hoy.slice(0, 4)])].filter((a) => alta && a >= alta.slice(0, 4));
    const vistos = new Set();
    const pl = anios.flatMap((a) => F.plazosDelAnio(S.estado, a)).filter((p) => p.aplica && !p.presentado && p.fecha >= hoy && !vistos.has(p.id) && vistos.add(p.id));
    if (!pl.length) return alerta('Calendario', 'No hay plazos pendientes que añadir.');
    await entregarArchivo(`plazos-hacienda-${hoy}.ics`, F.aICS(pl), 'text/calendar');
  },
  'add-cuota'() {
    const c = fiscal().cuotas, ult = c[c.length - 1];
    c.push({ desde: `${Number(M.hoyISO().slice(0, 4)) + 1}-01`, importe: ult ? ult.importe : 0 });
    guardarAjustes(true);
  },
  'quitar-cuota'(el) { fiscal().cuotas.splice(Number(el.dataset.i), 1); guardarAjustes(true); },
  'abrir-categoria'(el) { editarCategoria(el.dataset.id || null); },
  'quitar-alta'() { cambiarFechaAlta(null); },
  async 'exportar-gastos-csv'() {
    if (!await confirmar('Exportar gastos a CSV', 'El CSV no va cifrado: cualquiera que tenga el archivo puede leerlo.', 'Exportar')) return;
    await entregarArchivo(`gastos-${M.hoyISO()}.csv`, gastosCSV(S.estado), 'text/csv');
  },
  async 'borrar-cliente'() {
    const c = S.hoja.orig;
    if (!await confirmar('Borrar cliente', `Se borrará «${c.nombre}».`, 'Borrar', 'peligro')) return;
    const i = S.estado.clientes.indexOf(c);
    S.estado.clientes[i] = M.tocar({ id: c.id, nombre: c.nombre, _borrado: true, _mod: c._mod, _base: c._base });
    await persistir(); cerrarHoja(); render();
  },
  'exportar-copia'() { exportarCopia(); },
  'importar-copia'() { const a = $('#archivo'); a.value = ''; a.click(); },
  'aplicar-importacion'() { aplicarImportacion(); },
  async 'exportar-csv'() {
    if (!await confirmar('Exportar a CSV', 'El CSV no va cifrado: cualquiera que tenga el archivo puede leerlo.', 'Exportar')) return;
    await entregarArchivo(`facturas-${M.hoyISO()}.csv`, aCSV(S.estado), 'text/csv');
  },
  async 'deshacer-importacion'() {
    const ult = S.instantaneas[0];
    if (!ult) return;
    if (!await confirmar('Deshacer importación', 'Todo volverá a como estaba justo antes de la última importación. Lo que hayas cambiado después se perderá.', 'Deshacer', 'peligro')) return;
    S.estado = await B.leerInstantanea(ult.ts);
    await persistir(); await B.borrarInstantanea(ult.ts);
    S.instantaneas = await B.instantaneas();
    render(); aviso('Importación deshecha');
  },
  async 'cambiar-password'(el, error = '') {
    const r = await dialogo({ titulo: 'Cambiar el código', cuerpo: `
        ${campoClave('actual', 'Código actual', 'current-password', B.esPin())}
        ${campoClave('nueva', `Código nuevo (mínimo ${MIN_CLAVE})`, 'new-password', B.esPin())}
        ${campoClave('nueva2', 'Repite el nuevo', 'new-password', B.esPin())}
        ${botonTeclado(B.esPin())}
        <p class="pie">Si lo olvidas, los datos no se pueden recuperar.</p>${error ? `<p class="error">${esc(error)}</p>` : ''}`,
      botones: [{ texto: 'Cancelar', valor: false, clase: 'sec' }, { texto: 'Cambiar', valor: true }] });
    if (!r.valor) return;
    const { actual, nueva, nueva2 } = r.datos;
    if (nueva.length < MIN_CLAVE) return ACCIONES['cambiar-password'](el, `El código nuevo necesita al menos ${MIN_CLAVE} caracteres.`);
    if (nueva !== nueva2) return ACCIONES['cambiar-password'](el, 'Los dos códigos nuevos no coinciden.');
    try { await B.cambiarPassword(actual, nueva); aviso('Código cambiado'); }
    catch { return ACCIONES['cambiar-password'](el, 'El código actual no es correcto.'); }
  },
  /** Cambia el teclado de los campos de código entre números y letras. */
  teclado(el) {
    const campos = el.closest('form, .dlg').querySelectorAll('[data-clave]');
    const aNumeros = !campos[0].hasAttribute('inputmode');
    for (const c of campos) {
      if (aNumeros) { c.setAttribute('inputmode', 'numeric'); c.setAttribute('pattern', '[0-9]*'); }
      else { c.removeAttribute('inputmode'); c.removeAttribute('pattern'); }
    }
    el.textContent = aNumeros ? 'Usar letras en vez de números' : 'Usar solo números';
    campos[0].blur(); campos[0].focus();
  },
  bloquear() { B.bloquear(); S.estado = null; cerrarHoja(); delete $('#app').dataset.vista; pantallaDesbloqueo(); },
  'detalle-comparativa'() {
    const k = M.comparativa(S.estado, S.anio);
    const hasta = k.corte === '12-31' ? 'año completo' : `hasta el ${fechaCorta(S.anio + '-' + k.corte).replace(/ \d+$/, '')}`;
    dialogo({ titulo: `${k.anio} frente a ${k.previo}`, cuerpo: `<p>Se compara lo facturado (bruto) de las facturas cobradas o pendientes de cobro, por fecha de factura, ${hasta} de cada año. Las que están sin cerrar no cuentan.</p>
      <table class="control"><tbody><tr><th>${k.anio}</th><td class="num">${eur(k.actual)}</td></tr><tr><th>${k.previo}</th><td class="num">${eur(k.anterior)}</td></tr>
      <tr><th>Diferencia</th><td class="num">${k.pct >= 0 ? '+' : ''}${k.pct.toFixed(1)} %</td></tr></tbody></table>
      <p class="pie">Se usa el bruto porque las facturas sin cobrar todavía no tienen neto.</p>`, botones: [{ texto: 'Cerrar', valor: true }] });
  },
};

// ---------- eventos (uno por tipo, delegados) ----------
const fallo = (e) => { console.error(e); aviso('Algo ha fallado: ' + (e && e.message ? e.message : e)); };

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el || el.disabled) return;
  const accion = ACCIONES[el.dataset.accion];
  if (accion) Promise.resolve().then(() => accion(el)).catch(fallo);
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && S.hoja) cerrarHoja();
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = FORMULARIOS[e.target.dataset.form];
  if (f) Promise.resolve().then(() => f(e.target)).catch(fallo);
});

function valorDe(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.tipo === 'decimal') return leerNumero(el.value);
  if (el.dataset.tipo === 'entero') { const n = leerNumero(el.value); return n == null ? null : Math.round(n); }
  return el.value;
}

document.addEventListener('input', (e) => {
  const el = e.target, h = S.hoja;
  if (h && el.dataset.campo) {
    h.datos[el.dataset.campo] = valorDe(el);
    if (h.tipo === 'factura') ajustarHojaFactura(); else if (h.tipo === 'cliente') ajustarHojaCliente(); else if (h.tipo === 'gasto') ajustarHojaGasto(el.dataset.campo);
  } else if (h && h.tipo === 'gasto' && el.dataset.et === 'grupo') {   // elegir el tipo de material pone su porcentaje
    if (el.value) { h.datos.amortPct = leerNumero(el.value); $('#capa').querySelector('[data-campo=amortPct]').value = el.value; ajustarHojaGasto(); }
  } else if (h && el.dataset.serv) {
    h.datos.servicios[Number(el.closest('.serv').dataset.i)][el.dataset.serv] = valorDe(el);
    ajustarHojaFactura();
  } else if (h && el.dataset.hoja) h[el.dataset.hoja] = el.value;
  else if (el.dataset.filtro) { S.f[el.dataset.filtro] = el.value; $('#lista-facturas').innerHTML = listaFacturas(); }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'archivo' && el.files[0]) importarArchivo(el.files[0]).catch(fallo);
  else if (el.dataset.eleccion) S.hoja.elecciones[el.dataset.eleccion] = el.checked ? 'archivo' : 'local';
  else if (el.dataset.eleccionRadio) S.hoja.elecciones[el.dataset.eleccionRadio] = el.value;
  else if (el.dataset.ajuste) {
    const n = Math.round(leerNumero(el.value) || 0);
    if (n > 0) { S.estado.ajustes[el.dataset.ajuste] = n; M.tocar(S.estado.ajustes); persistir().then(() => aviso('Guardado')).catch(fallo); }
    else el.value = S.estado.ajustes[el.dataset.ajuste];
  }
  // --- ajustes de autónomo ---
  else if (el.dataset.fiscal) {
    const n = leerNumero(el.value), k = el.dataset.fiscal;
    if (n == null || n < 0) el.value = numEntrada(fiscal()[k]);
    else { fiscal()[k] = n; guardarAjustes(k === 'tipoCotizacionPct'); }
  }
  else if (el.dataset.fiscalSel) { fiscal()[el.dataset.fiscalSel] = el.value === 'true' ? true : el.value === 'false' ? false : el.value; guardarAjustes(true); }
  else if (el.dataset.confirmar) {
    if (el.checked) fiscal().confirmados[el.dataset.confirmar] = true; else delete fiscal().confirmados[el.dataset.confirmar];
    guardarAjustes(true);
  }
  else if (el.dataset.minoracion) {
    const t = fiscal().minoracion130[Number(el.closest('.tramo').dataset.i)], n = leerNumero(el.value);
    if (n == null || n < 0) el.value = numEntrada(t[el.dataset.minoracion]); else { t[el.dataset.minoracion] = n; guardarAjustes(); }
  }
  else if (el.dataset.tramoc) {
    const fila = el.closest('.tramo'), t = fiscal().tramosCuota[Number(fila.dataset.i)], k = el.dataset.tramoc, n = leerNumero(el.value);
    if (n != null && n < 0 || (n == null && k === 'base')) el.value = numEntrada(t[k]);
    else { t[k] = n; fila.querySelector('[data-et=cuota-tramo]').textContent = `cuota ${eur(F.cuotaDeTramo(t, fiscal()))} al mes`; guardarAjustes(); }
  }
  else if (el.dataset.cuota) {
    const t = fiscal().cuotas[Number(el.closest('.tramo').dataset.i)];
    if (el.dataset.cuota === 'desde') t.desde = el.value || ''; else t.importe = Math.max(0, leerNumero(el.value) ?? 0);
    guardarAjustes();
  }
  else if ('fechaAlta' in el.dataset) cambiarFechaAlta(el.value).catch(fallo);
});

// ---------- arranque ----------
async function arrancar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try { if (await B.existe()) pantallaDesbloqueo(); else pantallaCrear(); }
  catch (e) { $('#app').innerHTML = `<div class="puerta"><h1>No se puede abrir</h1><p>Este navegador no deja guardar datos (¿modo privado?).</p><p class="error">${esc(e && e.message)}</p></div>`; }
}
arrancar();
