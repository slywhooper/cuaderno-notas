// pruebas/e2e.mjs — Prueba de la app entera en un navegador real, con dos "dispositivos" (móvil y PC).
// Uso:  PLAYWRIGHT=/ruta/a/playwright/index.mjs node pruebas/e2e.mjs <url-de-la-app> <copia-antigua.json> <carpeta-salida> ['<json de cifras esperadas>']
// Necesita Playwright y Chrome. La copia NO forma parte del repositorio: se pasa por ruta.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const [url, copiaAntigua, salida, esperado] = process.argv.slice(2);
const X = esperado ? JSON.parse(esperado) : null;
mkdirSync(salida, { recursive: true });
const navegador = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
const errores = [];
let pasos = 0;
const paso = (t) => { pasos++; console.log('  ✓', t); };

async function dispositivo(nombre, opciones) {
  const ctx = await navegador.newContext({ acceptDownloads: true, locale: 'es-ES', timezoneId: 'Europe/Madrid', ...opciones });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errores.push(`[${nombre}] ${m.text()}`); });
  p.on('pageerror', (e) => errores.push(`[${nombre}] ${e.message}`));
  await p.goto(url);
  return p;
}
const texto = (p, sel) => p.locator(sel).first().innerText();
const espera = (p, sel, re) => p.waitForFunction(([s, r]) => new RegExp(r).test((document.querySelector(s)?.innerText || '').replace(/\s+/g, ' ')), [sel, re.source], { timeout: 15000 });
const heroe = async (p, anio) => { await p.click(`[data-accion=ir][data-vista=inicio]`); await p.click(`.chip[data-anio="${anio}"]`); return (await texto(p, '.grande')).replace(/\u00a0/g, ' '); };
const nFacturas = async (p) => { await p.click('[data-accion=ir][data-vista=facturas]'); await p.click('.chip[data-anio=todo]'); return Number((await texto(p, '.cuenta')).match(/^(\d+)/)[1]); };
async function crearPassword(p, pw) { await p.fill('[name=pw]', pw); await p.fill('[name=pw2]', pw); await p.click('button[type=submit]'); await p.waitForSelector('.barra'); }
async function importar(p, ruta, password) {
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-accion=importar-copia]').first().click()]);
  await fc.setFiles(ruta);
  if (password) { await p.fill('.dlg [name=pw]', password); await p.click('.dlg-b .btn:last-child'); }
}
async function exportar(p, ruta) {
  await p.click('[data-accion=ir][data-vista=mas]'); await p.click('[data-sub=copias]');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-accion=exportar-copia]')]);
  await d.saveAs(ruta); return ruta;
}
async function editarNota(p, n, nota) {
  await p.click('[data-accion=ir][data-vista=facturas]'); await p.click('.chip[data-anio=todo]');
  await p.fill('[data-filtro=q]', '');
  await p.locator('.fila', { has: p.locator(`.nfac:text-is("#${n}")`) }).first().click();
  await p.fill('[data-campo=nota]', nota); await p.click('.hoja-pie button[type=submit]');
  await p.waitForSelector('.hoja', { state: 'detached' });
}

// ---------- Dispositivo A: móvil ----------
console.log('Móvil (A)');
const A = await dispositivo('A', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
assert.equal(await A.getAttribute('[name=pw]', 'inputmode'), 'numeric');
await A.screenshot({ path: `${salida}/00a-crear.png` });
await A.fill('[name=pw]', '123'); await A.fill('[name=pw2]', '123'); await A.click('button[type=submit]');
assert.match(await texto(A, '.error'), /al menos 4/);
await A.click('[data-accion=teclado]'); assert.equal(await A.getAttribute('[name=pw]', 'inputmode'), null);
await A.fill('[name=pw]', 'clave-movil-1'); await A.fill('[name=pw2]', 'otra-distinta'); await A.click('button[type=submit]');
assert.match(await texto(A, '.error'), /no coinciden/);
await crearPassword(A, 'clave-movil-1');
paso('código: teclado numérico por defecto, rechaza corto y distinto, admite letras, crea la bóveda');

await importar(A, copiaAntigua);
await A.waitForSelector('.resumen-imp');
const resumen = await texto(A, '.resumen-imp');
await A.waitForTimeout(350); await A.screenshot({ path: `${salida}/05-revisar-importacion.png` });
await A.click('[data-accion=aplicar-importacion]');
await A.waitForSelector('.control');
const filas = await A.locator('.control tbody tr').allInnerTexts();
assert.equal(await A.locator('.control .mal').count(), 0, 'alguna cifra de control no cuadra: ' + filas.join(' | '));
assert.equal(await A.locator('.control .ok').count(), 5);
console.log('     ', resumen, '\n     ', filas.map((f) => f.replace(/\s+/g, ' ')).join('\n      '));
await A.screenshot({ path: `${salida}/06-informe-importacion.png` });
const selPlazo = A.locator('.dlg select[name=plazo0]');
if (await selPlazo.count()) { // asigna el plazo suelto al último cliente de la lista que aún no tiene plazo (en la copia real se elige a mano)
  const destino = process.env.CLIENTE_PLAZO;
  if (destino) await selPlazo.selectOption({ label: destino });
}
await A.click('.dlg-b .btn');
paso('importa la copia antigua y las cinco cifras de control cuadran');

if (X) {
  assert.equal(await heroe(A, 'todo'), X.netoTodo); assert.equal(await heroe(A, X.anio), X.netoAnio);
  assert.match(await texto(A, '.porcobrar'), new RegExp(X.previsto.replace('.', '\\.'))); assert.match(await texto(A, '.porcobrar'), new RegExp(X.sinNeto.replace('.', '\\.')));
  assert.equal(await nFacturas(A), X.facturas);
  paso(`cifras en pantalla: neto ${X.anio} ${X.netoAnio}, todo ${X.netoTodo}, previsto ${X.previsto}, por confirmar ${X.sinNeto}`);
}
await heroe(A, String(new Date().getFullYear()));
await A.screenshot({ path: `${salida}/01-inicio.png` });
await A.screenshot({ path: `${salida}/01b-inicio-completo.png`, fullPage: true });

// Lo guardado en el dispositivo está cifrado
const crudo = await A.evaluate(() => new Promise((ok) => { const r = indexedDB.open('mis-servicios-facturas'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('boveda'); g.onsuccess = () => ok(String.fromCharCode(...g.result.ct.slice(0, 60000))); }; }));
const nombres = [...new Set(JSON.parse(readFileSync(copiaAntigua, 'utf8')).facturas.map((f) => f.cliente))];
assert.ok(crudo.length > 1000 && !nombres.some((n) => crudo.includes(n)) && !crudo.includes('servicios'));
await A.reload();
assert.equal(await A.getAttribute('[name=pw]', 'inputmode'), null); // A eligió letras
await A.fill('[name=pw]', 'no-es-esta'); await A.click('button[type=submit]');
assert.match(await texto(A, '.error'), /incorrect/);
await A.fill('[name=pw]', 'clave-movil-1'); await A.click('button[type=submit]'); await A.waitForSelector('.barra');
const total0 = await heroe(A, 'todo');
paso('datos cifrados en el dispositivo; al reabrir pide contraseña, rechaza la mala y conserva todo');

// Crear, editar, cobrar
const n0 = await nFacturas(A);
await A.click('.fab'); await A.waitForSelector('.hoja');
await A.waitForTimeout(350); await A.screenshot({ path: `${salida}/03-nueva-factura.png` });
await A.click('.hoja-pie button[type=submit]');
assert.match(await texto(A, '.hoja [data-et=error]'), /cliente/);
await A.selectOption('[data-campo=clienteId]', '__nuevo'); await A.fill('[data-hoja=clienteNuevo]', 'Cliente de prueba');
await A.fill('[data-campo=ref]', 'Prueba 1'); await A.fill('[data-serv=evento]', 'Evento de prueba'); await A.fill('[data-serv=mod]', 'Operador');
await A.fill('[data-serv=importe]', '100,50'); await A.click('[data-accion=add-servicio]');
await A.locator('.serv').nth(1).locator('[data-serv=evento]').fill('Segundo día'); await A.locator('.serv').nth(1).locator('[data-serv=importe]').fill('99,50');
assert.match((await texto(A, '.hoja [data-et=bruto]')).replace(/\u00a0/g, ' '), /200,00 €/);
await A.click('.hoja-pie button[type=submit]'); await A.waitForSelector('.hoja', { state: 'detached' });
assert.equal(await nFacturas(A), n0 + 1);
paso('crea una factura con cliente nuevo y dos servicios (bruto 200,00 €)');
await A.fill('[data-filtro=q]', 'prueba'); await A.locator('#lista-facturas .fila').first().click();
await A.selectOption('[data-campo=estado]', 'cobrada'); await A.click('.hoja-pie button[type=submit]');
assert.match(await texto(A, '.hoja [data-et=error]'), /neto/);
await A.selectOption('[data-campo=estado]', 'pendiente'); await A.fill('[data-campo=fechaFactura]', '2026-11-11');
await A.locator('.serv').nth(1).locator('[data-accion=quitar-servicio]').click();
await A.click('.hoja-pie button[type=submit]'); await A.waitForSelector('.hoja', { state: 'detached' });
assert.match((await texto(A, '#lista-facturas .fila')).replace(/\u00a0/g, ' '), /neto por confirmar[\s\S]*bruto 100,50 €/);
await A.click('#lista-facturas [data-accion=cobrar]'); await A.click('.dlg-b .btn:last-child');
assert.match(await texto(A, '.dlg .error'), /neto/);
await A.fill('.dlg [name=neto]', '81,25'); await A.click('.dlg-b .btn:last-child');
await espera(A, '#lista-facturas .fila', /Cobrada.*81,25 €/);
paso('edita, exige el neto al cobrar y la marca como cobrada (81,25 €)');
await A.screenshot({ path: `${salida}/02-facturas.png` });

// ---------- Dispositivo B: PC ----------
console.log('PC (B)');
const B = await dispositivo('B', { viewport: { width: 1280, height: 800 } });
await crearPassword(B, '4821');
await B.reload(); assert.equal(await B.getAttribute('[name=pw]', 'inputmode'), 'numeric'); // B usa código de 4 dígitos
await B.fill('[name=pw]', '4821'); await B.click('button[type=submit]'); await B.waitForSelector('.barra');
const copiaA = await exportar(A, `${salida}/copia-A.json`);
const txtCopia = readFileSync(copiaA, 'utf8');
assert.ok(!nombres.some((n) => txtCopia.includes(n)) && !txtCopia.includes('Cliente de prueba'));
await importar(B, copiaA, 'contraseña-equivocada');
assert.match(await texto(B, '.dlg .error'), /incorrect/);
await B.fill('.dlg [name=pw]', 'clave-movil-1'); await B.click('.dlg-b .btn:last-child');
await B.waitForSelector('.resumen-imp'); await B.click('[data-accion=aplicar-importacion]'); await B.waitForSelector('.hoja', { state: 'detached' });
assert.equal(await nFacturas(B), n0 + 1); assert.equal(await heroe(B, 'todo'), await heroe(A, 'todo'));
await B.screenshot({ path: `${salida}/07-pc-inicio.png` });
paso('la copia cifrada de A se abre en B con la contraseña de A; mismas facturas y mismo neto');

// Cambios cruzados: la 1 en los dos (conflicto), la 2 solo en B (actualización), la 3 solo en A
await editarNota(A, 1, 'nota desde el móvil'); await editarNota(A, 3, 'solo en el móvil');
await editarNota(B, 1, 'nota desde el PC'); await editarNota(B, 2, 'solo en el PC');
const copiaB = await exportar(B, `${salida}/copia-B.json`);
await A.click('[data-accion=ir][data-vista=mas]'); await A.click('[data-sub=copias]');
await importar(A, copiaB, '4821');
await A.waitForSelector('.resumen-imp');
assert.match(await texto(A, '.resumen-imp'), /0 nuevos · 1 actualizados · 1 conflictos/);
assert.match(await texto(A, '.conf'), /nota desde el móvil[\s\S]*nota desde el PC/);
await A.waitForTimeout(350); await A.screenshot({ path: `${salida}/08-conflicto.png` });
await A.check('.conf input[value=local]'); await A.click('[data-accion=aplicar-importacion]'); await A.waitForSelector('.hoja', { state: 'detached' });
const notas = async (p) => p.evaluate(() => null).then(async () => { const o = {}; for (const n of [1, 2, 3]) { await p.click('[data-accion=ir][data-vista=facturas]'); await p.locator('.fila', { has: p.locator(`.nfac:text-is("#${n}")`) }).first().click(); o[n] = await p.inputValue('[data-campo=nota]'); await p.click('.x'); } return o; });
assert.deepEqual(await notas(A), { 1: 'nota desde el móvil', 2: 'solo en el PC', 3: 'solo en el móvil' });
paso('fusión: detecta 1 conflicto y 1 actualización, respeta la elección y no pisa lo que solo cambió en A');

await A.click('[data-accion=ir][data-vista=mas]'); await A.click('[data-sub=copias]');
await A.click('[data-accion=deshacer-importacion]'); await A.click('.dlg-b .btn:last-child'); await espera(A, '#aviso', /deshecha/);
assert.deepEqual(await notas(A), { 1: 'nota desde el móvil', 2: '', 3: 'solo en el móvil' });
paso('deshacer la importación devuelve todo a como estaba');
await A.click('[data-accion=ir][data-vista=mas]'); await A.click('[data-sub=copias]');
await importar(A, copiaB, '4821'); await A.waitForSelector('.resumen-imp');
await A.check('.conf input[value=local]'); await A.click('[data-accion=aplicar-importacion]'); await A.waitForSelector('.hoja', { state: 'detached' });

const copiaA2 = await exportar(A, `${salida}/copia-A2.json`);
await B.click('[data-accion=ir][data-vista=mas]'); await B.click('[data-sub=copias]');
await importar(B, copiaA2, 'clave-movil-1'); await B.waitForSelector('.resumen-imp');
assert.match(await texto(B, '.resumen-imp'), /0 nuevos · 2 actualizados · 0 conflictos/);
await B.click('[data-accion=aplicar-importacion]'); await B.waitForSelector('.hoja', { state: 'detached' });
assert.deepEqual(await notas(B), await notas(A));
assert.equal(await nFacturas(B), await nFacturas(A)); assert.equal(await heroe(B, 'todo'), await heroe(A, 'todo'));
await B.click('[data-accion=ir][data-vista=mas]'); await B.click('[data-sub=copias]');
await importar(B, copiaA2, 'clave-movil-1');
assert.match(await texto(B, '.dlg'), /Nada que importar/); await B.click('.dlg-b .btn');
paso('ida y vuelta completa: A y B acaban idénticos, sin pérdidas ni duplicados; reimportar no cambia nada');

// Borrar, CSV, cambio de contraseña, sin internet
await A.click('[data-accion=ir][data-vista=facturas]'); await A.fill('[data-filtro=q]', 'prueba'); await A.locator('#lista-facturas .fila').first().click();
await A.click('[data-accion=borrar-factura]'); await A.click('.dlg-b .btn:last-child'); await A.waitForSelector('.hoja', { state: 'detached' });
await A.fill('[data-filtro=q]', '');
assert.equal(await nFacturas(A), n0); assert.equal(await heroe(A, 'todo'), total0);
paso('borrar la factura de prueba devuelve los totales al valor inicial');

await A.click('[data-accion=ir][data-vista=mas]'); await A.screenshot({ path: `${salida}/04-mas.png` });
await A.click('[data-sub=resumen]'); await A.screenshot({ path: `${salida}/04b-resumen.png` });
await A.click('[data-accion=sub][data-sub=""]'); await A.click('[data-sub=clientes]'); await A.screenshot({ path: `${salida}/04c-clientes.png` });
await A.click('[data-accion=sub][data-sub=""]'); await A.click('[data-sub=copias]'); await A.screenshot({ path: `${salida}/04d-copias.png` });
await A.click('[data-accion=exportar-csv]');
const [csv] = await Promise.all([A.waitForEvent('download'), A.click('.dlg-b .btn:last-child')]);
await csv.saveAs(`${salida}/facturas.csv`);
const lineas = readFileSync(`${salida}/facturas.csv`, 'utf8').trim().split('\r\n');
if (X) assert.equal(lineas.length, 1 + X.servicios);
paso(`CSV: ${lineas.length - 1} filas de servicios`);

await A.click('[data-accion=sub][data-sub=""]'); await A.click('[data-sub=seguridad]'); await A.click('[data-accion=cambiar-password]');
await A.fill('.dlg [name=actual]', 'mala'); await A.fill('.dlg [name=nueva]', 'clave-nueva-33'); await A.fill('.dlg [name=nueva2]', 'clave-nueva-33'); await A.click('.dlg-b .btn:last-child');
assert.match(await texto(A, '.dlg .error'), /actual no es correct/);
await A.fill('.dlg [name=actual]', 'clave-movil-1'); await A.fill('.dlg [name=nueva]', 'clave-nueva-33'); await A.fill('.dlg [name=nueva2]', 'clave-nueva-33'); await A.click('.dlg-b .btn:last-child');
await espera(A, '#aviso', /Código cambiado/);
await A.waitForSelector('.dlg', { state: 'detached' });
await A.evaluate(() => navigator.serviceWorker.ready);
await A.context().setOffline(true);
await A.reload(); await A.waitForSelector('.puerta');
await A.fill('[name=pw]', 'clave-movil-1'); await A.click('button[type=submit]'); assert.match(await texto(A, '.error'), /incorrect/);
await A.fill('[name=pw]', 'clave-nueva-33'); await A.click('button[type=submit]'); await A.waitForSelector('.barra');
assert.equal(await heroe(A, 'todo'), total0);
await A.click('[data-accion=ir][data-vista=mas]'); await A.click('[data-sub=copias]');
await A.click('[data-accion=deshacer-importacion]'); await A.click('.dlg-b .btn:last-child'); await espera(A, '#aviso', /deshecha/);
paso('cambia la contraseña; SIN INTERNET la app abre, desbloquea con la nueva y las copias automáticas siguen sirviendo');
await A.click('[data-accion=ir][data-vista=mas]'); await A.click('[data-sub=seguridad]'); await A.click('[data-accion=bloquear]'); await A.waitForSelector('.puerta');
await A.screenshot({ path: `${salida}/00-desbloqueo.png` });

await navegador.close();
assert.deepEqual(errores, [], 'errores en la consola del navegador');
console.log(`\n${pasos} pasos correctos, sin errores en la consola`);
