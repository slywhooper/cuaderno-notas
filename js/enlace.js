// enlace.js — Enlace de solo lectura: enseñar la app a otra persona sin pasarle una copia.
//
// Los datos van DENTRO del propio enlace, en la parte que sigue a «#». Esa parte no viaja al servidor: solo la lee la
// app en el navegador de quien abre el enlace. Van reducidos (solo lo necesario para ver), comprimidos y cifrados con
// un código (PBKDF2 -> AES-GCM, igual que las copias). Quien abre el enlace escribe el código y ve la app en memoria:
// no se guarda nada en su dispositivo y no puede cambiar nada (ver «solo lectura» en app.js).
//
// OJO: quien tenga el enlace Y el código ve todos los datos incluidos, y un enlace ya enviado no se puede anular.
//
// Formato: #v1.<base64url de: sal (16) + iv (12) + AES-GCM( deflate-raw( JSON reducido ) )>
// JSON reducido (reducir()): { v, f, an, al, fi, c, x, g, y }
//   f = fecha en que se creó · an = año incluido (0 = todos) · al = fecha de alta (0 = sin alta)
//   fi = solo los ajustes fiscales que difieren de los de partida
//   c = clientes [nombre, plazo]            plazo: 0 | [dias] | [desde, hasta]
//   x = facturas [n, ref, índice de cliente, estado (a|p|c), fechaFactura, fechaCobro, neto, diasSS, nota, fechaEstimada,
//                 [[evento, mod, fecha, dias, importe]...], ivaPct, retPct]
//   g = gastos   [fecha, proveedor, numFactura, categoria, base, ivaPct, iva, dedIva, dedIrpf, justificante, nota, amortiza, amortPct]
//   y = ayudas   [fecha, concepto, importe, cuentaSS]
// Si cambia la forma de los datos, añade el campo aquí (reducir y ampliar) y sube el prefijo a v2 solo si deja de leerse lo antiguo.

import { vivos, completar, estadoVacio, fiscalPorDefecto, anioDe, hoyISO } from './modelo.js';
import { derivarClave, aleatorio } from './cripto.js';

const PREFIJO = '#v1.';
const ESTADOS = { a: 'abierta', p: 'pendiente', c: 'cobrada' };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** ¿Es un enlace de solo lectura? (lo que hay en location.hash) */
export const esEnlace = (hash) => typeof hash === 'string' && hash.startsWith(PREFIJO) && hash.length > PREFIJO.length + 40;

/** Deja el estado en lo mínimo para verlo. Con `anio`, solo las facturas, gastos y ayudas de ese año (y el material de años anteriores que aún se amortiza). */
export function reducir(estado, anio = null, hoy = hoyISO()) {
  const def = fiscalPorDefecto(), a = anio ? String(anio) : null;
  const fi = Object.fromEntries(Object.entries(estado.ajustes.fiscal || {}).filter(([k, v]) => !igual(v, def[k])));
  const facturas = vivos(estado.facturas).filter((f) => !a || anioDe(f) === a);
  const usados = new Set(facturas.map((f) => f.clienteId));
  const clientes = vivos(estado.clientes).filter((c) => !a || usados.has(c.id));
  const idx = new Map(clientes.map((c, i) => [c.id, i]));
  const r = {
    v: 1, f: hoy, an: a || 0, al: estado.ajustes.fechaAlta || 0, fi,
    c: clientes.map((c) => [c.nombre, !c.plazo ? 0 : c.plazo.tipo === 'dias' ? [c.plazo.dias || 0] : [c.plazo.desde, c.plazo.hasta ?? c.plazo.desde]]),
    x: facturas.map((f) => [f.n ?? null, f.ref || '', idx.has(f.clienteId) ? idx.get(f.clienteId) : -1, (f.estado || 'a')[0], f.fechaFactura || 0, f.fechaCobro || 0,
      f.neto ?? null, f.diasSS ?? null, f.nota || 0, f.fechaEstimada ? 1 : 0,
      f.servicios.map((s) => [s.evento || '', s.mod || '', s.fecha || 0, s.dias ?? null, s.importe ?? null]), f.ivaPct ?? null, f.retPct ?? null]),
  };
  const gastos = vivos(estado.gastos || []).filter((g) => !a || (g.fecha || '').slice(0, 4) === a || (g.amortiza && (g.fecha || '9') .slice(0, 4) < a));
  if (gastos.length) r.g = gastos.map((g) => [g.fecha || 0, g.proveedor || '', g.numFactura || '', g.categoria || '', g.base ?? 0, g.ivaPct ?? 0, g.iva ?? 0, g.dedIva ?? 0, g.dedIrpf ?? 0,
    g.justificante ? 1 : 0, g.nota || 0, g.amortiza ? 1 : 0, g.amortiza ? g.amortPct ?? 0 : null]);
  const ayudas = vivos(estado.ayudas || []).filter((y) => !a || (y.fecha || '').slice(0, 4) === a);
  if (ayudas.length) r.y = ayudas.map((y) => [y.fecha || 0, y.concepto || '', y.importe ?? 0, y.cuentaSS === false ? 0 : 1]);
  return r;
}

/** Lo contrario de reducir(): un estado completo que la app puede enseñar. */
export function ampliar(r) {
  if (!r || r.v !== 1 || !Array.isArray(r.x) || !Array.isArray(r.c)) throw new Error('enlace no válido');
  const e = estadoVacio(), marcas = { _mod: 1, _base: 1 };
  e.ajustes.fechaAlta = r.al || null;
  e.ajustes.fiscal = { ...e.ajustes.fiscal, ...(r.fi || {}) };
  e.clientes = r.c.map(([nombre, p], i) => ({ id: 'c' + i, nombre, plazo: !p ? null : p.length === 1 ? { tipo: 'dias', dias: p[0] } : { tipo: 'mes', desde: p[0], hasta: p[1] }, ...marcas }));
  e.facturas = r.x.map(([n, ref, ci, est, fechaFactura, fechaCobro, neto, diasSS, nota, estimada, servicios, ivaPct, retPct], i) => {
    const f = { id: 'f' + i, n, ref, clienteId: ci >= 0 ? 'c' + ci : null, estado: ESTADOS[est] || 'abierta', fechaFactura: fechaFactura || null, fechaCobro: fechaCobro || null,
      neto, diasSS, nota: nota || '', servicios: (servicios || []).map(([evento, mod, fecha, dias, importe]) => ({ evento, mod, fecha: fecha || null, dias, importe })), ...marcas };
    if (estimada) f.fechaEstimada = true;
    if (ivaPct != null) f.ivaPct = ivaPct;
    if (retPct != null) f.retPct = retPct;
    return f;
  });
  e.gastos = (r.g || []).map(([fecha, proveedor, numFactura, categoria, base, ivaPct, iva, dedIva, dedIrpf, justificante, nota, amortiza, amortPct], i) => {
    const g = { id: 'g' + i, fecha: fecha || null, proveedor, numFactura, categoria, base, ivaPct, iva, dedIva, dedIrpf, justificante: !!justificante, nota: nota || '', ...marcas };
    if (amortiza) { g.amortiza = true; g.amortPct = amortPct; }
    return g;
  });
  e.ayudas = (r.y || []).map(([fecha, concepto, importe, cuentaSS], i) => ({ id: 'y' + i, fecha: fecha || null, concepto, importe, cuentaSS: !!cuentaSS, ...marcas }));
  return completar(e);
}

// --- comprimir, cifrar y pasar a texto de enlace ---
const tubo = async (bytes, paso) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(paso)).arrayBuffer());
function aTexto(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function aBytes(txt) {
  const bin = atob(txt.replace(/-/g, '+').replace(/_/g, '/'));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

/** Crea el enlace completo: `base` (la dirección de la app) + # + los datos cifrados con `codigo`. */
export async function crearEnlace(estado, codigo, { anio = null, base = '', hoy = hoyISO() } = {}) {
  const plano = await tubo(new TextEncoder().encode(JSON.stringify(reducir(estado, anio, hoy))), new CompressionStream('deflate-raw'));
  const sal = aleatorio(16), iv = aleatorio(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derivarClave(codigo, sal), plano));
  const todo = new Uint8Array(28 + ct.length);
  todo.set(sal, 0); todo.set(iv, 16); todo.set(ct, 28);
  return base + PREFIJO + aTexto(todo);
}

/** Abre un enlace con su código. Devuelve { estado, fecha, anio }. Lanza un error si el código no es el suyo o el enlace está cortado o alterado. */
export async function abrirEnlace(hash, codigo) {
  if (!esEnlace(hash)) throw new Error('enlace no válido');
  const todo = aBytes(hash.slice(PREFIJO.length));
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: todo.subarray(16, 28) }, await derivarClave(codigo, todo.subarray(0, 16)), todo.subarray(28));
  const r = JSON.parse(new TextDecoder().decode(await tubo(new Uint8Array(claro), new DecompressionStream('deflate-raw'))));
  return { estado: ampliar(r), fecha: r.f || null, anio: r.an || null };
}
