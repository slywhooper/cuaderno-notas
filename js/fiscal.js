// fiscal.js — Cálculos de autónomo: gastos, IVA (303), IRPF (130), cuota, hucha, calendario y simulación.
// Funciones puras: reciben el estado y devuelven números. No tocan pantalla ni disco.
// Todos los porcentajes e importes salen de estado.ajustes.fiscal (ver fiscalPorDefecto() en modelo.js).
//
// REGLAS (acordadas con el usuario; cámbialas solo con su visto bueno):
//  - Cuentan las facturas emitidas (pendientes de cobro o cobradas), por FECHA DE FACTURA. Las «sin cerrar» no.
//  - IVA del trimestre = IVA de las facturas − IVA deducible de los gastos. Si sale negativo se compensa en el
//    trimestre siguiente del mismo año. Con franquicia de IVA no hay IVA ni modelo 303.
//  - Gasto para el IRPF = (base + IVA no deducible) × % deducible de IRPF.
//  - La cuota de autónomos cuenta sola como gasto del IRPF (lista de tramos de ajustes). No se apunta a mano.
//  - Modelo 130 del trimestre = % × rendimiento neto acumulado del año − retenciones acumuladas − pagos anteriores.
//    El epígrafe empresarial siempre lo presenta. Profesional o artística no lo presenta si el 70 % de los
//    ingresos del AÑO ANTERIOR llevó retención; si el año anterior no hubo actividad, cuenta el propio periodo.
//  - Hucha = IVA y modelo 130 de los trimestres ya empezados y no presentados + reserva para la renta
//    (% del rendimiento − retenciones − pagos del 130) de cada año cuya renta no se haya presentado.
//  - Modo 'real' desde el año de la fecha de alta; antes (o sin fecha), 'simulacion': las facturas del año
//    como si fueran de autónomo, con la subida de tarifa de ajustes.
//  - Fase 3: el material que se amortiza no es gasto de golpe: cada año cuenta valor × % anual × días en uso.
//    Gastos de difícil justificación: % del beneficio (antes de ellos) con tope anual; van dentro de los gastos.
//    El modelo 130 se calcula casilla a casilla (01-07 y 12-19), con la minoración de la casilla 13 según el
//    beneficio del año anterior (sin año anterior cuenta como 0) y los resultados negativos de trimestres anteriores.

import { vivos, cent, bruto, fechaISO, hoyISO, anioDe, fechaDeFactura, esAutonomo, desglose } from './modelo.js';

const pct = (v) => Number(v) || 0;
const dos = (n) => String(n).padStart(2, '0');
export const trimestreDe = (iso) => Math.ceil(Number(iso.slice(5, 7)) / 3);

/** 'real' si el año es el del alta o posterior; si no (o sin fecha de alta), 'simulacion'. */
export function modoDe(estado, anio) {
  const alta = estado.ajustes.fechaAlta;
  return alta && String(anio) >= alta.slice(0, 4) ? 'real' : 'simulacion';
}

// ---------- gastos ----------
/** Lo que un gasto resta de IVA y de IRPF. */
export function calculoGasto(g, fiscal) {
  const base = cent(g.base), iva = cent(g.iva);
  const ivaDed = fiscal.regimenIva === 'franquicia' ? 0 : Math.round(iva * pct(g.dedIva) / 100);
  const gastoIrpf = Math.round((base + iva - ivaDed) * pct(g.dedIrpf) / 100);
  return { total: (base + iva) / 100, ivaDed: ivaDed / 100, gastoIrpf: gastoIrpf / 100 };
}

// ---------- cuota de autónomos ----------
/** Cuota de un mes 'AAAA-MM': la del tramo más reciente que ya haya empezado ('' = desde el alta). */
export function cuotaDelMes(fiscal, ym) {
  let mejor = null;
  for (const t of fiscal.cuotas || []) {
    const d = t.desde || '';
    if (d <= ym && (!mejor || d >= (mejor.desde || ''))) mejor = t;
  }
  return mejor ? pct(mejor.importe) : 0;
}
/** Meses (1-12) del año en los que se paga cuota hasta hoy. En simulación, desde enero. */
function mesesConCuota(estado, anio, hoy, sim) {
  const alta = estado.ajustes.fechaAlta;
  const ini = !sim && alta.slice(0, 4) === anio ? Number(alta.slice(5, 7)) : 1;
  const fin = anio < hoy.slice(0, 4) ? 12 : anio === hoy.slice(0, 4) ? Number(hoy.slice(5, 7)) : 0;
  const meses = [];
  for (let m = ini; m <= fin; m++) meses.push(m);
  return meses;
}
/** Cuota de un mes del año. En simulación se usa siempre el primer tramo de la lista (como un primer año). */
function cuotaMes(fiscal, anio, m, sim) {
  if (!sim) return cuotaDelMes(fiscal, `${anio}-${dos(m)}`);
  const primero = [...(fiscal.cuotas || [])].sort((a, b) => (a.desde || '').localeCompare(b.desde || ''))[0];
  return primero ? pct(primero.importe) : 0;
}
/** Cuota pagada en un año (o en todos, con 'todo') hasta hoy, solo en modo real. Para restarla del neto. */
export function cuotaPagada(estado, anio, hoy = hoyISO()) {
  const alta = estado.ajustes.fechaAlta;
  if (!alta) return 0;
  const anios = [];
  if (anio === 'todo') for (let a = Number(alta.slice(0, 4)); a <= Number(hoy.slice(0, 4)); a++) anios.push(String(a));
  else if (anio >= alta.slice(0, 4)) anios.push(anio);
  let c = 0;
  for (const a of anios) for (const m of mesesConCuota(estado, a, hoy, false)) c += cent(cuotaDelMes(estado.ajustes.fiscal, `${a}-${dos(m)}`));
  return c / 100;
}

// ---------- material que se amortiza ----------
const diasDelAnio = (a) => (new Date(a, 1, 29).getMonth() === 1 ? 366 : 365);
const diasEntre = (desde, hasta) => Math.round((new Date(hasta + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 864e5) + 1;
/** Valor que se amortiza de un gasto: lo pagado sin el IVA deducible, en la parte afecta a la actividad (céntimos). */
function valorAmortizable(g, fiscal) {
  const base = cent(g.base), iva = cent(g.iva);
  const ivaDed = fiscal.regimenIva === 'franquicia' ? 0 : Math.round(iva * pct(g.dedIva) / 100);
  return Math.round((base + iva - ivaDed) * pct(g.dedIrpf) / 100);
}
/**
 * Amortización acumulada de un gasto DENTRO del año `anio` hasta la fecha `fin` (céntimos).
 * Lineal: valor × % anual × días en uso / días del año, desde la fecha del gasto, sin pasar nunca del valor.
 */
export function amortizadoEnAnio(g, fiscal, anio, fin) {
  if (!g.amortiza || !g.fecha || g.fecha.slice(0, 4) > anio) return 0;
  const valor = valorAmortizable(g, fiscal), coef = pct(g.amortPct) / 100;
  let previo = 0; // lo amortizado en años anteriores
  for (let a = Number(g.fecha.slice(0, 4)); a < Number(anio); a++) {
    const ini = a === Number(g.fecha.slice(0, 4)) ? g.fecha : `${a}-01-01`;
    previo += Math.round(valor * coef * diasEntre(ini, `${a}-12-31`) / diasDelAnio(a));
  }
  const ini = g.fecha.slice(0, 4) === anio ? g.fecha : `${anio}-01-01`;
  if (previo >= valor || fin < ini) return 0;
  return Math.min(valor - previo, Math.round(valor * coef * diasEntre(ini, fin) / diasDelAnio(Number(anio))));
}

// ---------- el año fiscal ----------
/** Ingresos de autónomo y parte con retención de un año real (para la regla del 70 % del modelo 130). */
function ingresosReales(estado, anio) {
  let ing = 0, conRet = 0;
  for (const f of vivos(estado.facturas)) {
    if (f.estado === 'abierta' || anioDe(f) !== anio || !esAutonomo(f, estado.ajustes)) continue;
    const d = desglose(f, estado.ajustes.fiscal);
    ing += cent(d.base); if (d.retPct > 0) conRet += cent(d.base);
  }
  return { ing, conRet };
}
/** Minoración del modelo 130 (casilla 13) según el beneficio del año anterior, en céntimos. Sin año anterior cuenta como 0. */
function minoracion(fiscal, rendimientoAnterior) {
  const tramo = [...(fiscal.minoracion130 || [])].sort((x, y) => x.hasta - y.hasta).find((t) => rendimientoAnterior <= cent(t.hasta));
  return tramo ? cent(tramo.importe) : 0;
}
const finTrimestre = (anio, q) => fechaISO(new Date(Number(anio), q * 3, 0));

/**
 * Todo lo fiscal de un año: 4 trimestres y los totales. Importes en euros.
 * t[q] = { q, n, base, iva, retencion, conRetencion, porTipo{ '21': {base, cuota} }, nGastos,
 *          corrientes{base, cuota}, inversion{base, cuota}   <- IVA deducible: gastos normales y bienes de inversión
 *          ivaDeducible, gastoIrpf, amortizacion, cuota, meses,
 *          iva303 (resultado del trimestre), compensa (lo que arrastra del anterior, ≤ 0), aIngresar303,
 *          acum: { ingresos, gastosDirectos, cuota, amortizacion, dificil, gastos, retenciones, rendimiento },
 *          pctRetenido, obligado130, c130: { 01..07, 12..19 } (casillas), previo130 (casilla 05), pago130 }
 * opciones.sinAnterior evita mirar el año anterior (lo usa la propia función para no encadenar años sin fin).
 */
export function anioFiscal(estado, anio, hoy = hoyISO(), opciones = {}) {
  anio = String(anio);
  const { ajustes } = estado, fiscal = ajustes.fiscal;
  const modo = modoDe(estado, anio), sim = modo === 'simulacion';
  const subidaPct = sim ? pct(fiscal.subidaSimPct) : 0;
  const general = fiscal.regimenIva !== 'franquicia';

  const T = [1, 2, 3, 4].map((q) => ({ q, n: 0, base: 0, iva: 0, retencion: 0, conRetencion: 0, neto: 0, porTipo: {}, nGastos: 0,
    corrientes: { base: 0, cuota: 0 }, inversion: { base: 0, cuota: 0 }, ivaDeducible: 0, gastoIrpf: 0, amortizacion: 0, cuota: 0, meses: 0 }));
  let n = 0, sinCerrar = 0;
  for (const f of vivos(estado.facturas)) {
    if (anioDe(f) !== anio || !(sim || esAutonomo(f, ajustes))) continue;
    if (f.estado === 'abierta') { sinCerrar++; continue; }
    const d = sim ? desglose({ servicios: f.servicios }, fiscal, { subidaPct }) : desglose(f, fiscal);
    const t = T[trimestreDe(fechaDeFactura(f)) - 1];
    t.n++; n++; t.base += cent(d.base); t.iva += cent(d.iva); t.retencion += cent(d.retencion); t.neto += cent(d.neto);
    if (d.retPct > 0) t.conRetencion += cent(d.base);
    const tipo = (t.porTipo[d.ivaPct] ||= { base: 0, cuota: 0 }); tipo.base += cent(d.base); tipo.cuota += cent(d.iva);
  }
  const cuenta = (g) => !!g.fecha && (sim || g.fecha >= ajustes.fechaAlta);
  const amortizables = [];
  for (const g of vivos(estado.gastos || [])) {
    if (!cuenta(g)) continue;
    if (g.amortiza && g.fecha.slice(0, 4) <= anio) amortizables.push(g); // también los comprados en años anteriores
    if (g.fecha.slice(0, 4) !== anio) continue;
    const c = calculoGasto(g, fiscal), t = T[trimestreDe(g.fecha) - 1];
    t.nGastos++; t.ivaDeducible += cent(c.ivaDed);
    if (!g.amortiza) t.gastoIrpf += cent(c.gastoIrpf);               // lo que se amortiza no es gasto de golpe
    if (general && pct(g.dedIva) > 0 && cent(g.iva) > 0) {
      const grupo = g.amortiza && cent(g.base) >= cent(fiscal.umbralInversionIva) ? t.inversion : t.corrientes;
      grupo.base += cent(g.base); grupo.cuota += cent(c.ivaDed);
    }
  }
  for (const m of mesesConCuota(estado, anio, hoy, sim)) { const t = T[Math.ceil(m / 3) - 1]; t.cuota += cent(cuotaMes(fiscal, anio, m, sim)); t.meses++; }

  // Regla del 70 % y minoración: mandan los datos del año anterior si hubo actividad real; si no, cuenta como «sin actividad».
  const previo = sim ? { ing: 0, conRet: 0 } : ingresosReales(estado, String(Number(anio) - 1));
  const rendAnterior = previo.ing > 0 && !opciones.sinAnterior ? cent(anioFiscal(estado, String(Number(anio) - 1), hoy, { sinAnterior: true }).rendimiento) : 0;
  const c13 = minoracion(fiscal, rendAnterior);
  const empresarial = fiscal.epigrafe === 'empresarial';
  const empezado = (q) => `${anio}-${dos((q - 1) * 3 + 1)}-01` <= hoy;
  let arrastre = 0, ing = 0, directos = 0, cuo = 0, ret = 0, conRet = 0, amortPrev = 0, sum07 = 0, negativos = 0, pagado = 0, rend = 0, dificil = 0;
  for (const t of T) {
    // IVA (modelo 303)
    t.iva303 = general ? t.iva - t.ivaDeducible : 0;
    if (!general) t.ivaDeducible = 0;
    t.compensa = arrastre;
    const r = t.iva303 + arrastre;
    t.aIngresar303 = Math.max(0, r); arrastre = Math.min(0, r);
    // IRPF: acumulado desde enero
    ing += t.base; directos += t.gastoIrpf; cuo += t.cuota; ret += t.retencion; conRet += t.conRetencion;
    const fin = finTrimestre(anio, t.q) < hoy || anio < hoy.slice(0, 4) ? finTrimestre(anio, t.q) : hoy; // lo aún no transcurrido no se amortiza
    const amortAcum = empezado(t.q) ? amortizables.reduce((a, g) => a + amortizadoEnAnio(g, fiscal, anio, fin), 0) : amortPrev;
    t.amortizacion = amortAcum - amortPrev; amortPrev = amortAcum;
    const antes = ing - directos - cuo - amortAcum;                    // beneficio antes de los gastos de difícil justificación
    dificil = Math.min(cent(fiscal.difJustMax), Math.max(0, Math.round(antes * pct(fiscal.difJustPct) / 100)));
    rend = antes - dificil;
    // Modelo 130, casilla a casilla
    t.pctRetenido = previo.ing > 0 ? previo.conRet / previo.ing * 100 : ing > 0 ? conRet / ing * 100 : (empresarial ? 0 : 100);
    t.obligado130 = empresarial || t.pctRetenido < pct(fiscal.umbralRetenidoPct);
    const c = { '01': ing, '02': ing - rend, '03': rend, '04': Math.max(0, Math.round(rend * pct(fiscal.pagoFraccionadoPct) / 100)), '05': sum07, '06': ret };
    c['07'] = c['04'] - c['05'] - c['06'];
    c['12'] = Math.max(0, c['07']); c['13'] = c13; c['14'] = c['12'] - c['13'];
    c['15'] = c['14'] > 0 ? Math.min(c['14'], negativos) : 0; c['16'] = 0;
    c['17'] = c['14'] - c['15']; c['18'] = 0; c['19'] = c['17'];
    t.previo130 = sum07;
    t.pago130 = t.obligado130 ? Math.max(0, c['19']) : 0;
    if (t.obligado130) { sum07 += Math.max(0, c['07']); negativos += c['19'] < 0 ? -c['19'] : -c['15']; pagado += t.pago130; }
    t.c130 = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / 100]));
    t.acum = { ingresos: ing / 100, gastosDirectos: directos / 100, cuota: cuo / 100, amortizacion: amortAcum / 100, dificil: dificil / 100,
      gastos: (ing - rend) / 100, retenciones: ret / 100, rendimiento: rend / 100 };
  }

  const suma = (k) => T.reduce((a, t) => a + t[k], 0);
  const neto = suma('neto');
  const reservaRenta = Math.max(0, Math.round(Math.max(0, rend) * pct(fiscal.reservaRentaPct) / 100) - ret - pagado);
  const out = {
    anio, modo, subidaPct, n, sinCerrar, general,
    base: ing / 100, iva: suma('iva') / 100, ivaDeducible: suma('ivaDeducible') / 100, retencion: ret / 100,
    nGastos: suma('nGastos'), gastoIrpf: directos / 100, amortizacion: amortPrev / 100, dificil: dificil / 100, cuota: cuo / 100, mesesCuota: suma('meses'),
    rendimiento: rend / 100, total303: suma('aIngresar303') / 100, aDevolver303: -arrastre / 100, total130: pagado / 100, minoracion130: c13 / 100,
    obligado130: T.some((t) => t.obligado130), reservaRenta: reservaRenta / 100,
    netoFacturas: neto / 100, neto: (neto - cuo) / 100, irpfFacturas: (ing - neto) / 100,
  };
  for (const t of T) {
    for (const k of ['base', 'iva', 'retencion', 'conRetencion', 'neto', 'ivaDeducible', 'gastoIrpf', 'amortizacion', 'cuota', 'iva303', 'compensa', 'aIngresar303', 'previo130', 'pago130']) t[k] /= 100;
    for (const g of [t.corrientes, t.inversion, ...Object.values(t.porTipo)]) { g.base /= 100; g.cuota /= 100; }
  }
  out.t = T;
  return out;
}

// ---------- modelo 347 ----------
/** Clientes con más del umbral anual (base + IVA) en facturas SIN retención: los que irían en el modelo 347. */
export function clientes347(estado, anio) {
  const fiscal = estado.ajustes.fiscal, sim = modoDe(estado, anio) === 'simulacion', por = new Map();
  for (const f of vivos(estado.facturas)) {
    if (f.estado === 'abierta' || anioDe(f) !== String(anio) || !(sim || esAutonomo(f, estado.ajustes))) continue;
    const d = sim ? desglose({ servicios: f.servicios }, fiscal, { subidaPct: pct(fiscal.subidaSimPct) }) : desglose(f, fiscal);
    if (d.retPct > 0) continue; // lo que lleva retención ya lo declara el cliente (modelo 190)
    por.set(f.clienteId, (por.get(f.clienteId) || 0) + cent(d.base) + cent(d.iva));
  }
  return [...por].filter(([, c]) => c > cent(fiscal.umbral347)).map(([clienteId, c]) => ({ clienteId, importe: c / 100 }));
}

// ---------- calendario ----------
/** Si el último día cae en sábado o domingo, pasa al lunes. (No conoce los festivos: confirmar en el calendario oficial.) */
export function diaHabil(anio, mes, dia) {
  const ultimo = new Date(anio, mes, 0).getDate();
  const d = new Date(anio, mes - 1, Math.min(dia, ultimo));
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return fechaISO(d);
}
const NOMBRES = { 303: 'IVA trimestral', 130: 'Pago fraccionado del IRPF', 390: 'Resumen anual del IVA', 347: 'Operaciones con terceros', renta: 'Declaración de la renta' };

/**
 * Plazos del año fiscal `anio` (los del 4T, el 390, el 347 y la renta caen en el año siguiente), por fecha.
 * { id, modelo, titulo, periodo, fecha, aplica, motivo, importe, presentado }
 */
export function plazosDelAnio(estado, anio, hoy = hoyISO()) {
  anio = String(anio);
  const { fiscal, fechaAlta } = estado.ajustes, a = anioFiscal(estado, anio, hoy), A = Number(anio);
  const real = a.modo === 'real';
  const q0 = real && fechaAlta.slice(0, 4) === anio ? trimestreDe(fechaAlta) : 1;
  const hecho = (id) => !!(fiscal.presentados || {})[id];
  const out = [];
  const pon = (modelo, periodo, fecha, aplica, motivo, importe = null) => {
    const id = `${anio}-${modelo}${periodo ? '-' + periodo : ''}`;
    out.push({ id, modelo, titulo: modelo === 'renta' ? NOMBRES.renta : `Modelo ${modelo} · ${NOMBRES[modelo]}`, periodo: periodo ? `${periodo}T ${anio}` : anio, fecha, aplica, motivo, importe, presentado: hecho(id) });
  };
  for (let q = q0; q <= 4; q++) {
    const t = a.t[q - 1];
    const fecha = q < 4 ? diaHabil(A, q * 3 + 1, pct(fiscal.diaTrimestre)) : diaHabil(A + 1, 1, pct(fiscal.diaEnero));
    pon(303, q, fecha, a.general, a.general ? '' : 'Con franquicia de IVA no se presenta.', t.aIngresar303);
    pon(130, q, fecha, t.obligado130, t.obligado130 ? '' : `No toca: el ${Math.round(t.pctRetenido)} % de tus ingresos lleva retención.`, t.pago130);
  }
  pon(390, '', diaHabil(A + 1, 1, pct(fiscal.diaEnero)), a.general, a.general ? '' : 'Con franquicia de IVA no se presenta.');
  const c347 = clientes347(estado, anio);
  pon(347, '', diaHabil(A + 1, 2, 31), c347.length > 0, c347.length ? `${c347.length} cliente(s) superan el importe.` : 'No toca: ningún cliente sin retención supera el importe.');
  pon('renta', '', diaHabil(A + 1, 6, 30), true, '', a.reservaRenta);
  return out.sort((x, y) => x.fecha.localeCompare(y.fecha) || String(x.modelo).localeCompare(String(y.modelo)));
}

/** Años con actividad real de autónomo hasta hoy (desde el del alta). */
function aniosReales(estado, hoy) {
  const alta = estado.ajustes.fechaAlta;
  if (!alta) return [];
  const out = [];
  for (let a = Number(alta.slice(0, 4)); a <= Number(hoy.slice(0, 4)); a++) out.push(String(a));
  return out;
}

/** Plazos sin presentar que vencen pronto (o ya han vencido), para el aviso al abrir la app. */
export function plazosCercanos(estado, hoy = hoyISO()) {
  const limite = fechaISO(new Date(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1, Number(hoy.slice(8, 10)) + pct(estado.ajustes.fiscal.avisoPlazoDias)));
  const inicio = (p) => (p.periodo.includes('T ') ? `${p.id.slice(0, 4)}-${dos((Number(p.periodo[0]) - 1) * 3 + 1)}-01` : p.id.slice(0, 4) + '-01-01');
  return aniosReales(estado, hoy).flatMap((a) => plazosDelAnio(estado, a, hoy))
    .filter((p) => p.aplica && !p.presentado && p.fecha <= limite && inicio(p) <= hoy)
    .sort((x, y) => x.fecha.localeCompare(y.fecha));
}

// ---------- hucha ----------
/** Dinero que hay que tener apartado hoy para Hacienda, y de qué. Solo en modo real. */
export function hucha(estado, hoy = hoyISO()) {
  const hecho = (id) => !!(estado.ajustes.fiscal.presentados || {})[id];
  let iva = 0, m130 = 0, renta = 0;
  const detalle = [];
  for (const anio of aniosReales(estado, hoy)) {
    const a = anioFiscal(estado, anio, hoy);
    for (const t of a.t) {
      if (`${anio}-${dos((t.q - 1) * 3 + 1)}-01` > hoy) continue; // trimestre que aún no ha empezado
      if (a.general && !hecho(`${anio}-303-${t.q}`) && t.aIngresar303 > 0) { iva += cent(t.aIngresar303); detalle.push({ id: `${anio}-303-${t.q}`, texto: `IVA ${t.q}T ${anio}`, importe: t.aIngresar303 }); }
      if (t.obligado130 && !hecho(`${anio}-130-${t.q}`) && t.pago130 > 0) { m130 += cent(t.pago130); detalle.push({ id: `${anio}-130-${t.q}`, texto: `Modelo 130 ${t.q}T ${anio}`, importe: t.pago130 }); }
    }
    if (!hecho(`${anio}-renta`) && a.reservaRenta > 0) { renta += cent(a.reservaRenta); detalle.push({ id: `${anio}-renta`, texto: `Reserva renta ${anio}`, importe: a.reservaRenta }); }
  }
  return { iva: iva / 100, m130: m130 / 100, renta: renta / 100, total: (iva + m130 + renta) / 100, detalle };
}

// ---------- archivo de calendario (.ics) ----------
/** Archivo de calendario con los plazos. No lleva importes ni nombres: el calendario del móvil puede ir a la nube. */
export function aICS(plazos, ahora = new Date()) {
  const f = (iso) => iso.replace(/-/g, '');
  const sig = (iso) => { const [a, m, d] = iso.split('-').map(Number); return f(fechaISO(new Date(a, m - 1, d + 1))); };
  const sello = ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mis-servicios-facturas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const p of plazos) {
    const titulo = `Hacienda: ${p.modelo === 'renta' ? 'renta' : 'modelo ' + p.modelo} (${p.periodo})`;
    L.push('BEGIN:VEVENT', `UID:${p.id}@mis-servicios-facturas`, `DTSTAMP:${sello}`, `DTSTART;VALUE=DATE:${f(p.fecha)}`, `DTEND;VALUE=DATE:${sig(p.fecha)}`,
      `SUMMARY:${titulo}`, 'DESCRIPTION:Último día para presentarlo. Confirma la fecha en el calendario de la Agencia Tributaria.', 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${titulo}: queda una semana`, 'TRIGGER:-P6DT15H', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${titulo}: último día mañana`, 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
