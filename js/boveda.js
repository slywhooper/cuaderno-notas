// boveda.js — La "bóveda": todos los datos de la app en un único bloque cifrado dentro de IndexedDB.
// Cada guardado vuelve a cifrar el bloque entero (los datos son pequeños, así que es rápido y atómico).

import * as A from './almacen.js';
import { derivarClave, cifrar, descifrar, aleatorio, KDF_ITER } from './cripto.js';

let clave = null; // CryptoKey en memoria; null = app bloqueada
let meta = null;  // { v, sal, iter }

const MAX_INSTANTANEAS = 5;

export async function existe() { meta = await A.leer('meta'); return !!meta; }
export const claveActual = () => clave;
export const kdf = () => ({ sal: meta.sal, iter: meta.iter });
export function bloquear() { clave = null; }
/** ¿El código es solo de números? (para mostrar el teclado numérico al desbloquear) */
export const esPin = () => !!meta && meta.pin === true;
const soloDigitos = (p) => /^\d+$/.test(p);

/** Primera vez: crea la bóveda con la contraseña elegida. */
export async function crear(password, estado) {
  const m = { v: 1, sal: aleatorio(16), iter: KDF_ITER, pin: soloDigitos(password) };
  const k = await derivarClave(password, m.sal, m.iter);
  await A.guardarVarios({ meta: m, boveda: await cifrar(k, estado) });
  meta = m; clave = k;
}

/** Desbloquea. Lanza un error si la contraseña no es correcta. */
export async function abrir(password) {
  meta = meta || await A.leer('meta');
  const k = await derivarClave(password, meta.sal, meta.iter);
  const estado = await descifrar(k, await A.leer('boveda'));
  clave = k;
  return estado;
}

export async function guardarEstado(estado) {
  if (!clave) throw new Error('La app está bloqueada');
  await A.guardar('boveda', await cifrar(clave, estado));
}

/** Cambia la contraseña: vuelve a cifrar la bóveda y las copias automáticas en una sola transacción. */
export async function cambiarPassword(actual, nueva) {
  const kVieja = await derivarClave(actual, meta.sal, meta.iter);
  const estado = await descifrar(kVieja, await A.leer('boveda')); // lanza si "actual" no es correcta
  const m = { v: 1, sal: aleatorio(16), iter: KDF_ITER, pin: soloDigitos(nueva) };
  const kNueva = await derivarClave(nueva, m.sal, m.iter);
  const poner = { meta: m, boveda: await cifrar(kNueva, estado) };
  const quitar = [];
  for (const k of (await A.claves()).filter((x) => String(x).startsWith('inst:'))) {
    const inst = await A.leer(k);
    try { poner[k] = { ...inst, caja: await cifrar(kNueva, await descifrar(kVieja, inst.caja)) }; }
    catch { quitar.push(k); }
  }
  await A.guardarVarios(poner, quitar);
  meta = m; clave = kNueva;
}

/** Copia automática cifrada del estado (se hace antes de cada importación para poder deshacerla). */
export async function instantanea(estado, motivo) {
  const ts = Date.now();
  await A.guardar('inst:' + ts, { ts, motivo, caja: await cifrar(clave, estado) });
  const todas = (await A.claves()).filter((x) => String(x).startsWith('inst:')).sort();
  for (const k of todas.slice(0, Math.max(0, todas.length - MAX_INSTANTANEAS))) await A.borrar(k);
}

export async function instantaneas() {
  const ks = (await A.claves()).filter((x) => String(x).startsWith('inst:')).sort().reverse();
  const out = [];
  for (const k of ks) { const i = await A.leer(k); out.push({ ts: i.ts, motivo: i.motivo }); }
  return out;
}

export async function leerInstantanea(ts) { return descifrar(clave, (await A.leer('inst:' + ts)).caja); }
export async function borrarInstantanea(ts) { await A.borrar('inst:' + ts); }

/** Datos no sensibles de este dispositivo (no se cifran ni viajan en las copias). */
export async function local() { return (await A.leer('local')) || {}; }
export async function guardarLocal(o) { await A.guardar('local', o); }
