// cripto.js — Cifrado con la Web Crypto del navegador (sin librerías).
// Contraseña -> PBKDF2-SHA256 -> clave AES-GCM de 256 bits.
// La clave nunca se guarda: solo vive en memoria mientras la app está desbloqueada.

export const KDF_ITER = 600000; // iteraciones de PBKDF2 (valor recomendado por OWASP para SHA-256)

const codif = new TextEncoder();
const decodif = new TextDecoder();

export const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));

export function aB64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function deB64(txt) {
  const bin = atob(txt);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

/** Deriva la clave AES a partir de la contraseña y una sal. */
export async function derivarClave(password, sal, iter = KDF_ITER) {
  const base = await crypto.subtle.importKey('raw', codif.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Cifra cualquier objeto JSON. Devuelve { iv, ct } (Uint8Array). */
export async function cifrar(clave, objeto) {
  const iv = aleatorio(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, codif.encode(JSON.stringify(objeto)));
  return { iv, ct: new Uint8Array(ct) };
}

/** Descifra { iv, ct }. Lanza un error si la clave (contraseña) no es la correcta o el dato se ha alterado. */
export async function descifrar(clave, caja) {
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: caja.iv }, clave, caja.ct);
  return JSON.parse(decodif.decode(claro));
}
