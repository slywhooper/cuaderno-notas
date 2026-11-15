// modelos.js — Las cifras para presentar: casillas de los modelos 303, 130 y 390 y el resumen para la renta.
// Solo ordena y explica lo que ya calcula fiscal.js. Funciones puras.
//
// Los NÚMEROS DE CASILLA son los de los modelos vigentes en 2026 (instrucciones de la Agencia Tributaria).
// Si Hacienda los cambia, se tocan solo aquí (TIPOS_303, TIPOS_390 y los números de cada fila). En pantalla se
// avisa de que, ante la duda, manda el nombre de la casilla, no el número.
// En la renta no se dan números de casilla porque cambian cada año: se dan los conceptos tal como los pide Renta Web.
//
// Cada fila: { n (casilla), nombre, valor (euros, o texto), de (de dónde sale, en lenguaje llano), fuerte? }
// Se supone el caso normal de un autónomo en territorio común: sin recargo de equivalencia, sin operaciones con
// el extranjero, sin prorrata, y pidiendo la devolución en el 4T si el IVA del año sale a favor.

import { vivos, cent, anioDe, esAutonomo, totales } from './modelo.js';
import { anioFiscal, calculoGasto, modoDe } from './fiscal.js';

const fila = (n, nombre, valor, de, fuerte = false) => ({ n, nombre, valor, de, fuerte });
const e = (c) => c / 100;                       // céntimos -> euros
const porNumero = (a, b) => Number(a[0]) - Number(b[0]);

// Tipo de IVA -> casillas del modelo 303 [base, tipo, cuota] y del 390 [base, cuota]
const TIPOS_303 = { 0: ['150', '151', '152'], 4: ['01', '02', '03'], 10: ['04', '05', '06'], 21: ['07', '08', '09'] };
const TIPOS_390 = { 4: ['01', '02'], 10: ['03', '04'], 21: ['05', '06'] };

/** Modelo 303 de un trimestre. { aplica, motivo, casillas[], resultado: { texto, importe } } */
export function modelo303(estado, anio, q, hoy) {
  const a = anioFiscal(estado, anio, hoy), t = a.t[q - 1];
  if (!a.general) return { aplica: false, motivo: 'Con la franquicia de IVA no se cobra IVA ni se presenta el modelo 303.', casillas: [] };
  const c = [];
  for (const [tipo, v] of Object.entries(t.porTipo).sort(porNumero)) {
    const k = TIPOS_303[Number(tipo)];
    if (k) {
      c.push(fila(k[0], `Base imponible al ${tipo} %`, v.base, `La suma, sin IVA, de tus ${t.n} facturas emitidas en el trimestre con IVA al ${tipo} %. Cuentan por su fecha de factura, estén cobradas o no.`));
      c.push(fila(k[2], `Cuota al ${tipo} %`, v.cuota, `El IVA de esas facturas: el ${tipo} % de la base (en la casilla ${k[1]} va el tipo, ${tipo}).`));
    } else c.push(fila('?', `Base ${v.base} € y cuota ${v.cuota} € al ${tipo} %`, 'Revisar', 'Este tipo de IVA no tiene casilla asignada en la app. Mira en el modelo dónde va, o corrige el IVA de la factura.'));
  }
  const dev = cent(t.iva), ded = cent(t.ivaDeducible), r46 = dev - ded;
  c.push(fila('27', 'Total cuota devengada', t.iva, 'Todo el IVA que has cobrado (o vas a cobrar) en las facturas del trimestre.', true));
  if (t.corrientes.base || !t.inversion.base) {
    c.push(fila('28', 'Base de las operaciones interiores corrientes', t.corrientes.base, 'La base (sin IVA) de los gastos del trimestre con IVA deducible. Va entera aunque solo deduzcas una parte.'));
    c.push(fila('29', 'Cuota deducible de operaciones interiores corrientes', t.corrientes.cuota, 'El IVA de esos gastos que puedes deducir: el IVA de cada gasto por su % deducible de IVA.'));
  }
  if (t.inversion.base) {
    c.push(fila('30', 'Base de las operaciones interiores con bienes de inversión', t.inversion.base, 'La base del material que amortizas y que supera el importe de «bien de inversión» de tus ajustes.'));
    c.push(fila('31', 'Cuota deducible de bienes de inversión', t.inversion.cuota, 'El IVA deducible de ese material. Se deduce entero en el trimestre de la compra.'));
  }
  c.push(fila('45', 'Total a deducir', t.ivaDeducible, 'La suma de las cuotas deducibles (29 + 31).', true));
  c.push(fila('46', 'Resultado régimen general', e(r46), 'Lo cobrado menos lo deducible: casilla 27 − casilla 45.', true));
  c.push(fila('64', 'Suma de resultados', e(r46), 'Igual que la 46: solo tienes régimen general.'));
  c.push(fila('66', 'Atribuible a la Administración del Estado', e(r46), 'Igual que la 64 (en la casilla 65 va 100 %).'));
  const c110 = -cent(t.compensa), c78 = Math.min(c110, Math.max(0, r46)), c69 = r46 - c78;
  if (c110) {
    c.push(fila('110', 'Cuotas a compensar pendientes de periodos anteriores', e(c110), 'El IVA a tu favor que arrastras de trimestres anteriores de este año.'));
    c.push(fila('78', 'Cuotas a compensar aplicadas en este periodo', e(c78), 'La parte de ese saldo que usas ahora: como mucho, lo que te sale a pagar en la casilla 66.'));
    c.push(fila('87', 'Cuotas a compensar pendientes para periodos posteriores', e(c110 - c78), 'Lo que te queda por usar: casilla 110 − casilla 78.'));
  }
  c.push(fila('69', 'Resultado', e(c69), c110 ? 'Casilla 66 − casilla 78.' : 'Igual que la casilla 66.', true));
  c.push(fila('71', 'Resultado de la liquidación', e(c69), 'Igual que la 69 (las casillas 70 y 109 son solo para rectificaciones).', true));
  const sinActividad = !t.n && !t.nGastos && !c110;
  const texto = sinActividad ? 'Sin actividad: marca esa casilla y presenta igualmente' : c69 > 0 ? 'A ingresar' : c69 === 0 ? 'Resultado cero' : q < 4 ? 'A compensar en el trimestre siguiente' : 'A tu favor: pide la devolución (o compénsalo el año siguiente)';
  return { aplica: true, casillas: c, resultado: { texto, importe: Math.abs(e(c69)) } };
}

/** Modelo 130 de un trimestre (datos acumulados desde enero). */
export function modelo130(estado, anio, q, hoy) {
  const a = anioFiscal(estado, anio, hoy), t = a.t[q - 1], k = t.c130, f = estado.ajustes.fiscal;
  const p = (n) => String(n).replace('.', ',');
  const motivo = t.obligado130 ? '' : `No tienes que presentarlo: el ${Math.round(t.pctRetenido)} % de tus ingresos lleva retención y el mínimo para librarte es el ${p(f.umbralRetenidoPct)} %. Las cifras de abajo son solo para que las veas.`;
  const partes = [`gastos apuntados ${p(t.acum.gastosDirectos)} €`, `cuota de autónomos ${p(t.acum.cuota)} €`];
  if (t.acum.amortizacion) partes.push(`amortización ${p(t.acum.amortizacion)} €`);
  if (t.acum.dificil) partes.push(`gastos de difícil justificación ${p(t.acum.dificil)} € (el ${p(f.difJustPct)} % del beneficio, con tope de ${p(f.difJustMax)} € al año)`);
  const c = [
    fila('01', 'Ingresos computables', k['01'], `Lo facturado sin IVA desde el 1 de enero hasta el final del ${q}T. Facturas emitidas, por fecha de factura.`),
    fila('02', 'Gastos fiscalmente deducibles', k['02'], `Desde el 1 de enero: ${partes.join(' + ')}.`),
    fila('03', 'Rendimiento neto', k['03'], 'Casilla 01 − casilla 02. Si sale negativo, va con signo menos.', true),
    fila('04', `${p(f.pagoFraccionadoPct)} % de la casilla 03`, k['04'], 'Si la casilla 03 es negativa, aquí va cero.'),
    fila('05', 'De los trimestres anteriores', k['05'], 'La suma de las casillas 07 positivas de los trimestres anteriores de este año.'),
    fila('06', 'Retenciones e ingresos a cuenta', k['06'], 'Lo que te han retenido tus clientes en las facturas desde el 1 de enero.'),
    fila('07', 'Pago fraccionado previo del trimestre', k['07'], 'Casilla 04 − casilla 05 − casilla 06.', true),
    fila('12', 'Suma de pagos fraccionados previos', k['12'], 'La casilla 07 si es positiva; si no, cero.'),
    fila('13', 'Minoración (artículo 110.3.c)', k['13'], 'Rebaja fija por trimestre según tu beneficio del año anterior (tabla en Ajustes de autónomo). Si el año anterior no fuiste autónomo, cuenta como beneficio cero.'),
    fila('14', 'Diferencia', k['14'], 'Casilla 12 − casilla 13.'),
  ];
  if (k['15']) c.push(fila('15', 'Resultados negativos de trimestres anteriores', k['15'], 'Lo que salió negativo en la casilla 19 de trimestres anteriores de este año y aún no has descontado. Solo si la 14 es positiva.'));
  c.push(fila('17', 'Total', k['17'], 'Casilla 14 − casilla 15 − casilla 16 (la 16 es la deducción por vivienda: cero si no la tienes).'));
  c.push(fila('19', 'Resultado', k['19'], 'Igual que la 17 (la 18 es solo para complementarias).', true));
  const texto = k['19'] > 0 ? 'A ingresar' : 'Negativa: se presenta igualmente, sin pagar';
  return { aplica: t.obligado130, motivo, casillas: c, resultado: { texto, importe: Math.max(0, k['19']) } };
}

/** Modelo 390: resumen anual del IVA. */
export function modelo390(estado, anio, hoy) {
  const a = anioFiscal(estado, anio, hoy);
  if (!a.general) return { aplica: false, motivo: 'Con la franquicia de IVA no se presenta el modelo 390.', casillas: [] };
  const tipos = {}, corr = { base: 0, cuota: 0 }, inv = { base: 0, cuota: 0 };
  for (const t of a.t) {
    for (const [tipo, v] of Object.entries(t.porTipo)) { const x = (tipos[tipo] ||= { base: 0, cuota: 0 }); x.base += cent(v.base); x.cuota += cent(v.cuota); }
    corr.base += cent(t.corrientes.base); corr.cuota += cent(t.corrientes.cuota); inv.base += cent(t.inversion.base); inv.cuota += cent(t.inversion.cuota);
  }
  const c = [];
  for (const [tipo, v] of Object.entries(tipos).sort(porNumero)) {
    const k = TIPOS_390[Number(tipo)];
    if (k) {
      c.push(fila(k[0], `Base imponible al ${tipo} %`, e(v.base), `La suma del año de las bases al ${tipo} % de tus cuatro modelos 303.`));
      c.push(fila(k[1], `Cuota devengada al ${tipo} %`, e(v.cuota), `La suma del año de las cuotas al ${tipo} % de tus cuatro modelos 303.`));
    } else c.push(fila('?', `Base ${e(v.base)} € y cuota ${e(v.cuota)} € al ${tipo} %`, 'Revisar', 'Este tipo de IVA no tiene casilla asignada en la app. Mira en el modelo dónde va.'));
  }
  const dev = cent(a.iva), ded = corr.cuota + inv.cuota, base = cent(a.base);
  c.push(fila('33', 'Total bases', a.base, 'La suma de todas las bases.'), fila('34', 'Total cuotas de IVA', e(dev), 'La suma de todas las cuotas.'));
  c.push(fila('47', 'Total cuotas de IVA y recargo de equivalencia', e(dev), 'Igual que la 34: no tienes recargo de equivalencia.', true));
  c.push(fila('48', 'Base de las operaciones interiores corrientes', e(corr.base), 'La suma del año de las casillas 28 de tus modelos 303. En el modelo se reparte por tipo de IVA en las filas de encima.'));
  c.push(fila('49', 'Cuota deducible de operaciones interiores corrientes', e(corr.cuota), 'La suma del año de las casillas 29.'));
  if (inv.base) {
    c.push(fila('50', 'Base de las operaciones interiores con bienes de inversión', e(inv.base), 'La suma del año de las casillas 30.'));
    c.push(fila('51', 'Cuota deducible de bienes de inversión', e(inv.cuota), 'La suma del año de las casillas 31.'));
  }
  c.push(fila('64', 'Suma de deducciones', e(ded), 'Casilla 49 + casilla 51.', true));
  c.push(fila('65', 'Resultado régimen general', e(dev - ded), 'Casilla 47 − casilla 64.', true));
  c.push(fila('84', 'Suma de resultados', e(dev - ded), 'Igual que la 65.'));
  c.push(fila('86', 'Resultado de la liquidación', e(dev - ded), 'Casilla 84 − casilla 85. La 85 (compensación de cuotas del año anterior) es cero si el año pasado pediste la devolución o no te salió a favor.', true));
  const t4 = a.t[3], c110 = -cent(t4.compensa), r46 = cent(t4.iva303), c78 = Math.min(c110, Math.max(0, r46)), c69 = r46 - c78;
  c.push(fila('95', 'Total resultados a ingresar en las autoliquidaciones del año', a.total303, 'La suma de lo que te salió a ingresar en los modelos 303 del año.', true));
  if (c69 < 0) c.push(fila('97 o 98', 'A compensar (97) o a devolver (98) en el último trimestre', e(-c69), 'Lo que te salió a tu favor en el modelo 303 del 4T. Va en la 97 si lo dejas para compensar y en la 98 si pediste la devolución.'));
  if (c110 - c78) c.push(fila('662', 'Cuotas pendientes de compensación generadas en el año', e(c110 - c78), 'IVA a tu favor de trimestres anteriores al último que no has llegado a usar.'));
  c.push(fila('99', 'Operaciones en régimen general', e(base), 'Todo lo facturado en el año, sin IVA.'));
  c.push(fila('108', 'Total volumen de operaciones', e(base), 'Igual que la 99: no tienes otros tipos de operaciones.', true));
  return { aplica: true, casillas: c, resultado: { texto: 'Informativo: no se paga nada con este modelo', importe: null } };
}

/**
 * Resumen para la declaración de la renta: las cifras para copiar en Renta Web, por conceptos.
 * { simulacion, secciones: [{ titulo, nota?, filas[] }] }
 */
export function resumenRenta(estado, anio, hoy) {
  anio = String(anio);
  const a = anioFiscal(estado, anio, hoy), fiscal = estado.ajustes.fiscal, sim = modoDe(estado, anio) === 'simulacion';
  const cats = new Map((fiscal.categorias || []).map((c) => [c.id, c.nombre])), por = new Map();
  for (const g of vivos(estado.gastos || [])) {
    if (!g.fecha || g.fecha.slice(0, 4) !== anio || g.amortiza || !(sim || g.fecha >= estado.ajustes.fechaAlta)) continue;
    const c = cent(calculoGasto(g, fiscal).gastoIrpf);
    if (c) por.set(g.categoria, (por.get(g.categoria) || 0) + c);
  }
  const act = [
    fila('', 'Ingresos de explotación', a.base, 'Todo lo facturado en el año sin IVA (facturas emitidas, por fecha de factura). En Renta Web: ingresos de explotación / prestación de servicios.', true),
    fila('', 'Seguridad Social del titular', a.cuota, `La cuota de autónomos de ${a.mesesCuota} meses, según los tramos de tus ajustes. Compárala con tus recibos.`),
    ...[...por].map(([id, c]) => fila('', cats.get(id) || 'Sin categoría', e(c), 'Tus gastos de esta categoría en la parte deducible en el IRPF. En Renta Web repártelos en el concepto que mejor encaje (suministros, otros servicios exteriores, otros gastos…).')),
  ];
  if (a.amortizacion) act.push(fila('', 'Amortizaciones', a.amortizacion, 'La parte de este año del material que amortizas: valor × % anual × días en uso.'));
  act.push(fila('', 'Provisiones y gastos de difícil justificación', a.dificil, `El ${String(fiscal.difJustPct).replace('.', ',')} % del beneficio antes de este concepto, con tope de ${fiscal.difJustMax} €. Renta Web lo calcula solo en estimación directa simplificada: comprueba que coincide.`));
  act.push(fila('', 'Rendimiento neto', a.rendimiento, 'Ingresos menos todos los gastos anteriores.', true));
  if (fiscal.reduccionInicio) {
    const red = Math.round(Math.max(0, cent(a.rendimiento)) * (Number(fiscal.reduccionInicioPct) || 0) / 100);
    act.push(fila('', `Reducción por inicio de actividad (${fiscal.reduccionInicioPct} %)`, e(red), 'Solo el primer año con beneficio y el siguiente, y solo si cumples los requisitos. Se marca en Renta Web y la calcula el programa.'));
    act.push(fila('', 'Rendimiento neto reducido', e(cent(a.rendimiento) - red), 'Rendimiento neto menos la reducción.', true));
  }
  const pagos = [
    fila('', 'Retenciones de actividades económicas', a.retencion, 'Lo que te han retenido tus clientes en las facturas del año. Tiene que cuadrar con los certificados de retenciones que te den.', true),
    fila('', 'Pagos fraccionados (modelo 130)', a.total130, 'La suma de lo ingresado con los modelos 130 del año.', true),
  ];
  const secciones = [{ titulo: 'Actividad económica · estimación directa simplificada', filas: act }, { titulo: 'Ya pagado a cuenta', filas: pagos }];
  const coop = vivos(estado.facturas).filter((f) => anioDe(f) === anio && !esAutonomo(f, estado.ajustes));
  if (coop.length) {
    const t = totales(coop);
    secciones.push({ titulo: 'Cooperativa · rendimientos del trabajo', nota: 'Estos importes van como rendimientos del trabajo con los datos del certificado que te da la cooperativa, no con estos. Sirven para comprobar.',
      filas: [fila('', 'Facturado por cooperativa', t.bruto, `Lo facturado en ${plural(t.n)} de cooperativa del año.`), fila('', 'Neto cobrado', t.netoCobrado, 'La suma de los netos que apuntaste al cobrar.'), fila('', 'Días cotizados', `${t.dias}`, 'Los días de alta que apuntaste en cada factura.')] });
  }
  return { simulacion: sim, secciones };
}
const plural = (n) => `${n} factura${n === 1 ? '' : 's'}`;
