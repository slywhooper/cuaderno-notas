// almacen.js — Almacén clave/valor sobre IndexedDB. Es lo único que toca el disco del dispositivo.
// Claves usadas: 'meta' (sal e iteraciones), 'boveda' (datos cifrados), 'inst:<ts>' (copias automáticas
// cifradas) y 'local' (datos no sensibles de este dispositivo: fecha de la última copia).

const BD = 'mis-servicios-facturas';
const ALM = 'kv';

function abrirBD() {
  return new Promise((ok, ko) => {
    const p = indexedDB.open(BD, 1);
    p.onupgradeneeded = () => p.result.createObjectStore(ALM);
    p.onsuccess = () => ok(p.result);
    p.onerror = () => ko(p.error);
  });
}

async function transaccion(modo, fn) {
  const bd = await abrirBD();
  return new Promise((ok, ko) => {
    const t = bd.transaction(ALM, modo);
    const pet = fn(t.objectStore(ALM));
    t.oncomplete = () => { bd.close(); ok(pet ? pet.result : undefined); };
    t.onerror = t.onabort = () => { bd.close(); ko(t.error); };
  });
}

export const leer = (k) => transaccion('readonly', (s) => s.get(k));
export const guardar = (k, v) => transaccion('readwrite', (s) => { s.put(v, k); });
export const borrar = (k) => transaccion('readwrite', (s) => { s.delete(k); });
export const claves = () => transaccion('readonly', (s) => s.getAllKeys());

/** Guarda y borra varias claves en UNA sola transacción (o se hace todo o no se hace nada). */
export const guardarVarios = (poner, quitar = []) => transaccion('readwrite', (s) => {
  for (const [k, v] of Object.entries(poner)) s.put(v, k);
  for (const k of quitar) s.delete(k);
});
