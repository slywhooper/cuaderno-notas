// pruebas/e2e-autonomo.mjs — Prueba en navegador de la parte de autónomo (fase 2), con dos "dispositivos".
// Uso:  PLAYWRIGHT=/ruta/a/playwright/index.mjs node pruebas/e2e-autonomo.mjs <url-de-la-app> <copia-antigua.json> <carpeta-salida>
// Las cifras esperadas no van escritas: se calculan aquí con los mismos módulos de lógica (ya probados en logica.mjs)
// y se comparan con lo que enseña la pantalla. La copia NO forma parte del repositorio: se pasa por ruta.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import * as M from '../js/modelo.js';
import * as F from '../js/fiscal.js';
import * as MO from '../js/modelos.js';
import { migrarCopiaV2 } from '../js/migracion.js';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const [url, copiaAntigua, salida] = process.argv.slice(2);
mkdirSync(salida, { recursive: true });
const fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const eur = (n) => fmt.format(n === 0 ? 0 : n).replace(/ /g, ' ');
const limpio = (t) => t.replace(/ /g, ' ').replace(/\s+/g, ' ');
const anio = String(new Date().getFullYear()), ALTA = `${anio}-10-01`, hoy = M.hoyISO();

// El mismo camino que se hace en pantalla, hecho con la lógica:
const esperado = M.completar(migrarCopiaV2(JSON.parse(readFileSync(copiaAntigua, 'utf8'))).estado);
const delAnio = (e) => M.vivos(e.facturas).filter((f) => M.anioDe(f) === anio);
const netoInicio = (e) => eur(Math.round((M.totales(delAnio(e), e.ajustes).netoCobrado - F.cuotaPagada(e, anio)) * 100) / 100);

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
const texto = async (p, sel) => limpio(await p.locator(sel).first().innerText());
const ir = (p, vista) => p.click(`[data-accion=ir][data-vista=${vista}]`);
const foto = async (p, nombre, completa = false) => { await p.waitForTimeout(300); await p.screenshot({ path: `${salida}/${nombre}.png`, fullPage: completa }); };
const heroe = async (p) => { await ir(p, 'inicio'); await p.click(`.chip[data-anio="${anio}"]`); return texto(p, '.grande'); };
async function entrar(p, pw) { await p.fill('[name=pw]', pw); await p.fill('[name=pw2]', pw); await p.click('button[type=submit]'); await p.waitForSelector('.barra'); }
async function importar(p, ruta, password) {
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-accion=importar-copia]').first().click()]);
  await fc.setFiles(ruta);
  if (password) { await p.fill('.dlg [name=pw]', password); await p.click('.dlg-b .btn:last-child'); }
  await p.waitForSelector('.resumen-imp');
  const resumen = await texto(p, '.resumen-imp');
  await p.click('[data-accion=aplicar-importacion]'); await p.waitForSelector('.hoja', { state: 'detached' });
  return resumen;
}
async function exportar(p, ruta) {
  await ir(p, 'mas'); await p.click('[data-sub=copias]');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-accion=exportar-copia]')]);
  await d.saveAs(ruta); return ruta;
}
const impuestos = async (p, apartado = 'resumen') => { await ir(p, 'impuestos'); await p.click(`.chip[data-anio="${anio}"]`); await p.click(`[data-accion=imp][data-imp=${apartado}]`); };
const ajustesAutonomo = async (p) => { await ir(p, 'mas'); await p.click('[data-sub=fiscal]'); };

// ---------- Móvil ----------
console.log('Móvil (A)');
const A = await dispositivo('A', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await entrar(A, '4821');
await importar(A, copiaAntigua);
await A.waitForSelector('.control'); await A.click('.dlg-b .btn');
const netoCooperativa = await heroe(A);
assert.equal(netoCooperativa, netoInicio(esperado));

// Simulación (sin fecha de alta)
let a = F.anioFiscal(esperado, anio);
await impuestos(A);
assert.match(await texto(A, '.banda.sim'), /Simulación/);
assert.equal(await texto(A, '.grande'), eur(a.neto));
assert.match(await texto(A, '.cuerpo'), new RegExp(`de ${eur(a.base).replace(/[.$]/g, '\\$&')} facturados sin IVA`));
assert.match(await texto(A, '.tarjeta'), new RegExp(eur(Math.round((a.total303 + a.total130 + a.reservaRenta) * 100) / 100).replace(/[.$]/g, '\\$&')));
assert.equal(await heroe(A), netoCooperativa);                      // la simulación no toca el inicio
await impuestos(A); await foto(A, '10-impuestos-simulacion', true);
await A.click('[data-accion=imp][data-imp=trimestres]'); await A.click('[data-accion=trim][data-q="3"]');
assert.match(await texto(A, '.cuerpo'), new RegExp(`IVA de tus facturas ${eur(a.t[2].iva).replace(/[.$]/g, '\\$&')}`));
await foto(A, '11-trimestres-simulacion', true);
await A.click('[data-accion=imp][data-imp=calendario]');
assert.equal(await A.locator('.fila.plazo').count(), 11);
assert.equal(await A.locator('[data-accion=presentar]').count(), 0); // en simulación no se marca nada
paso(`simulación ${anio}: neto ${eur(a.neto)} de ${eur(a.base)}, trimestres y calendario; el inicio sigue en ${netoCooperativa}`);

// Gasto
await ir(A, 'gastos'); await A.click('[data-accion=nuevo-gasto]'); await A.waitForSelector('.hoja');
await A.click('.hoja-pie button[type=submit]');
assert.match(await texto(A, '.hoja [data-et=error]'), /base/);
await A.selectOption('[data-campo=categoria]', 'vehiculo');
assert.deepEqual([await A.inputValue('[data-campo=dedIva]'), await A.inputValue('[data-campo=dedIrpf]')], ['50', '0']);
await A.fill('[data-campo=proveedor]', 'Gasolinera de prueba'); await A.fill('[data-campo=numFactura]', 'T-1'); await A.fill('[data-campo=base]', '100');
assert.equal(await A.inputValue('[data-campo=iva]'), '21');
assert.equal(limpio(await A.inputValue('[data-et=total]')), '121,00 €');
assert.match(await texto(A, '.hoja [data-et=efecto]'), /IVA que recuperas 10,50 €.*IRPF 0,00 €/);
await A.check('[data-campo=justificante]');
await foto(A, '12-gasto-nuevo');
await A.click('.hoja-pie button[type=submit]'); await A.waitForSelector('.hoja', { state: 'detached' });
assert.match(await texto(A, '.cuerpo .lista .fila'), /Gasolinera de prueba.*121,00 €/);
esperado.gastos.push({ id: 'g', fecha: hoy, proveedor: 'Gasolinera de prueba', numFactura: 'T-1', categoria: 'vehiculo', base: 100, ivaPct: 21, iva: 21, dedIva: 50, dedIrpf: 0, justificante: true, nota: '' });
await foto(A, '13-gastos');
paso('gasto: la categoría propone sus porcentajes, el IVA se calcula solo y queda en la lista');

// Fecha de alta: las facturas desde esa fecha pasan a ser de autónomo
const cambian = M.vivos(esperado.facturas).filter((f) => M.esAutonomo(f, { fechaAlta: ALTA })).length;
await ajustesAutonomo(A);
assert.ok(await A.locator('.tag:not(.ok)').count() >= 8 && await A.locator('.tag.ok').count() === 0); // todo nace «pendiente de confirmar»
await A.fill('[data-fecha-alta]', ALTA);
assert.match(await texto(A, '.dlg'), new RegExp(`${cambian} facturas? cambian? de régimen`));
await A.click('.dlg-b .btn.sec');                                   // cancelar: no cambia nada
assert.equal(await A.inputValue('[data-fecha-alta]'), '');
await A.fill('[data-fecha-alta]', ALTA); await A.click('.dlg-b .btn:last-child');
await A.waitForFunction((f) => document.querySelector('[data-fecha-alta]')?.value === f && !document.querySelector('.dlg'), ALTA);
await A.check('[data-confirmar=ivaPct]'); await A.waitForSelector('.tag.ok');
await foto(A, '14-ajustes-autonomo', true);
esperado.ajustes.fechaAlta = ALTA;
assert.equal(await heroe(A), netoInicio(esperado));
assert.notEqual(netoInicio(esperado), netoCooperativa);
await foto(A, '15-inicio-autonomo', true);
paso(`fecha de alta ${ALTA}: avisa de ${cambian} facturas, se puede cancelar, y el neto del inicio pasa a ${netoInicio(esperado)}`);

// Impuestos reales, hucha y presentar
a = F.anioFiscal(esperado, anio); let h = F.hucha(esperado);
await impuestos(A);
assert.equal(await A.locator('.banda.sim').count(), 0);
assert.equal(await texto(A, '.grande'), eur(a.neto));
assert.equal(await texto(A, '.medio.amb'), eur(h.total));
await foto(A, '16-impuestos-real', true);
await A.click('[data-accion=detalle-hucha]'); assert.match(await texto(A, '.dlg'), new RegExp(`IVA 4T ${anio}`)); await foto(A, '17-hucha'); await A.click('.dlg-b .btn');
await A.click('[data-accion=imp][data-imp=trimestres]'); await A.click('[data-accion=trim][data-q="4"]');
assert.match(await texto(A, '.cuerpo'), new RegExp(`A ingresar ${eur(a.t[3].aIngresar303).replace(/[.$]/g, '\\$&')}`));
assert.match(await texto(A, '.cuerpo'), /No tienes que presentarlo: el 100 % de tus ingresos lleva retención/);
await foto(A, '18-trimestre-real', true);
await A.click(`[data-accion=presentar][data-id="${anio}-303-4"]`); await A.waitForSelector(`[data-id="${anio}-303-4"]:not(.sec)`);
esperado.ajustes.fiscal.presentados[`${anio}-303-4`] = true; h = F.hucha(esperado);
await A.click('[data-accion=imp][data-imp=resumen]');
assert.equal(await texto(A, '.medio.amb'), eur(h.total));
await A.click('[data-accion=imp][data-imp=calendario]');
assert.equal(await A.locator('.fila.plazo.e-cobrada').count(), 1);
await foto(A, '19-calendario', true);
const [ics] = await Promise.all([A.waitForEvent('download'), A.click('[data-accion=exportar-ics]')]);
await ics.saveAs(`${salida}/plazos.ics`);
const txtIcs = readFileSync(`${salida}/plazos.ics`, 'utf8');
assert.ok(txtIcs.startsWith('BEGIN:VCALENDAR') && txtIcs.includes('SUMMARY:Hacienda: modelo 390') && !txtIcs.includes(`${anio}-303-4@`) && !txtIcs.includes('€'));
await A.click(`[data-accion=presentar][data-id="${anio}-303-4"]`); await A.waitForSelector(`[data-id="${anio}-303-4"].sec`);
delete esperado.ajustes.fiscal.presentados[`${anio}-303-4`];
paso(`impuestos reales: neto ${eur(a.neto)}, hucha ${eur(F.hucha(esperado).total)}; marcar el 303 como presentado la baja y sale del archivo de calendario`);

// Factura de autónomo: 1.000 € -> IVA 210, retención 70, entran 1.140, neto 930
await A.click('.fab'); await A.waitForSelector('.hoja');
const cliente = await A.locator('[data-campo=clienteId] option').nth(1).getAttribute('value');
await A.selectOption('[data-campo=clienteId]', cliente);
await A.fill('[data-campo=ref]', 'Prueba autónomo'); await A.fill('[data-serv=evento]', 'Evento de prueba'); await A.fill('[data-serv=fecha]', hoy); await A.fill('[data-serv=importe]', '1000');
assert.ok(await A.locator('[data-campo=neto]').isHidden() && await A.locator('[data-campo=diasSS]').isHidden() && await A.locator('[data-campo=ivaPct]').isVisible());
assert.match(await texto(A, '.hoja [data-et=desglose]'), /IVA 210,00 €.*Retención -70,00 €.*banco 1\.140,00 €.*930,00 €/);
await A.fill('[data-campo=fechaFactura]', `${Number(anio) - 1}-06-01`);   // con fecha anterior al alta vuelve a ser de cooperativa
assert.ok(await A.locator('[data-campo=neto]').isVisible() && await A.locator('[data-campo=ivaPct]').isHidden());
await A.fill('[data-campo=fechaFactura]', hoy);
await A.selectOption('[data-campo=estado]', 'pendiente');
await foto(A, '20-factura-autonomo', true);
await A.click('.hoja-pie button[type=submit]'); await A.waitForSelector('.hoja', { state: 'detached' });
await ir(A, 'facturas'); await A.click('.chip[data-anio=todo]'); await A.fill('[data-filtro=q]', 'Prueba autónomo');
assert.match(await texto(A, '#lista-facturas .fila'), /930,00 €.*previsto · base 1\.000,00 €/);
await A.click('#lista-facturas [data-accion=cobrar]');
assert.match(await texto(A, '.dlg'), /Te tiene que haber entrado 1\.140,00 €/);
assert.equal(await A.locator('.dlg [name=neto]').count(), 0);
await foto(A, '21-cobrar-autonomo');
await A.click('.dlg-b .btn:last-child');
await A.waitForFunction(() => /Cobrada/.test(document.querySelector('#lista-facturas .fila')?.innerText || ''));
assert.match(await texto(A, '#lista-facturas .fila'), /Cobrada.*930,00 €/);
await A.fill('[data-filtro=q]', '');
esperado.facturas.push({ id: 'nueva', n: 99, ref: 'Prueba autónomo', clienteId: cliente, estado: 'cobrada', fechaFactura: hoy, fechaCobro: hoy, neto: null, diasSS: null, nota: '',
  servicios: [{ evento: 'Evento de prueba', mod: '', fecha: hoy, dias: 1, importe: 1000 }], ivaPct: 21, retPct: 7 });
assert.equal(await heroe(A), netoInicio(esperado));
a = F.anioFiscal(esperado, anio); h = F.hucha(esperado);
await impuestos(A);
assert.equal(await texto(A, '.grande'), eur(a.neto)); assert.equal(await texto(A, '.medio.amb'), eur(h.total));
paso('factura de autónomo: desglose en la ficha, cambia de régimen con la fecha, cobro sin pedir neto, y todo cuadra con la lógica');

// Fase 3: casillas de los modelos y material que se amortiza
const q = F.trimestreDe(hoy), esc = (t) => t.replace(/[.$?()]/g, '\\$&');
const casillas = async (p) => Object.fromEntries(await p.locator('.cas').evaluateAll((els) => els.map((el) => [el.querySelector('.cas-n')?.textContent || el.querySelector('.cas-t').textContent, el.querySelector('.cas-v').textContent.replace(/\u00a0/g, ' ')])));
const comparar = async (p, m) => { const c = await casillas(p); for (const f of m.casillas) assert.equal(c[f.n || f.nombre], typeof f.valor === 'number' ? eur(f.valor) : f.valor, `casilla ${f.n || f.nombre}`); };
await impuestos(A, 'modelos');
let m = MO.modelo303(esperado, anio, q);
await comparar(A, m);
assert.match(await texto(A, '.cuerpo'), new RegExp(esc(`${m.resultado.texto} · ${eur(m.resultado.importe)}`)));
await A.click('.cas summary >> nth=0'); assert.ok(await A.locator('.cas[open] p').first().isVisible());
await foto(A, '24-modelo-303', true);
await A.click('[data-accion=modelo][data-m="130"]');
await comparar(A, MO.modelo130(esperado, anio, q));
assert.match(await texto(A, '.banda'), /No tienes que presentarlo/);
await foto(A, '25-modelo-130', true);
await A.click('[data-accion=modelo][data-m="390"]'); await comparar(A, MO.modelo390(esperado, anio));
await A.click('[data-accion=modelo][data-m=renta]');
const renta = MO.resumenRenta(esperado, anio);
await comparar(A, { casillas: renta.secciones.flatMap((x) => x.filas) });
assert.match(await texto(A, '.cuerpo'), /Cooperativa · rendimientos del trabajo/i);
await foto(A, '26-renta', true);
paso(`modelos: las casillas del 303, 130, 390 y el resumen de la renta coinciden una a una con la lógica (${m.casillas.length} casillas en el 303)`);

await ir(A, 'gastos'); await A.click('[data-accion=nuevo-gasto]'); await A.waitForSelector('.hoja');
assert.ok(await A.locator('[data-campo=amortPct]').isHidden());
await A.fill('[data-campo=proveedor]', 'Tienda de prueba'); await A.fill('[data-campo=base]', '1200');
await A.check('[data-campo=amortiza]');
assert.equal(await A.inputValue('[data-campo=amortPct]'), '26');
assert.match(await texto(A, '.hoja [data-et=efecto]'), /IVA que recuperas 252,00 €.*cada año 312,00 €.*completar 1\.200,00 €/);
await A.selectOption('[data-et=grupo]', { label: 'Útiles y herramientas' }); assert.equal(await A.inputValue('[data-campo=amortPct]'), '30');
await A.fill('[data-campo=amortPct]', '26');
await foto(A, '27-gasto-amortiza', true);
await A.click('.hoja-pie button[type=submit]'); await A.waitForSelector('.hoja', { state: 'detached' });
assert.match(await texto(A, '.cuerpo .lista'), /Tienda de prueba.*se amortiza · 26 % al año/);
esperado.gastos.push({ id: 'm', fecha: hoy, proveedor: 'Tienda de prueba', numFactura: '', categoria: 'material', base: 1200, ivaPct: 21, iva: 252, dedIva: 100, dedIrpf: 100, justificante: false, nota: '', amortiza: true, amortPct: 26 });
a = F.anioFiscal(esperado, anio); h = F.hucha(esperado);
assert.ok(a.amortizacion > 0 && a.amortizacion < 312);
await impuestos(A);
assert.equal(await texto(A, '.medio.amb'), eur(h.total));
assert.match(await texto(A, '.cuerpo'), new RegExp(esc(`Amortización del material ${eur(a.amortizacion)}`)));
await A.click('[data-accion=imp][data-imp=modelos]'); await A.click('[data-accion=modelo][data-m="303"]');
await comparar(A, MO.modelo303(esperado, anio, q));
paso(`material que se amortiza: su IVA se deduce entero y al IRPF entra poco a poco (${eur(a.amortizacion)} hasta hoy)`);

// ---------- PC ----------
console.log('PC (B)');
const B = await dispositivo('B', { viewport: { width: 1280, height: 800 } });
await entrar(B, 'clave-del-pc');
const copia1 = await exportar(A, `${salida}/copia-aut-1.json`);
assert.ok(!readFileSync(copia1, 'utf8').includes('Gasolinera'));
await importar(B, copia1, '4821');
assert.equal(await heroe(B), await heroe(A));
await impuestos(B);
assert.equal(await texto(B, '.grande'), eur(a.neto)); assert.equal(await texto(B, '.medio.amb'), eur(h.total));
await ir(B, 'gastos'); assert.equal(await B.locator('.cuerpo .lista .fila').count(), 2);
await ajustesAutonomo(B);
assert.equal(await B.inputValue('[data-fecha-alta]'), ALTA); assert.equal(await B.locator('.tag.ok').count(), 1);
await foto(B, '22-pc-impuestos');
paso('la copia lleva gastos, fecha de alta y ajustes: el PC enseña el mismo neto y la misma hucha');

// Editar el gasto solo en el móvil: en el PC entra como actualización, no como conflicto
await ir(A, 'gastos'); await A.click('.cuerpo .lista .fila'); await A.fill('[data-campo=base]', '200');
assert.equal(await A.inputValue('[data-campo=iva]'), '42');
await A.click('.hoja-pie button[type=submit]'); await A.waitForSelector('.hoja', { state: 'detached' });
const copia2 = await exportar(A, `${salida}/copia-aut-2.json`);
await ir(B, 'mas'); await B.click('[data-sub=copias]');
assert.match(await importar(B, copia2, '4821'), /0 nuevos · 1 actualizados · 0 conflictos/);
await ir(B, 'gastos'); assert.match(await texto(B, '.cuerpo .lista .fila'), /242,00 €/);
// Cambio de un ajuste en el PC -> vuelve al móvil
await ajustesAutonomo(B); await B.selectOption('[data-fiscal-sel=epigrafe]', 'empresarial'); await B.waitForFunction(() => /Guardado/.test(document.querySelector('#aviso')?.textContent || ''));
const copia3 = await exportar(B, `${salida}/copia-aut-3.json`);
await ir(A, 'mas'); await A.click('[data-sub=copias]');
const [fc] = await Promise.all([A.waitForEvent('filechooser'), A.locator('[data-accion=importar-copia]').first().click()]);
await fc.setFiles(copia3); await A.fill('.dlg [name=pw]', 'clave-del-pc'); await A.click('.dlg-b .btn:last-child');
await A.waitForSelector('.resumen-imp');
assert.match(await texto(A, '.resumen-imp'), /0 nuevos · 1 actualizados · 0 conflictos/);
assert.match(await texto(A, '.hoja'), /Ajustes de la app[\s\S]*Epígrafe: aquí «profesional» → archivo «empresarial»/);
await foto(A, '23-importar-ajustes');
await A.click('[data-accion=aplicar-importacion]'); await A.waitForSelector('.hoja', { state: 'detached' });
esperado.ajustes.fiscal.epigrafe = 'empresarial'; esperado.gastos[0].base = 200; esperado.gastos[0].iva = 42;
a = F.anioFiscal(esperado, anio);
await impuestos(A, 'trimestres'); await A.click('[data-accion=trim][data-q="4"]');
assert.match(await texto(A, '.cuerpo'), /Beneficio acumulado/);     // empresarial: ahora sí hay modelo 130…
assert.equal(a.t[3].obligado130, true);
const k19 = a.t[q - 1].c130['19'];
assert.match(await texto(A, '.cuerpo'), new RegExp((k19 < 0 ? `Sale negativo: no pagas ${eur(k19)}` : `A ingresar ${eur(a.t[q - 1].pago130)}`).replace(/[.$]/g, '\\$&')));
await A.click('[data-accion=imp][data-imp=modelos]'); await A.click('[data-accion=modelo][data-m="130"]');
await comparar(A, MO.modelo130(esperado, anio, q));
assert.equal(await A.locator('.banda').count(), 0);                // empresarial: sí toca presentarlo
paso('sincronización: el gasto editado entra como actualización (sin falso conflicto) y un cambio de epígrafe viaja de vuelta');

// Quitar la fecha de alta: todo vuelve a cooperativa y los datos reales siguen intactos
await ajustesAutonomo(A); await A.click('[data-accion=quitar-alta]'); await A.click('.dlg-b .btn:last-child');
await A.waitForFunction(() => document.querySelector('[data-fecha-alta]')?.value === '' && !document.querySelector('.dlg'));
assert.equal(await heroe(A), netoCooperativa);
await impuestos(A); assert.match(await texto(A, '.banda.sim'), /Simulación/);
paso(`quitar la fecha de alta devuelve el neto de cooperativa (${netoCooperativa}) y la simulación`);

// Sin internet
await A.evaluate(() => navigator.serviceWorker.ready);
await A.context().setOffline(true);
await A.reload(); await A.waitForSelector('.puerta');
await A.fill('[name=pw]', '4821'); await A.click('button[type=submit]'); await A.waitForSelector('.barra');
await impuestos(A); assert.match(await texto(A, '.banda.sim'), /Simulación/);
await ir(A, 'gastos'); assert.equal(await A.locator('.cuerpo .lista .fila').count(), 2);
await impuestos(A, 'modelos'); assert.ok(await A.locator('.cas').count() > 5);
paso('SIN INTERNET: abre, desbloquea y enseña impuestos y gastos');

await navegador.close();
assert.deepEqual(errores, [], 'errores en la consola del navegador');
console.log(`\n${pasos} pasos correctos, sin errores en la consola`);
