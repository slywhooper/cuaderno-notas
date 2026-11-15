// copias.js — Copias de seguridad cifradas y fusión entre dispositivos (móvil <-> PC, a mano).
//
// Archivo de copia: JSON con los datos cifrados dentro (AES-GCM) y lo necesario para abrirlo con la contraseña.
//
// Fusión: cada registro lleva _mod (última modificación) y _base (el _mod de la última versión compartida).
//   L = registro de este dispositivo, F = registro del archivo.
//     L._mod === F._mod  -> igual
//     F._base === L._mod -> el archivo parte de mi versión: el archivo es más nuevo
//     L._base === F._mod -> yo parto de la versión del archivo: lo mío es más nuevo
//     un lado sin tocar desde que se compartió (_mod === _base) -> gana el más reciente
//     cualquier otro caso -> se ha tocado en los dos lados: CONFLICTO, decide el usuario

import { aB64, deB64, derivarClave, cifrar, descifrar } from './cripto.js';
import { ESTADOS, bruto, textoPlazo } from './modelo.js';

const COLECCIONES = ['clientes', 'facturas', 'gastos', 'ayudas'];

export const esCopiaCifrada = (o) => !!o && o.app === 'mis-servicios-facturas' && o.tipo === 'copia-cifrada' && !!o.datos;

/** Crea el contenido del archivo de copia con la clave de la sesión (misma contraseña que la app). */
export async function crearCopia(estado, clave, kdf) {
  const caja = await cifrar(clave, estado);
  return {
    app: 'mis-servicios-facturas', tipo: 'copia-cifrada', version: 1, creada: new Date().toISOString(),
    kdf: { algoritmo: 'PBKDF2-SHA256', iter: kdf.iter, sal: aB64(kdf.sal) },
    cifrado: 'AES-GCM-256', iv: aB64(caja.iv), datos: aB64(caja.ct),
  };
}

/** ¿La copia se cifró con la misma sal que este dispositivo? Entonces vale la clave de la sesión. */
export const mismaSal = (copia, kdf) => copia.kdf.sal === aB64(kdf.sal) && copia.kdf.iter === kdf.iter;

/** Abre una copia con una clave ya derivada o con la contraseña. Lanza un error si no es la correcta. */
export async function abrirCopia(copia, { clave, password }) {
  const k = clave || await derivarClave(password, deB64(copia.kdf.sal), copia.kdf.iter);
  return descifrar(k, { iv: deB64(copia.iv), ct: deB64(copia.datos) });
}

const sinMarcas = (r) => { const { _mod, _base, ...resto } = r; return resto; };
const estable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((c) => [c, x[c]])) : x));

export function casoDe(L, F) {
  if (!F) return 'solo_local';
  if (!L) return F._borrado ? 'igual' : 'nueva';
  if (L._mod === F._mod) return 'igual';
  if (F._base === L._mod) return 'archivo';
  if (L._base === F._mod) return 'local';
  if (estable(sinMarcas(L)) === estable(sinMarcas(F))) return 'igual';
  // Uno de los dos lados no se ha tocado desde la última vez que se compartió (_mod === _base): no hay nada
  // que perder en ese lado, así que gana el más reciente sin molestar con un conflicto. Sin esto, un registro
  // creado en un dispositivo y editado después solo allí aparecía como conflicto en el otro.
  if (L._mod === L._base) return F._mod > L._mod ? 'archivo' : 'local';
  if (F._mod === F._base && L._mod > F._mod) return 'local';
  return 'conflicto';
}

/** Compara el estado de este dispositivo con el de un archivo. Devuelve una lista de { col, id, caso, L, F }. */
export function comparar(local, archivo) {
  const items = [];
  for (const col of COLECCIONES) {
    const ml = new Map((local[col] || []).map((r) => [r.id, r]));
    const mf = new Map((archivo[col] || []).map((r) => [r.id, r]));
    for (const [id, F] of mf) items.push({ col, id, caso: casoDe(ml.get(id), F), L: ml.get(id) || null, F });
    for (const [id, L] of ml) if (!mf.has(id)) items.push({ col, id, caso: 'solo_local', L, F: null });
  }
  if (archivo.ajustes) items.push({ col: 'ajustes', id: 'ajustes', caso: casoDe(local.ajustes, archivo.ajustes), L: local.ajustes, F: archivo.ajustes });
  return items;
}

/** Elección por defecto de cada cambio: lo nuevo y lo más reciente del archivo entran; en conflicto, lo más reciente. */
export function eleccionesPorDefecto(items) {
  const e = {};
  for (const it of items) {
    if (it.caso === 'nueva' || it.caso === 'archivo') e[it.col + ':' + it.id] = 'archivo';
    if (it.caso === 'conflicto') e[it.col + ':' + it.id] = it.F._mod > it.L._mod ? 'archivo' : 'local';
  }
  return e;
}

/** Aplica las elecciones ('archivo' | 'local') y devuelve el estado nuevo. No modifica el estado recibido. */
export function fusionar(local, archivo, items, elecciones) {
  const out = structuredClone(local);
  const ahora = Date.now();
  for (const it of items) {
    if (!['nueva', 'archivo', 'conflicto'].includes(it.caso)) continue;
    const elige = elecciones[it.col + ':' + it.id] || 'local';
    const delArchivo = () => ({ ...structuredClone(it.F), _base: it.F._mod });
    if (it.col === 'ajustes') {
      if (elige === 'archivo') out.ajustes = delArchivo();
      else { out.ajustes._base = it.F._mod; out.ajustes._mod = Math.max(ahora, out.ajustes._mod + 1, it.F._mod + 1); }
      continue;
    }
    const lista = out[it.col] || (out[it.col] = []);
    const i = lista.findIndex((r) => r.id === it.id);
    if (elige === 'archivo') { if (i >= 0) lista[i] = delArchivo(); else lista.push(delArchivo()); }
    else if (i >= 0) { // me quedo con lo mío: queda como versión posterior a la del archivo
      lista[i]._base = it.F._mod;
      lista[i]._mod = Math.max(ahora, lista[i]._mod + 1, it.F._mod + 1);
    }
  }
  // Ninguna factura puede quedarse sin su cliente.
  const ids = new Set(out.clientes.map((c) => c.id));
  for (const f of out.facturas) {
    if (f._borrado || !f.clienteId || ids.has(f.clienteId)) continue;
    const c = (archivo.clientes || []).find((x) => x.id === f.clienteId);
    if (c) { out.clientes.push({ ...structuredClone(c), _base: c._mod }); ids.add(c.id); }
  }
  return out;
}

const ETIQUETAS_AJUSTES = {
  fechaAlta: 'Fecha de alta como autónomo', avisoCopiaDias: 'Aviso de copia (días)', 'fiscal.epigrafe': 'Epígrafe', 'fiscal.regimenIva': 'Régimen de IVA',
  'fiscal.ivaPct': 'IVA %', 'fiscal.retencionPct': 'Retención %', 'fiscal.pagoFraccionadoPct': 'Modelo 130 %', 'fiscal.umbralRetenidoPct': 'Mínimo con retención %',
  'fiscal.umbral347': 'Importe del modelo 347', 'fiscal.reservaRentaPct': 'Reserva para la renta %', 'fiscal.subidaSimPct': 'Subida de tarifa en simulación %',
  'fiscal.avisoPlazoDias': 'Aviso de plazos (días)', 'fiscal.diaTrimestre': 'Último día trimestral', 'fiscal.diaEnero': 'Último día de enero',
  'fiscal.umbralInversionIva': 'Importe de bien de inversión (IVA)', 'fiscal.difJustPct': 'Gastos de difícil justificación %', 'fiscal.difJustMax': 'Tope de difícil justificación',
  'fiscal.minoracion130': 'Minoración del modelo 130', 'fiscal.reduccionInicio': 'Reducción por inicio de actividad', 'fiscal.reduccionInicioPct': 'Reducción por inicio %',
  'fiscal.amortizaciones': 'Tabla de amortización', 'fiscal.amortizacionLibreMax': 'Material como gasto normal hasta',
  'fiscal.tarifaPlanaMeses': 'Meses de tarifa plana', 'fiscal.prorrogaMeses': 'Meses de prórroga', 'fiscal.smiAnual': 'Salario mínimo al año',
  'fiscal.genericosSSPct': 'Descuento de gastos genéricos %', 'fiscal.prorrogaPedida': 'Prórroga de la tarifa plana pedida', 'fiscal.avisoTarifaDias': 'Aviso de tarifa plana (días)',
  'fiscal.tipoCotizacionPct': 'Tipo de cotización %', 'fiscal.limiteCuota': 'Límite de cuota al mes', 'fiscal.diaCargoCuota': 'Día de cargo de la cuota', 'fiscal.tramosCuota': 'Tabla de tramos de cuota',
  'fiscal.cuotas': 'Cuota de autónomos', 'fiscal.categorias': 'Categorías de gasto', 'fiscal.confirmados': 'Valores confirmados', 'fiscal.presentados': 'Modelos presentados',
};

/** Lista legible de lo que cambia entre la versión de aquí (L) y la del archivo (F). */
export function diferencias(col, L, F, nombreCliente = (id) => id) {
  const d = [];
  const par = (campo, aqui, archivo) => { if ((aqui ?? null) !== (archivo ?? null)) d.push({ campo, aqui: aqui ?? null, archivo: archivo ?? null }); };
  if (L._borrado || F._borrado) { par('Situación', L._borrado ? 'borrada' : 'existe', F._borrado ? 'borrada' : 'existe'); return d; }
  if (col === 'facturas') {
    par('Nº', L.n, F.n); par('Cliente', nombreCliente(L.clienteId), nombreCliente(F.clienteId)); par('Referencia', L.ref, F.ref);
    par('Estado', ESTADOS[L.estado], ESTADOS[F.estado]); par('Fecha de factura', L.fechaFactura, F.fechaFactura);
    par('Fecha de cobro', L.fechaCobro, F.fechaCobro); par('Neto', L.neto, F.neto); par('Días cotizados', L.diasSS, F.diasSS);
    par('Nota', L.nota, F.nota); par('Nº de servicios', L.servicios.length, F.servicios.length); par('Importe', bruto(L), bruto(F));
    par('IVA %', L.ivaPct, F.ivaPct); par('Retención %', L.retPct, F.retPct);
    if (!d.length && estable(L.servicios) !== estable(F.servicios)) d.push({ campo: 'Servicios', aqui: 'distintos', archivo: 'distintos' });
  } else if (col === 'clientes') {
    par('Nombre', L.nombre, F.nombre); par('Plazo de cobro', textoPlazo(L.plazo), textoPlazo(F.plazo));
  } else if (col === 'gastos') {
    par('Fecha', L.fecha, F.fecha); par('Proveedor', L.proveedor, F.proveedor); par('Nº de factura', L.numFactura, F.numFactura);
    par('Categoría', L.categoria, F.categoria); par('Base', L.base, F.base); par('IVA', L.iva, F.iva);
    par('% deducible IVA', L.dedIva, F.dedIva); par('% deducible IRPF', L.dedIrpf, F.dedIrpf);
    par('Justificante guardado', L.justificante ? 'sí' : 'no', F.justificante ? 'sí' : 'no'); par('Nota', L.nota, F.nota);
    par('Se amortiza', L.amortiza ? 'sí' : 'no', F.amortiza ? 'sí' : 'no'); par('Amortización al año %', L.amortPct, F.amortPct);
  } else if (col === 'ayudas') {
    par('Fecha', L.fecha, F.fecha); par('Concepto', L.concepto, F.concepto); par('Importe', L.importe, F.importe);
    par('Cuenta para la Seguridad Social', L.cuentaSS === false ? 'no' : 'sí', F.cuentaSS === false ? 'no' : 'sí');
  } else {
    // Ajustes: los sencillos se comparan tal cual; los fiscales, uno a uno (las listas, como «cambiado»).
    const texto = (v) => (v !== null && typeof v === 'object' ? estable(v) : v ?? null);
    const plano = (a) => { const { fiscal, ...resto } = sinMarcas(a); return { ...resto, ...Object.fromEntries(Object.entries(fiscal || {}).map(([k, v]) => ['fiscal.' + k, v])) }; };
    const l = plano(L), f = plano(F);
    for (const k of new Set([...Object.keys(l), ...Object.keys(f)])) {
      if (texto(l[k]) === texto(f[k])) continue;
      const lista = (l[k] !== null && typeof l[k] === 'object') || (f[k] !== null && typeof f[k] === 'object');
      d.push({ campo: ETIQUETAS_AJUSTES[k] || k, aqui: lista ? 'distinto' : l[k] ?? null, archivo: lista ? 'distinto' : f[k] ?? null });
    }
  }
  return d;
}
