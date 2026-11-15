// pruebas/logica.mjs — Pruebas de la lógica (sin navegador).  Uso:  node pruebas/logica.mjs [ruta-a-copia-antigua.json]
// Sin argumento usa datos inventados. Con la ruta de una copia real de la app antigua comprueba además sus cifras.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as C from '../js/copias.js';
import { migrarCopiaV2, esCopiaAntigua } from '../js/migracion.js';
import { derivarClave, cifrar, descifrar, aleatorio } from '../js/cripto.js';
import { aCSV, gastosCSV } from '../js/csv.js';
import * as F from '../js/fiscal.js';
import * as MO from '../js/modelos.js';

let n = 0;
const prueba = async (nombre, fn) => { await fn(); n++; console.log('  ✓', nombre); };

const inventada = {
  app: 'mis-facturas', version: 2, fecha: '2026-01-10T10:00:00.000Z',
  facturas: [
    { id: 'f001', n: 1, ref: 'Servicio 1', cliente: 'Tele Uno', estado: 'Cobrada', total: null, ajuste: 0.8, neto: 165.7, diasSS: 1, nota: '',
      servicios: [{ evento: 'Fiesta mayor', mod: 'MONTAOPERA', fecha: '2025-06-29', dias: 1, importe: 200 }] },
    { id: 'f002', n: 2, ref: 'Servicio 2', cliente: 'Productora Dos (Ana)', estado: 'Pendiente de cobro', total: null, ajuste: 0, neto: null, diasSS: 2, nota: '',
      servicios: [{ evento: 'Partido', mod: 'Operador', fecha: '2025-12-20', dias: 1, importe: 189.99 }, { evento: 'Partido', mod: 'Operador', fecha: '2025-12-21', dias: 1, importe: 189.99 }], fechaFactura: '2025-12-27' },
    { id: 'f004', n: 4, ref: 'Servicio 3', cliente: 'Tele Uno', estado: 'Sin cerrar', total: null, ajuste: 0, neto: 500, diasSS: null, nota: '',
      servicios: [{ evento: 'Gala', mod: 'Realización', fecha: '2026-01-05', dias: 1, importe: 400 }] },
  ],
  plazos: [{ cliente: 'Tele Uno', tipo: 'dias', dias: 90 }, { cliente: 'Productora Dos', tipo: 'mes', desde: 7, hasta: 10 }, { cliente: 'Empresa Madre SL', tipo: 'dias', dias: 30 }],
};

console.log('Migración de la copia antigua');
const { estado: base, informe } = migrarCopiaV2(inventada);
await prueba('reconoce el formato', () => assert.ok(esCopiaAntigua(inventada)));
await prueba('facturas, servicios, importes y días cuadran', () => {
  assert.deepEqual([informe.app.facturas, informe.app.servicios, informe.app.bruto, informe.app.dias], [3, 4, 979.98, 3]);
  assert.equal(informe.archivo.bruto, informe.app.bruto);
});
await prueba('neto mayor que el importe: se descarta y se avisa', () => {
  assert.equal(base.facturas[2].neto, null);
  assert.deepEqual(informe.netosDescartados, [{ n: 4, neto: 500, bruto: 400 }]);
  assert.equal(informe.app.neto, 165.7); assert.equal(informe.archivo.neto, 665.7);
});
await prueba('fecha de factura ausente = último servicio; hueco de numeración detectado', () => {
  assert.equal(base.facturas[0].fechaFactura, '2025-06-29'); assert.equal(base.facturas[1].fechaFactura, '2025-12-27');
  assert.equal(informe.fechasPuestas, 2); assert.deepEqual(informe.huecos, [3]);
});
await prueba('plazos: se enganchan por nombre parecido; el que no encaja queda para asignar', () => {
  const c = Object.fromEntries(base.clientes.map((x) => [x.nombre, x.plazo]));
  assert.deepEqual(c['Tele Uno'], { tipo: 'dias', dias: 90 });
  assert.deepEqual(c['Productora Dos (Ana)'], { tipo: 'mes', desde: 7, hasta: 10 });
  assert.equal(informe.plazosSinCliente[0].nombre, 'Empresa Madre SL');
});
await prueba('el ajuste antiguo se conserva sin usarse', () => assert.deepEqual(base.facturas[0].antiguo, { total: null, ajuste: 0.8 }));

console.log('Cálculos');
await prueba('totales: el neto cobrado solo cuenta facturas cobradas', () => {
  const t = M.totales(base.facturas);
  assert.deepEqual([t.netoCobrado, t.nCobradas, t.netoPrevisto, t.nSinNeto, t.brutoSinNeto], [165.7, 1, 0, 2, 779.98]);
});
await prueba('fechas de cobro previstas', () => {
  const cl = new Map(base.clientes.map((c) => [c.id, c]));
  assert.deepEqual(M.cobroPrevisto(base.facturas[1], cl.get(base.facturas[1].clienteId)), { desde: '2026-01-07', hasta: '2026-01-10' });
  assert.deepEqual(M.cobroPrevisto(base.facturas[2], cl.get(base.facturas[2].clienteId)), { desde: '2026-04-05', hasta: '2026-04-05' });
  assert.deepEqual(M.cobroPrevisto({ fechaFactura: '2026-01-31', servicios: [] }, { plazo: { tipo: 'mes', desde: 30, hasta: 31 } }), { desde: '2026-02-28', hasta: '2026-02-28' });
});
await prueba('comparativa con el año anterior', () => {
  const k = M.comparativa(base, '2026', '2026-12-31');
  assert.deepEqual([k.actual, k.anterior], [0, 579.98]);       // la de 2026 está sin cerrar: no cuenta
  const cerrada = structuredClone(base); cerrada.facturas[2].estado = 'pendiente';
  assert.deepEqual(M.comparativa(cerrada, '2026', '2026-12-31').actual, 400);
});

console.log('Cifrado');
await prueba('cifra y descifra; con otra contraseña falla', async () => {
  const sal = aleatorio(16);
  const k = await derivarClave('correcta-123', sal, 1000);
  const caja = await cifrar(k, base);
  assert.deepEqual(await descifrar(k, caja), base);
  assert.ok(!Buffer.from(caja.ct).toString('latin1').includes('Tele Uno'));
  await assert.rejects(descifrar(await derivarClave('otra', sal, 1000), caja));
});
await prueba('archivo de copia: se abre con la contraseña y no contiene texto legible', async () => {
  const sal = aleatorio(16);
  const k = await derivarClave('correcta-123', sal, 1000);
  const copia = await C.crearCopia(base, k, { sal, iter: 1000 });
  const txt = JSON.stringify(copia);
  assert.ok(C.esCopiaCifrada(copia) && !txt.includes('Tele') && !txt.includes('Fiesta'));
  assert.deepEqual(await C.abrirCopia(JSON.parse(txt), { password: 'correcta-123' }), base);
  await assert.rejects(C.abrirCopia(copia, { password: 'mala' }));
});

console.log('Fusión entre dispositivos');
const aplicar = (loc, arch, cambios = {}) => { const items = C.comparar(loc, arch); return C.fusionar(loc, arch, items, { ...C.eleccionesPorDefecto(items), ...cambios }); };
const casos = (loc, arch) => Object.fromEntries(C.comparar(loc, arch).filter((i) => i.caso !== 'igual').map((i) => [i.id, i.caso]));
const editar = (est, id, fn, t) => { const f = est.facturas.find((x) => x.id === id); fn(f); f._mod = t; return est; };
const T = Date.parse(inventada.fecha);

await prueba('dispositivo vacío: todo entra como nuevo, sin perder ni duplicar', () => {
  const B = aplicar(M.estadoVacio(), base);
  assert.equal(B.facturas.length, 3); assert.equal(B.clientes.length, 2);
  assert.deepEqual(casos(B, base), {});
  assert.deepEqual(M.totales(B.facturas), M.totales(base.facturas));
});
await prueba('cambio solo en el otro dispositivo: entra como actualización', () => {
  const A = structuredClone(base), B = aplicar(M.estadoVacio(), base);
  editar(B, 'f002', (f) => { f.estado = 'cobrada'; f.neto = 300; }, T + 100);
  assert.deepEqual(casos(A, B), { f002: 'archivo' });
  const A2 = aplicar(A, B);
  assert.equal(A2.facturas.find((f) => f.id === 'f002').neto, 300);
  assert.deepEqual(casos(A2, B), {}); assert.deepEqual(casos(B, A2), {});
});
await prueba('cambio solo aquí: la importación de una copia vieja no lo pisa', () => {
  const A = editar(structuredClone(base), 'f001', (f) => { f.nota = 'mía'; }, T + 50);
  assert.deepEqual(casos(A, base), { f001: 'local' });
  assert.equal(aplicar(A, base).facturas[0].nota, 'mía');
});
await prueba('cambio en los dos: conflicto, y la elección viaja al otro dispositivo', () => {
  const A = editar(structuredClone(base), 'f001', (f) => { f.nota = 'desde A'; }, T + 50);
  const B = editar(aplicar(M.estadoVacio(), base), 'f001', (f) => { f.nota = 'desde B'; }, T + 80);
  assert.deepEqual(casos(A, B), { f001: 'conflicto' });
  const A2 = aplicar(A, B, { 'facturas:f001': 'local' });
  assert.equal(A2.facturas[0].nota, 'desde A');
  assert.deepEqual(casos(B, A2), { f001: 'archivo' });           // B ve la versión de A como más nueva
  assert.equal(aplicar(B, A2).facturas[0].nota, 'desde A');
  assert.equal(aplicar(A, B, { 'facturas:f001': 'archivo' }).facturas[0].nota, 'desde B');
});
await prueba('creado en la app, importado en el otro y editado después solo en el primero: actualización, no conflicto', () => {
  let movil = M.estadoVacio(), pc = M.estadoVacio();
  movil.clientes.push({ id: 'c', nombre: 'C', plazo: null, _mod: 10, _base: 0 });
  movil.facturas.push({ id: 'f', n: 1, ref: '', clienteId: 'c', estado: 'abierta', neto: null, diasSS: null, nota: '', servicios: [], _mod: 10, _base: 0 });
  pc = aplicar(pc, movil);
  for (const [t, nota] of [[20, 'una'], [30, 'dos']]) {
    movil.facturas[0].nota = nota; movil.facturas[0]._mod = t;
    assert.deepEqual(casos(pc, movil), { f: 'archivo' });
    pc = aplicar(pc, movil);
    assert.equal(pc.facturas[0].nota, nota);
  }
  assert.deepEqual(casos(movil, pc), {});                                   // el móvil no ve nada nuevo en la copia del PC
  const viejo = structuredClone(movil); viejo.facturas[0].nota = 'una'; viejo.facturas[0]._mod = 20;
  assert.deepEqual(casos(pc, viejo), { f: 'local' });                       // una copia antigua no pisa lo más reciente
  movil.facturas[0].nota = 'tres'; movil.facturas[0]._mod = 40;             // tocado en los dos lados: conflicto de verdad
  pc.facturas[0].nota = 'pc'; pc.facturas[0]._mod = 45;
  assert.deepEqual(casos(pc, movil), { f: 'conflicto' }); assert.deepEqual(casos(movil, pc), { f: 'conflicto' });
});
await prueba('alta nueva en un lado y borrado en el otro', () => {
  const A = structuredClone(base), B = aplicar(M.estadoVacio(), base);
  A.facturas.push({ id: 'fnueva', n: 5, ref: 'Nueva', clienteId: 'cx', estado: 'abierta', fechaFactura: null, fechaCobro: null, neto: null, diasSS: null, nota: '', servicios: [], _mod: T + 10, _base: 0 });
  A.clientes.push({ id: 'cx', nombre: 'Cliente X', plazo: null, _mod: T + 10, _base: 0 });
  const i = B.facturas.findIndex((f) => f.id === 'f004');
  B.facturas[i] = { id: 'f004', n: 4, _borrado: true, _mod: T + 20, _base: T };
  assert.deepEqual(casos(B, A), { fnueva: 'nueva', cx: 'nueva', f004: 'local' });
  const B2 = aplicar(B, A);
  assert.equal(M.vivos(B2.facturas).length, 3); assert.ok(B2.clientes.some((c) => c.id === 'cx'));
  const A2 = aplicar(A, B2);
  assert.equal(M.vivos(A2.facturas).length, 3); assert.ok(A2.facturas.find((f) => f.id === 'f004')._borrado);
});
await prueba('si se descarta un cliente nuevo pero no su factura, el cliente entra igualmente', () => {
  const A = structuredClone(base);
  A.facturas.push({ id: 'fy', n: 9, ref: '', clienteId: 'cy', estado: 'abierta', neto: null, diasSS: null, nota: '', servicios: [], _mod: T + 1, _base: 0 });
  A.clientes.push({ id: 'cy', nombre: 'Y', plazo: null, _mod: T + 1, _base: 0 });
  const B2 = aplicar(aplicar(M.estadoVacio(), base), A, { 'clientes:cy': 'local' });
  assert.ok(B2.clientes.some((c) => c.id === 'cy'));
});

console.log('CSV');
await prueba('una fila por servicio, con punto y coma y coma decimal', () => {
  const csv = aCSV(base).split('\r\n');
  assert.equal(csv.length, 1 + 4 + 1);
  assert.ok(csv[2].includes(';189,99;'));
});

console.log('Autónomo: régimen por fecha y factura');
const fac = (id, fecha, estado, importe, extra = {}) => ({ id, n: 1, ref: id, clienteId: 'c1', estado, fechaFactura: fecha, fechaCobro: null, neto: null, diasSS: null, nota: '',
  servicios: [{ evento: 'x', mod: 'Operador', fecha, dias: 1, importe }], _mod: 1, _base: 0, ...extra });
const gas = (id, fecha, base, iva, dedIva, dedIrpf) => ({ id, fecha, proveedor: 'P', numFactura: id, categoria: 'material', base, ivaPct: 21, iva, dedIva, dedIrpf, justificante: true, nota: '', _mod: 1, _base: 0 });
function estadoAutonomo(epigrafe = 'profesional') {
  const e = M.estadoVacio();
  e.ajustes.fechaAlta = '2027-01-01'; e.ajustes.fiscal.epigrafe = epigrafe; e.ajustes._mod = 1; // como hace la app al cambiar un ajuste
  const ret = epigrafe === 'empresarial' ? 0 : 7;
  e.clientes.push({ id: 'c1', nombre: 'Cliente', plazo: null, _mod: 1, _base: 0 });
  e.facturas.push(
    fac('coop', '2026-12-01', 'cobrada', 500, { neto: 400, diasSS: 2 }),
    fac('a1', '2027-02-10', 'pendiente', 1000, { ivaPct: 21, retPct: ret }),
    fac('a2', '2027-05-05', 'cobrada', 500, { ivaPct: 21, retPct: ret }),
    fac('a3', '2027-05-20', 'abierta', 300, { ivaPct: 21, retPct: ret }));
  e.gastos.push(gas('g1', '2027-02-15', 100, 21, 100, 100), gas('g2', '2027-03-01', 50, 10.5, 50, 0), gas('g3', '2027-04-10', 200, 42, 50, 100));
  return e;
}
const HOY = '2027-06-15';
const A = estadoAutonomo();
await prueba('antes del alta es cooperativa; desde el alta, autónomo', () => {
  assert.deepEqual(A.facturas.map((f) => M.esAutonomo(f, A.ajustes)), [false, true, true, true]);
  assert.equal(M.esAutonomo(A.facturas[1], { fechaAlta: null }), false);
});
await prueba('factura de 1.000 € con IVA 21 % y retención 7 %: 210 de IVA, 70 retenidos, entran 1.140, neto 930', () => {
  const d = M.desglose(A.facturas[1], A.ajustes.fiscal);
  assert.deepEqual([d.base, d.iva, d.retencion, d.total, d.neto], [1000, 210, 70, 1140, 930]);
});
await prueba('sin retención, el neto aparta el % del pago trimestral; la factura guarda sus porcentajes', () => {
  const d = M.desglose(fac('x', '2027-02-10', 'pendiente', 1000, { ivaPct: 21, retPct: 0 }), A.ajustes.fiscal);
  assert.deepEqual([d.retencion, d.total, d.neto], [0, 1210, 800]);
  const cambiado = structuredClone(A.ajustes.fiscal); cambiado.ivaPct = 10; cambiado.retencionPct = 15;
  assert.equal(M.desglose(A.facturas[1], cambiado).total, 1140);            // la factura ya emitida no cambia
  assert.equal(M.desglose(fac('n', '2027-02-10', 'abierta', 1000), cambiado).total, 950); // una nueva sí: 1000+100-150
});
await prueba('totales mezclando cooperativa y autónomo; los días cotizados solo cuentan en cooperativa', () => {
  const t = M.totales(A.facturas, A.ajustes);
  assert.deepEqual([t.netoCobrado, t.nCobradas, t.netoPrevisto, t.nPrevistas, t.nSinNeto, t.dias, t.nAutonomo], [865, 2, 1209, 2, 0, 2, 3]);
});

console.log('Autónomo: gastos, IVA, IRPF, cuota y hucha');
await prueba('gasto: IVA deducible y gasto de IRPF (el IVA no deducible es más gasto)', () => {
  assert.deepEqual(F.calculoGasto(A.gastos[1], A.ajustes.fiscal), { total: 60.5, ivaDed: 5.25, gastoIrpf: 0 });
  assert.deepEqual(F.calculoGasto(A.gastos[2], A.ajustes.fiscal), { total: 242, ivaDed: 21, gastoIrpf: 221 });
});
await prueba('cuota por tramos con fecha de inicio', () => {
  const f = { cuotas: [{ desde: '', importe: 88.64 }, { desde: '2029-01', importe: 300 }] };
  assert.deepEqual([F.cuotaDelMes(f, '2027-01'), F.cuotaDelMes(f, '2028-12'), F.cuotaDelMes(f, '2029-01'), F.cuotaDelMes(f, '2030-06')], [88.64, 88.64, 300, 300]);
  assert.equal(F.cuotaPagada(A, '2027', HOY), 531.84); assert.equal(F.cuotaPagada(A, '2026', HOY), 0); assert.equal(F.cuotaPagada(A, 'todo', HOY), 531.84);
});
await prueba('profesional con retención: trimestres, sin modelo 130, reserva de renta', () => {
  const a = F.anioFiscal(A, '2027', HOY), [t1, t2] = a.t;
  assert.equal(a.modo, 'real'); assert.equal(a.n, 2); assert.equal(a.sinCerrar, 1);
  assert.deepEqual([t1.base, t1.iva, t1.ivaDeducible, t1.aIngresar303, t1.cuota], [1000, 210, 26.25, 183.75, 265.92]);
  assert.deepEqual([t2.base, t2.iva, t2.ivaDeducible, t2.aIngresar303], [500, 105, 21, 84]);
  // beneficio 1T: 1000 − 100 de gasto − 265,92 de cuota = 634,08; menos el 5 % de difícil justificación (31,70) = 602,38
  assert.deepEqual([t1.acum.dificil, t1.acum.rendimiento, t2.acum.dificil, t2.acum.rendimiento], [31.7, 602.38, 32.36, 614.8]);
  assert.deepEqual([t1.obligado130, t1.pctRetenido, t2.pago130], [false, 100, 0]);
  // reserva de renta: 20 % de 614,80 = 122,96, menos 105 ya retenidos = 17,96
  assert.deepEqual([a.base, a.retencion, a.cuota, a.netoFacturas, a.neto, a.total303, a.total130, a.dificil, a.reservaRenta], [1500, 105, 531.84, 1395, 863.16, 267.75, 0, 32.36, 17.96]);
});
await prueba('empresarial sin retención: modelo 130 casilla a casilla, con minoración y resultados negativos', () => {
  const e = estadoAutonomo('empresarial');
  const a = F.anioFiscal(e, '2027', HOY), [t1, t2, t3] = a.t;
  // 1T: 20 % de 602,38 = 120,48; menos 100 de minoración (primer año) = 20,48 a ingresar
  assert.deepEqual(t1.c130, { '01': 1000, '02': 397.62, '03': 602.38, '04': 120.48, '05': 0, '06': 0, '07': 120.48, '12': 120.48, '13': 100, '14': 20.48, '15': 0, '16': 0, '17': 20.48, '18': 0, '19': 20.48 });
  // 2T: 20 % de 614,80 = 122,96; menos la casilla 07 anterior (120,48) = 2,48; menos 100 = −97,52: no se paga
  assert.deepEqual([t2.c130['04'], t2.c130['05'], t2.c130['07'], t2.c130['14'], t2.c130['19'], t2.pago130], [122.96, 120.48, 2.48, -97.52, -97.52, 0]);
  assert.deepEqual([t3.c130['05'], t3.c130['07'], t3.c130['19']], [122.96, 0, -100]);
  assert.deepEqual([t1.obligado130, t1.pago130, a.total130, a.minoracion130, a.netoFacturas, a.reservaRenta], [true, 20.48, 20.48, 100, 1200, 102.48]);
  // 3T con una factura de 2.000: sale positivo y descuenta el negativo del 2T (casilla 15)
  e.facturas.push(fac('a4', '2027-08-01', 'cobrada', 2000, { ivaPct: 21, retPct: 0 }));
  const b = F.anioFiscal(e, '2027', '2027-09-30'), k = b.t[2].c130;
  assert.deepEqual([k['03'], k['04'], k['05'], k['07'], k['13'], k['14'], k['15'], k['19'], b.t[2].pago130, b.total130], [2262.18, 452.44, 122.96, 329.48, 100, 229.48, 97.52, 131.96, 131.96, 152.44]);
});
await prueba('minoración del 130 según el beneficio del año anterior; sin difícil justificación si el % es 0', () => {
  const e = estadoAutonomo('empresarial');
  e.facturas.push(fac('b1', '2028-02-01', 'cobrada', 1000, { ivaPct: 21, retPct: 0 }));
  e.facturas.push(fac('g27', '2027-11-01', 'cobrada', 10000, { ivaPct: 21, retPct: 0 }));
  const a27 = F.anioFiscal(e, '2027', '2028-03-31');
  assert.equal(a27.rendimiento, 9609.55);       // 11.500 − 321 de gastos − 1.063,68 de cuota = 10.115,32; menos el 5 % (505,77)
  assert.equal(F.anioFiscal(e, '2028', '2028-03-31').minoracion130, 75);                    // entre 9.000,01 y 10.000
  e.ajustes.fiscal.difJustPct = 0;
  assert.equal(F.anioFiscal(e, '2027', '2028-03-31').dificil, 0);
});
await prueba('regla del 70 %: manda el año anterior; el año del alta, el propio periodo', () => {
  const e = estadoAutonomo();
  e.facturas.push(fac('s1', '2027-03-01', 'cobrada', 1000, { ivaPct: 21, retPct: 0 }));       // 2027: 1.500 con retención de 2.500 = 60 %
  e.facturas.push(fac('b1', '2028-02-01', 'cobrada', 1000, { ivaPct: 21, retPct: 7 }));       // 2028: todo con retención
  assert.equal(F.anioFiscal(e, '2027', '2028-03-01').t[0].obligado130, true);                 // 1T 2027: 1.000 de 2.000 = 50 %
  const a28 = F.anioFiscal(e, '2028', '2028-03-01');
  assert.deepEqual([Math.round(a28.t[0].pctRetenido), a28.t[0].obligado130], [60, true]);
});
await prueba('IVA negativo de un trimestre se compensa en el siguiente', () => {
  const e = estadoAutonomo(); e.facturas = [fac('q2', '2027-05-05', 'cobrada', 500, { ivaPct: 21, retPct: 7 })]; e.gastos = [gas('g', '2027-02-01', 238.1, 50, 100, 100)];
  const a = F.anioFiscal(e, '2027', HOY);
  assert.deepEqual([a.t[0].iva303, a.t[0].aIngresar303, a.t[1].compensa, a.t[1].aIngresar303, a.total303], [-50, 0, -50, 55, 55]);
});
await prueba('franquicia de IVA: ni IVA ni modelo 303, y el IVA de los gastos pasa a ser gasto', () => {
  const e = estadoAutonomo(); e.ajustes.fiscal.regimenIva = 'franquicia';
  assert.equal(M.desglose(fac('n', '2027-02-10', 'abierta', 1000), e.ajustes.fiscal).iva, 0);
  assert.deepEqual(F.calculoGasto(e.gastos[0], e.ajustes.fiscal), { total: 121, ivaDed: 0, gastoIrpf: 121 });
  assert.equal(F.plazosDelAnio(e, '2027', HOY).find((p) => p.id === '2027-303-1').aplica, false);
});
await prueba('hucha: IVA y 130 sin presentar más la reserva de renta; al presentar, baja', () => {
  const h = F.hucha(A, HOY);
  assert.deepEqual([h.iva, h.m130, h.renta, h.total], [267.75, 0, 17.96, 285.71]);
  const e = structuredClone(A); e.ajustes.fiscal.presentados['2027-303-1'] = true;
  assert.deepEqual([F.hucha(e, HOY).iva, F.hucha(e, HOY).total], [84, 101.96]);
  assert.equal(F.hucha(M.estadoVacio(), HOY).total, 0);
});

console.log('Autónomo: calendario, modelo 347 y simulación');
await prueba('plazos: 20 de abril, julio y octubre; el 30 de enero en sábado pasa al lunes', () => {
  assert.deepEqual([F.diaHabil(2027, 1, 30), F.diaHabil(2027, 4, 20), F.diaHabil(2027, 2, 31), F.diaHabil(2028, 2, 31)], ['2027-02-01', '2027-04-20', '2027-03-01', '2028-02-29']);
  const p = F.plazosDelAnio(A, '2027', HOY), de = (id) => p.find((x) => x.id === id);
  assert.equal(p.length, 11);
  assert.deepEqual([de('2027-303-1').fecha, de('2027-303-4').fecha, de('2027-390').fecha, de('2027-renta').fecha], ['2027-04-20', '2028-01-31', '2028-01-31', '2028-06-30']);
  assert.deepEqual([de('2027-303-1').importe, de('2027-130-1').aplica, de('2027-347').aplica], [183.75, false, false]);
});
await prueba('aviso de plazos: solo lo que toca, no está presentado y vence pronto', () => {
  assert.deepEqual(F.plazosCercanos(A, '2027-04-10').map((p) => p.id), ['2027-303-1']);
  assert.deepEqual(F.plazosCercanos(A, '2027-03-01'), []);
  const e = structuredClone(A); e.ajustes.fiscal.presentados['2027-303-1'] = true;
  assert.deepEqual(F.plazosCercanos(e, '2027-04-10'), []);
  const alta = structuredClone(A); alta.ajustes.fechaAlta = '2027-05-01';
  assert.ok(!F.plazosDelAnio(alta, '2027', HOY).some((p) => p.id === '2027-303-1'));      // antes del alta no hay trimestre
});
await prueba('modelo 347: solo clientes sin retención que pasan del importe', () => {
  const e = estadoAutonomo('empresarial');
  assert.deepEqual(F.clientes347(e, '2027'), []);
  e.ajustes.fiscal.umbral347 = 1500;
  assert.deepEqual(F.clientes347(e, '2027'), [{ clienteId: 'c1', importe: 1815 }]);
  A.ajustes.fiscal.umbral347 = 1500; assert.deepEqual(F.clientes347(A, '2027'), []); A.ajustes.fiscal.umbral347 = 3005.06;
});
await prueba('archivo de calendario: fechas correctas y sin importes', () => {
  const ics = F.aICS(F.plazosDelAnio(A, '2027', HOY).filter((p) => p.aplica), new Date('2027-01-01T10:00:00Z'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20270420') && ics.includes('DTEND;VALUE=DATE:20270421') && ics.includes('UID:2027-303-1@'));
  assert.ok(!ics.includes('€') && !/\d,\d\d/.test(ics) && ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
});
await prueba('simulación: sin fecha de alta, las facturas reales como si fueran de autónomo, con subida de tarifa', () => {
  const e = M.completar(structuredClone(base)); e.ajustes.fiscal.subidaSimPct = 10;
  const a = F.anioFiscal(e, '2025', '2026-06-01');
  assert.equal(a.modo, 'simulacion'); assert.equal(a.n, 2);
  assert.deepEqual([a.base, a.iva, a.retencion, a.netoFacturas, a.cuota, a.neto], [637.98, 133.98, 44.66, 593.32, 1063.68, -470.36]);
  assert.equal(F.hucha(e, '2026-06-01').total, 0);                                         // la hucha solo existe en modo real
  assert.deepEqual(M.totales(e.facturas, e.ajustes), { ...M.totales(base.facturas), nAutonomo: 0 }); // y no toca los datos reales
});
await prueba('un estado de la versión anterior se completa sin perder nada; los gastos viajan en las copias', () => {
  const viejo = { esquema: 1, ajustes: { fechaAlta: null, avisoCopiaDias: 9, _mod: 5, _base: 5 }, clientes: [], facturas: [] };
  const c = M.completar(structuredClone(viejo));
  assert.deepEqual([c.esquema, c.ajustes.avisoCopiaDias, c.ajustes.fiscal.ivaPct, c.ajustes.fiscal.difJustPct, c.gastos], [3, 9, 21, 5, []]);
  const B2 = aplicar(M.estadoVacio(), A);
  assert.equal(B2.gastos.length, 3); assert.equal(B2.ajustes.fechaAlta, '2027-01-01');
  assert.deepEqual(F.anioFiscal(B2, '2027', HOY), F.anioFiscal(A, '2027', HOY));
  const A2 = structuredClone(A); A2.gastos[0].base = 150; A2.gastos[0]._mod = 99;
  assert.deepEqual(casos(B2, A2), { g1: 'archivo' });
  assert.deepEqual(C.diferencias('gastos', B2.gastos[0], A2.gastos[0]), [{ campo: 'Base', aqui: 100, archivo: 150 }]);
  const A3 = structuredClone(A); A3.ajustes.fiscal.ivaPct = 10; A3.ajustes.fiscal.cuotas.push({ desde: '2029-01', importe: 300 });
  assert.deepEqual(C.diferencias('ajustes', A.ajustes, A3.ajustes).map((d) => d.campo), ['IVA %', 'Cuota de autónomos']);
});
await prueba('CSV: las facturas de autónomo llevan su desglose; libro de gastos', () => {
  const filas = aCSV(A).split('\r\n');
  assert.ok(filas[1].endsWith(';cooperativa;;;;;') && filas[2].endsWith(';autónomo;21;210;7;70;1140'));
  const g = gastosCSV(A).split('\r\n');
  assert.equal(g.length, 1 + 3 + 1); assert.ok(g[2].includes(';50;21;10,5;60,5;50;5,25;0;0;sí;'));
});

console.log('Fase 3: amortización y casillas de los modelos');
const material = (id, fecha, base, pct = 26) => ({ ...gas(id, fecha, base, Math.round(base * 21) / 100, 100, 100), amortiza: true, amortPct: pct });
await prueba('amortización lineal por días, sin pasar nunca del valor', () => {
  const g = material('m', '2027-04-01', 1200), f = A.ajustes.fiscal;
  // 1.200 × 26 % = 312 al año. 2027: del 1 abr al 31 dic son 275 días -> 312 × 275 / 365 = 235,07
  assert.deepEqual([F.amortizadoEnAnio(g, f, '2027', '2027-06-30'), F.amortizadoEnAnio(g, f, '2027', '2027-12-31'), F.amortizadoEnAnio(g, f, '2026', '2026-12-31')], [7779, 23507, 0]);
  assert.deepEqual(['2028', '2029', '2030', '2031', '2032'].map((a) => F.amortizadoEnAnio(g, f, a, `${a}-12-31`)), [31200, 31200, 31200, 2893, 0]); // 235,07 + 3 × 312 + 28,93 = 1.200
  assert.equal(F.amortizadoEnAnio({ ...g, amortiza: false }, f, '2027', '2027-12-31'), 0);
  assert.equal(F.amortizadoEnAnio({ ...g, dedIrpf: 50 }, f, '2028', '2028-12-31'), 15600);   // solo la parte afecta
});
await prueba('el material que se amortiza no es gasto de golpe: entra poco a poco; su IVA se deduce al comprarlo', () => {
  const e = structuredClone(A); e.gastos.push(material('m', '2027-04-01', 1200));
  const a = F.anioFiscal(e, '2027', HOY), a0 = F.anioFiscal(A, '2027', HOY);
  assert.deepEqual([a.gastoIrpf, a.t[1].ivaDeducible, a.t[1].corrientes, a.t[1].inversion], [a0.gastoIrpf, 21 + 252, { base: 1400, cuota: 273 }, { base: 0, cuota: 0 }]);
  assert.equal(a.amortizacion, 64.96);                                    // hasta hoy, 15 jun: 76 días -> 312 × 76 / 365
  assert.equal(F.anioFiscal(e, '2027', '2028-02-01').amortizacion, 235.07);
  assert.equal(F.anioFiscal(e, '2028', '2029-02-01').amortizacion, 312);  // sigue amortizando al año siguiente
  e.gastos.push(material('caro', '2027-05-01', 4000));                   // desde 3.005,06 € es «bien de inversión» en el 303
  assert.deepEqual(F.anioFiscal(e, '2027', HOY).t[1].inversion, { base: 4000, cuota: 840 });
});
const cas = (m) => Object.fromEntries(m.casillas.map((c) => [c.n, c.valor]));
await prueba('modelo 303: casillas del trimestre, y compensación del trimestre anterior', () => {
  const m = MO.modelo303(A, '2027', 1, HOY), c = cas(m);
  assert.deepEqual([c['07'], c['09'], c['27'], c['28'], c['29'], c['45'], c['46'], c['69'], c['71']], [1000, 210, 210, 150, 26.25, 26.25, 183.75, 183.75, 183.75]);
  assert.deepEqual([m.resultado, c['110']], [{ texto: 'A ingresar', importe: 183.75 }, undefined]);
  const e = estadoAutonomo(); e.facturas = [fac('q2', '2027-05-05', 'cobrada', 500, { ivaPct: 21, retPct: 7 })]; e.gastos = [gas('g', '2027-02-01', 238.1, 50, 100, 100)];
  assert.deepEqual(MO.modelo303(e, '2027', 1, HOY).resultado, { texto: 'A compensar en el trimestre siguiente', importe: 50 });
  const c2 = cas(MO.modelo303(e, '2027', 2, HOY));
  assert.deepEqual([c2['46'], c2['110'], c2['78'], c2['87'], c2['69'], c2['71']], [105, 50, 50, 0, 55, 55]);
  const diez = estadoAutonomo(); diez.facturas.push(fac('d', '2027-03-01', 'cobrada', 300, { ivaPct: 10, retPct: 7 }));
  const c3 = cas(MO.modelo303(diez, '2027', 1, HOY));
  assert.deepEqual([c3['04'], c3['06'], c3['07'], c3['09'], c3['27']], [300, 30, 1000, 210, 240]);
  A.ajustes.fiscal.regimenIva = 'franquicia'; assert.equal(MO.modelo303(A, '2027', 1, HOY).aplica, false); A.ajustes.fiscal.regimenIva = 'general';
  assert.equal(MO.modelo303(A, '2027', 3, HOY).resultado.texto, 'Sin actividad: marca esa casilla y presenta igualmente');
});
await prueba('modelo 130: las casillas son las del cálculo; con retención avisa de que no toca', () => {
  const m = MO.modelo130(estadoAutonomo('empresarial'), '2027', 1, HOY), c = cas(m);
  assert.deepEqual([m.aplica, c['01'], c['02'], c['03'], c['04'], c['07'], c['13'], c['19'], m.resultado], [true, 1000, 397.62, 602.38, 120.48, 120.48, 100, 20.48, { texto: 'A ingresar', importe: 20.48 }]);
  const p = MO.modelo130(A, '2027', 1, HOY);
  assert.equal(p.aplica, false); assert.match(p.motivo, /el 100 % de tus ingresos lleva retención/);
  assert.equal(cas(p)['06'], 70);
});
await prueba('modelo 390: suma de los cuatro 303', () => {
  const c = cas(MO.modelo390(A, '2027', HOY));
  assert.deepEqual([c['05'], c['06'], c['33'], c['34'], c['47'], c['48'], c['49'], c['64'], c['65'], c['86'], c['95'], c['99'], c['108']],
    [1500, 315, 1500, 315, 315, 350, 47.25, 47.25, 267.75, 267.75, 267.75, 1500, 1500]);
  const suma303 = [1, 2, 3, 4].reduce((s, q) => s + Math.round(cas(MO.modelo303(A, '2027', q, HOY))['71'] * 100), 0) / 100;
  assert.equal(c['86'], suma303);
});
await prueba('resumen para la renta: conceptos de la actividad, lo pagado a cuenta y la parte de cooperativa', () => {
  const e = structuredClone(A); e.facturas.push(fac('coop27', '2026-12-20', 'cobrada', 300, { neto: 250, diasSS: 1 }));
  const r = MO.resumenRenta(A, '2027', HOY), v = (i, nombre) => r.secciones[i].filas.find((f) => f.nombre.startsWith(nombre)).valor;
  assert.deepEqual([r.simulacion, r.secciones.length, v(0, 'Ingresos'), v(0, 'Seguridad Social'), v(0, 'Material y herramientas'), v(0, 'Provisiones'), v(0, 'Rendimiento neto'), v(1, 'Retenciones'), v(1, 'Pagos')],
    [false, 2, 1500, 531.84, 321, 32.36, 614.8, 105, 0]);
  const r26 = MO.resumenRenta(e, '2026', HOY);                              // 2026 es anterior al alta: simulación + cooperativa real
  assert.equal(r26.simulacion, true);
  assert.deepEqual(r26.secciones[2].filas.map((f) => f.valor), [800, 650, '3']);
  A.ajustes.fiscal.reduccionInicio = true;
  const red = MO.resumenRenta(A, '2027', HOY).secciones[0].filas;
  assert.deepEqual(red.slice(-2).map((f) => f.valor), [122.96, 491.84]);    // 20 % de 614,80 y lo que queda
  A.ajustes.fiscal.reduccionInicio = false;
});

console.log('Fase 3B: tarifa plana');
await prueba('beneficio para la Seguridad Social: beneficio fiscal + cuota, menos el 7 %', () => {
  // 614,80 de beneficio + 531,84 de cuota = 1.146,64; menos el 7 % = 1.066,38
  assert.equal(F.beneficioSS(F.anioFiscal(A, '2027', HOY), A.ajustes.fiscal), 1066.38);
  assert.equal(F.beneficioSS({ rendimiento: 10000, cuota: 1063.68 }, { genericosSSPct: 7 }), 10289.22);
  assert.equal(F.beneficioSS({ rendimiento: -500, cuota: 100 }, { genericosSSPct: 7 }), -400); // en pérdidas no hay descuento
});
await prueba('a este ritmo: lo que llevas repartido por los días pasados y alargado hasta fin de año', () => {
  const r = F.ritmoSS(A, '2027', HOY);
  // del 1 de enero al 15 de junio van 166 días de 365: 1.066,38 × 365 / 166 = 2.344,75
  assert.deepEqual([r.llevas, r.proyeccion, r.smi, r.cumple, r.cerrado], [1066.38, 2344.75, 17094, true, false]);
  const c = F.ritmoSS(A, '2027', '2028-03-01');
  assert.equal(c.cerrado, true); assert.equal(c.proyeccion, c.llevas);   // año cerrado: la cifra es la final
  const caro = structuredClone(A); caro.ajustes.fiscal.smiAnual = 2000;
  assert.equal(F.ritmoSS(caro, '2027', HOY).cumple, false);
});
await prueba('tarifa plana: 12 meses naturales completos, prórroga, aviso antes de que acabe y aviso del tramo de cuota', () => {
  assert.equal(F.tarifaPlana(M.estadoVacio(), HOY), null);                 // sin fecha de alta no hay tarifa plana
  let t = F.tarifaPlana(A, HOY);                                          // alta el 1 de enero de 2027
  assert.deepEqual([t.fin1, t.fin2, t.fin, t.fase, t.dias, t.mesNuevo, t.faltaTramo, t.avisar], ['2027-12-31', '2028-12-31', '2027-12-31', 'primer', 199, '2028-01', true, null]);
  assert.deepEqual(t.anios.map((r) => [r.anio, r.futuro]), [['2028', true]]);
  assert.equal(F.tarifaPlana(A, '2027-11-15').avisar, 'fin');             // faltan 46 días y no la has pedido
  const pedida = structuredClone(A); pedida.ajustes.fiscal.prorrogaPedida = true;
  t = F.tarifaPlana(pedida, '2027-11-15');
  assert.deepEqual([t.fin, t.fase, t.mesNuevo, t.avisar], ['2028-12-31', 'primer', '2029-01', null]);
  assert.equal(F.tarifaPlana(pedida, '2028-06-01').fase, 'prorroga');
  assert.deepEqual([F.tarifaPlana(A, '2028-01-10').fase, F.tarifaPlana(A, '2028-01-10').avisar], ['acabada', 'tramo']);
  const conTramo = structuredClone(A); conTramo.ajustes.fiscal.cuotas.push({ desde: '2028-01', importe: 300 });
  assert.equal(F.tarifaPlana(conTramo, '2028-01-10').avisar, null);       // con la cuota nueva apuntada ya no avisa
  const medio = structuredClone(A); medio.ajustes.fechaAlta = '2027-02-15'; // alta a mitad de mes: febrero va aparte
  t = F.tarifaPlana(medio, HOY);
  assert.deepEqual([t.fin1, t.fin2, t.anios.map((r) => r.anio)], ['2028-02-29', '2029-02-28', ['2028', '2029']]);
});
await prueba('los ajustes nuevos de la tarifa plana se añaden a un estado guardado con la versión anterior', () => {
  const viejo = structuredClone(A); for (const k of ['tarifaPlanaMeses', 'prorrogaMeses', 'smiAnual', 'genericosSSPct', 'prorrogaPedida', 'avisoTarifaDias']) delete viejo.ajustes.fiscal[k];
  const f = M.completar(viejo).ajustes.fiscal;
  assert.deepEqual([f.tarifaPlanaMeses, f.prorrogaMeses, f.smiAnual, f.genericosSSPct, f.prorrogaPedida, f.avisoTarifaDias], [12, 12, 17094, 7, false, 60]);
});

console.log('Fase 3B: cuota según el beneficio');
await prueba('tabla de tramos: cuota = base mínima × tipo de cotización; el tramo es el primero que no se supera', () => {
  const f = A.ajustes.fiscal;
  // 950,98 × 31,5 % = 299,56 · 960,78 × 31,5 % = 302,65
  assert.deepEqual(F.tramoDe(f, 1282), { hasta: 1300, base: 950.98, cuota: 299.56 });
  assert.deepEqual(F.tramoDe(f, 1300.01), { hasta: 1500, base: 960.78, cuota: 302.65 });
  assert.deepEqual([F.tramoDe(f, -50).cuota, F.tramoDe(f, 670).cuota, F.tramoDe(f, 7000)], [205.88, 205.88, { hasta: null, base: 1928.1, cuota: 607.35 }]);
});
await prueba('cuota estimada y gasto deducible que falta para no pasar del límite', () => {
  const e = estadoAutonomo(); e.facturas.push(fac('a4', '2027-09-01', 'pendiente', 20000, { ivaPct: 21, retPct: 7 }));
  // 2027 cerrado: 21.500 de ingresos − 321 de gastos − 1.063,68 de cuota = 20.115,32; − 5 % (1.005,77) = 19.109,55 de beneficio.
  // Seguridad Social: (19.109,55 + 1.063,68) × 0,93 = 18.761,10 al año; / 365 × 30 = 1.542,01 al mes -> tramo hasta 1.700: 302,65 €.
  let c = F.cuotaEstimada(e, '2027', '2028-02-01');
  assert.deepEqual([c.anual, c.dias, c.mensual, c.tramo.hasta, c.cuota, c.limite, c.objetivo.hasta, c.objetivo.cuota], [18761.1, 365, 1542.01, 1700, 302.65, 300, 1300, 299.56]);
  // Para bajar a 1.300 al mes (15.816,67 al año) sobran 2.944,43; cada euro de gasto baja 0,93 × 0,95 = 0,8835 -> 3.332,69 de gasto.
  assert.equal(c.falta, 3332.69);
  e.gastos.push(gas('g9', '2027-10-01', 3332.69, 0, 100, 100));          // con ese gasto de más, ya cae en el tramo de 299,56
  c = F.cuotaEstimada(e, '2027', '2028-02-01');
  assert.deepEqual([c.cuota, c.falta], [299.56, 0]);
  e.ajustes.fiscal.limiteCuota = 100;                                     // ningún tramo baja de 100 €: no hay objetivo
  c = F.cuotaEstimada(e, '2027', '2028-02-01');
  assert.deepEqual([c.objetivo, c.falta], [null, null]);
  c = F.cuotaEstimada(A, '2027', HOY);                                    // año en curso con poco beneficio: primer tramo
  // 2.344,75 a este ritmo / 365 × 30 = 192,72 al mes
  assert.deepEqual([c.anual, c.mensual, c.cuota, c.falta], [2344.75, 192.72, 205.88, 0]);
});
await prueba('con los gastos de difícil justificación en su tope, cada euro de gasto baja el beneficio entero (× 0,93)', () => {
  const e = estadoAutonomo(); e.facturas.push(fac('a5', '2027-09-01', 'pendiente', 60000, { ivaPct: 21, retPct: 7 }));
  const c = F.cuotaEstimada(e, '2027', '2028-02-01');
  // antes de difícil justificación: 61.500 − 321 − 1.063,68 = 60.115,32; el 5 % pasaría de 2.000, así que son 2.000
  assert.equal(F.anioFiscal(e, '2027', '2028-02-01').dificil, 2000);
  assert.equal(c.porEuro, 0.93);
  // (58.115,32 + 1.063,68) × 0,93 = 55.036,47 al año; sobran 55.036,47 − 15.816,67 = 39.219,80; / 0,93 = 42.171,83
  assert.deepEqual([c.anual, c.falta], [55036.47, 42171.83]);
});

const ruta = process.argv[2];
if (ruta) {
  console.log('Copia real: ' + ruta);
  const copia = JSON.parse(readFileSync(ruta, 'utf8'));
  const r = migrarCopiaV2(copia);
  console.log('   archivo:', r.informe.archivo); console.log('   app:    ', r.informe.app);
  console.log('   netos descartados:', r.informe.netosDescartados, '· huecos:', r.informe.huecos, '· fechas puestas:', r.informe.fechasPuestas);
  console.log('   plazos asignados:', r.informe.plazosAsignados.length, '· sin cliente:', r.informe.plazosSinCliente.length);
  await prueba('las cifras de la app cuadran con las del archivo', () => {
    const a = r.informe.archivo, b = r.informe.app;
    assert.deepEqual([a.facturas, a.servicios, a.bruto, a.dias], [b.facturas, b.servicios, b.bruto, b.dias]);
    const desc = r.informe.netosDescartados.reduce((x, y) => x + y.neto, 0);
    assert.ok(Math.abs(a.neto - desc - b.neto) < 0.005);
  });
  if (process.argv[3]) await prueba('cifras de control esperadas', () => assert.deepEqual(
    [r.informe.app.facturas, r.informe.app.servicios, r.informe.app.bruto, r.informe.app.neto, r.informe.app.dias], JSON.parse(process.argv[3])));
  const t = M.totales(r.estado.facturas);
  console.log('   neto cobrado:', t.netoCobrado, `(${t.nCobradas})`, '· neto previsto:', t.netoPrevisto, `(${t.nPrevistas})`, '· bruto sin neto:', t.brutoSinNeto, `(${t.nSinNeto})`);
  console.log('   por año:', M.resumenPorAnio(r.estado).map((x) => `${x.anio}: ${x.n} fact, neto cobrado ${x.netoCobrado}, bruto ${x.bruto}, días ${x.dias}`));
  await prueba('simulación con la copia real: lo facturado en la simulación es lo emitido de cada año', () => {
    for (const x of M.resumenPorAnio(r.estado)) {
      const a = F.anioFiscal(r.estado, x.anio);
      const emitido = M.vivos(r.estado.facturas).filter((f) => f.estado !== 'abierta' && M.anioDe(f) === x.anio).reduce((s, f) => s + Math.round(M.bruto(f) * 100), 0) / 100;
      assert.equal(a.base, emitido); assert.equal(a.modo, 'simulacion');
      console.log(`   simulación ${x.anio}: facturado ${a.base} · IVA ${a.iva} · retención ${a.retencion} · cuota ${a.cuota} · neto ${a.neto} · reserva renta ${a.reservaRenta}`);
    }
  });
}
console.log(`\n${n} pruebas correctas`);
