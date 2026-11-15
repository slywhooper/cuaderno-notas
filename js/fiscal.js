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
//  - Fase 3B: una ayuda (estado.ayudas) es ingreso de la actividad en el trimestre de su fecha: entra en el beneficio,
//    en la casilla 01 del modelo 130 y en la reserva de la renta. No lleva IVA ni retención, no es «facturado» y no
//    cambia el neto. Cuenta como ingreso SIN retención para la regla del 70 % (criterio prudente).

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
export function valorAmortizable(g, fiscal) {
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
  for (const y of vivos(estado.ayudas || [])) if (y.fecha && y.fecha.slice(0, 4) === anio && y.fecha >= (estado.ajustes.fechaAlta || '9')) ing += cent(y.importe);
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
 * t[q].ayudas y out.ayudas = ayudas del periodo; t[q].base y out.base siguen siendo solo lo facturado.
 * opciones.sinAnterior evita mirar el año anterior (lo usa la propia función para no encadenar años sin fin).
 * opciones.ayudas: 'ss' = solo las ayudas que cuentan para la Seguridad Social · 'no' = ninguna (por defecto, todas).
 */
export function anioFiscal(estado, anio, hoy = hoyISO(), opciones = {}) {
  anio = String(anio);
  const { ajustes } = estado, fiscal = ajustes.fiscal;
  const modo = modoDe(estado, anio), sim = modo === 'simulacion';
  const subidaPct = sim ? pct(fiscal.subidaSimPct) : 0;
  const general = fiscal.regimenIva !== 'franquicia';

  const T = [1, 2, 3, 4].map((q) => ({ q, n: 0, base: 0, iva: 0, retencion: 0, conRetencion: 0, neto: 0, porTipo: {}, nGastos: 0,
    corrientes: { base: 0, cuota: 0 }, inversion: { base: 0, cuota: 0 }, ivaDeducible: 0, gastoIrpf: 0, amortizacion: 0, cuota: 0, meses: 0, ayudas: 0 }));
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
  for (const y of vivos(estado.ayudas || [])) {
    if (!cuenta(y) || y.fecha.slice(0, 4) !== anio || opciones.ayudas === 'no' || (opciones.ayudas === 'ss' && y.cuentaSS === false)) continue;
    T[trimestreDe(y.fecha) - 1].ayudas += cent(y.importe);
  }
  for (const m of mesesConCuota(estado, anio, hoy, sim)) { const t = T[Math.ceil(m / 3) - 1]; t.cuota += cent(cuotaMes(fiscal, anio, m, sim)); t.meses++; }

  // Regla del 70 % y minoración: mandan los datos del año anterior si hubo actividad real; si no, cuenta como «sin actividad».
  const previo = sim ? { ing: 0, conRet: 0 } : ingresosReales(estado, String(Number(anio) - 1));
  const rendAnterior = previo.ing > 0 && !opciones.sinAnterior ? cent(anioFiscal(estado, String(Number(anio) - 1), hoy, { sinAnterior: true }).rendimiento) : 0;
  const c13 = minoracion(fiscal, rendAnterior);
  const empresarial = fiscal.epigrafe === 'empresarial';
  const empezado = (q) => `${anio}-${dos((q - 1) * 3 + 1)}-01` <= hoy;
  let ayu = 0, arrastre = 0, ing = 0, directos = 0, cuo = 0, ret = 0, conRet = 0, amortPrev = 0, sum07 = 0, negativos = 0, pagado = 0, rend = 0, dificil = 0;
  for (const t of T) {
    // IVA (modelo 303)
    t.iva303 = general ? t.iva - t.ivaDeducible : 0;
    if (!general) t.ivaDeducible = 0;
    t.compensa = arrastre;
    const r = t.iva303 + arrastre;
    t.aIngresar303 = Math.max(0, r); arrastre = Math.min(0, r);
    // IRPF: acumulado desde enero
    ing += t.base; ayu += t.ayudas; directos += t.gastoIrpf; cuo += t.cuota; ret += t.retencion; conRet += t.conRetencion;
    const fin = finTrimestre(anio, t.q) < hoy || anio < hoy.slice(0, 4) ? finTrimestre(anio, t.q) : hoy; // lo aún no transcurrido no se amortiza
    const amortAcum = empezado(t.q) ? amortizables.reduce((a, g) => a + amortizadoEnAnio(g, fiscal, anio, fin), 0) : amortPrev;
    t.amortizacion = amortAcum - amortPrev; amortPrev = amortAcum;
    const antes = ing + ayu - directos - cuo - amortAcum;                    // beneficio antes de los gastos de difícil justificación
    dificil = Math.min(cent(fiscal.difJustMax), Math.max(0, Math.round(antes * pct(fiscal.difJustPct) / 100)));
    rend = antes - dificil;
    // Modelo 130, casilla a casilla
    t.pctRetenido = previo.ing > 0 ? previo.conRet / previo.ing * 100 : ing + ayu > 0 ? conRet / (ing + ayu) * 100 : (empresarial ? 0 : 100);
    t.obligado130 = empresarial || t.pctRetenido < pct(fiscal.umbralRetenidoPct);
    const c = { '01': ing + ayu, '02': ing + ayu - rend, '03': rend, '04': Math.max(0, Math.round(rend * pct(fiscal.pagoFraccionadoPct) / 100)), '05': sum07, '06': ret };
    c['07'] = c['04'] - c['05'] - c['06'];
    c['12'] = Math.max(0, c['07']); c['13'] = c13; c['14'] = c['12'] - c['13'];
    c['15'] = c['14'] > 0 ? Math.min(c['14'], negativos) : 0; c['16'] = 0;
    c['17'] = c['14'] - c['15']; c['18'] = 0; c['19'] = c['17'];
    t.previo130 = sum07;
    t.pago130 = t.obligado130 ? Math.max(0, c['19']) : 0;
    if (t.obligado130) { sum07 += Math.max(0, c['07']); negativos += c['19'] < 0 ? -c['19'] : -c['15']; pagado += t.pago130; }
    t.c130 = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / 100]));
    t.acum = { ingresos: (ing + ayu) / 100, ayudas: ayu / 100, gastosDirectos: directos / 100, cuota: cuo / 100, amortizacion: amortAcum / 100, dificil: dificil / 100,
      gastos: (ing + ayu - rend) / 100, retenciones: ret / 100, rendimiento: rend / 100 };
  }

  const suma = (k) => T.reduce((a, t) => a + t[k], 0);
  const neto = suma('neto');
  const reservaRenta = Math.max(0, Math.round(Math.max(0, rend) * pct(fiscal.reservaRentaPct) / 100) - ret - pagado);
  const out = {
    anio, modo, subidaPct, n, sinCerrar, general,
    base: ing / 100, ayudas: ayu / 100, iva: suma('iva') / 100, ivaDeducible: suma('ivaDeducible') / 100, retencion: ret / 100,
    nGastos: suma('nGastos'), gastoIrpf: directos / 100, amortizacion: amortPrev / 100, dificil: dificil / 100, cuota: cuo / 100, mesesCuota: suma('meses'),
    rendimiento: rend / 100, total303: suma('aIngresar303') / 100, aDevolver303: -arrastre / 100, total130: pagado / 100, minoracion130: c13 / 100,
    obligado130: T.some((t) => t.obligado130), reservaRenta: reservaRenta / 100,
    netoFacturas: neto / 100, neto: (neto - cuo) / 100, irpfFacturas: (ing - neto) / 100,
  };
  for (const t of T) {
    for (const k of ['ayudas', 'base', 'iva', 'retencion', 'conRetencion', 'neto', 'ivaDeducible', 'gastoIrpf', 'amortizacion', 'cuota', 'iva303', 'compensa', 'aIngresar303', 'previo130', 'pago130']) t[k] /= 100;
    for (const g of [t.corrientes, t.inversion, ...Object.values(t.porTipo)]) { g.base /= 100; g.cuota /= 100; }
  }
  out.t = T;
  return out;
}

// ---------- mes a mes (gráficos) ----------
/**
 * Lo facturado de un año repartido por meses (por fecha de factura), con las mismas reglas que anioFiscal().
 * Cada mes: { m, n, base, iva, irpf, cuota, impuestos (= iva + irpf + cuota: lo que hay que apartar de lo cobrado),
 *   neto (= base − irpf − cuota: lo que queda), total (= base + iva: lo cobrado con IVA), gastos (lo pagado, con su IVA), nGastos }.
 * total: las mismas sumas del año y pctQueda (neto / total × 100; null si no hay nada facturado).
 * Las ayudas no entran: no son facturado. Los gastos van aparte: no se restan del neto (regla de la app).
 */
export function mesesDelAnio(estado, anio, hoy = hoyISO()) {
  anio = String(anio);
  const { ajustes } = estado, fiscal = ajustes.fiscal, modo = modoDe(estado, anio), sim = modo === 'simulacion';
  const subidaPct = sim ? pct(fiscal.subidaSimPct) : 0;
  const ms = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, n: 0, base: 0, iva: 0, irpf: 0, cuota: 0, gastos: 0, nGastos: 0 }));
  for (const f of vivos(estado.facturas)) {
    if (f.estado === 'abierta' || anioDe(f) !== anio || !(sim || esAutonomo(f, ajustes))) continue;
    const d = sim ? desglose({ servicios: f.servicios }, fiscal, { subidaPct }) : desglose(f, fiscal);
    const x = ms[Number(fechaDeFactura(f).slice(5, 7)) - 1];
    x.n++; x.base += cent(d.base); x.iva += cent(d.iva); x.irpf += cent(d.base) - cent(d.neto);
  }
  for (const g of vivos(estado.gastos || [])) {
    if (!g.fecha || g.fecha.slice(0, 4) !== anio || !(sim || g.fecha >= ajustes.fechaAlta)) continue;
    const x = ms[Number(g.fecha.slice(5, 7)) - 1];
    x.gastos += cent(calculoGasto(g, fiscal).total); x.nGastos++;
  }
  for (const m of mesesConCuota(estado, anio, hoy, sim)) ms[m - 1].cuota += cent(cuotaMes(fiscal, anio, m, sim));
  const total = { n: 0, base: 0, iva: 0, irpf: 0, cuota: 0, gastos: 0, nGastos: 0, impuestos: 0, neto: 0, total: 0 };
  for (const x of ms) {
    x.impuestos = x.iva + x.irpf + x.cuota; x.neto = x.base - x.irpf - x.cuota; x.total = x.base + x.iva;
    for (const k of Object.keys(total)) total[k] += x[k];
    for (const k of ['base', 'iva', 'irpf', 'cuota', 'gastos', 'impuestos', 'neto', 'total']) x[k] /= 100;
  }
  for (const k of ['base', 'iva', 'irpf', 'cuota', 'gastos', 'impuestos', 'neto', 'total']) total[k] /= 100;
  total.pctQueda = total.total > 0 ? total.neto / total.total * 100 : null;
  return { anio, modo, meses: ms, total };
}

// ---------- tarifa plana ----------
// REGLAS (fase 3, parte B):
//  - La tarifa plana dura los meses naturales completos siguientes al alta (12 de partida): con alta el día 1 ese
//    mes ya es completo; con alta a mitad de mes, ese mes va aparte y se cuentan los 12 siguientes.
//  - La prórroga (otros 12) hay que pedirla ANTES de que acabe el primer periodo, y solo vale si el beneficio de
//    CADA año natural que toca es inferior al salario mínimo anual. La app no cambia la cuota sola: los tramos de
//    cuota los pone el usuario.
//  - El beneficio que mira la Seguridad Social = beneficio fiscal + cuota pagada, menos el % de gastos genéricos.
//  - «A este ritmo» = lo que llevas × días de actividad del año / días transcurridos. Es una estimación.

/** Beneficio del año como lo mira la Seguridad Social (euros). `a` es el resultado de anioFiscal(). */
export function beneficioSS(a, fiscal) {
  const x = cent(a.rendimiento) + cent(a.cuota);
  return Math.round(x > 0 ? x * (1 - pct(fiscal.genericosSSPct) / 100) : x) / 100;
}
/** Último día de un periodo de `meses` meses naturales completos que empieza en `inicio`. */
function finPeriodo(inicio, meses) {
  const [a, m, d] = inicio.split('-').map(Number);
  return fechaISO(new Date(a, m - 1 + meses + (d === 1 ? 0 : 1), 0));
}
/**
 * Beneficio para la Seguridad Social de un año frente al salario mínimo.
 * { anio, modo, llevas, proyeccion (a este ritmo, al acabar el año), smi, cerrado, cumple (proyección < salario mínimo),
 *   rendimiento, cuota (de dónde sale: beneficio fiscal y cuota pagada), dias (días de actividad del año),
 *   dificilEnTope (los gastos de difícil justificación ya están en su tope: un gasto más baja el beneficio entero),
 *   ayudas (las que cuentan para la Seguridad Social), sinAyudas { llevas, proyeccion, cumple }, soloPorAyudas (pasa del
 *   salario mínimo solo por las ayudas) }
 */
export function ritmoSS(estado, anio, hoy = hoyISO()) {
  anio = String(anio);
  const { fiscal, fechaAlta } = estado.ajustes, a = anioFiscal(estado, anio, hoy, { ayudas: 'ss' });
  const a0 = a.ayudas ? anioFiscal(estado, anio, hoy, { ayudas: 'no' }) : a;   // sin ayudas: lo único que se alarga «a este ritmo»
  const llevas = beneficioSS(a, fiscal), llevas0 = beneficioSS(a0, fiscal), smi = pct(fiscal.smiAnual);
  const cerrado = anio < hoy.slice(0, 4), futuro = anio > hoy.slice(0, 4);
  const ini = a.modo === 'real' && fechaAlta.slice(0, 4) === anio ? fechaAlta : `${anio}-01-01`;
  let proy0 = llevas0;
  if (!cerrado && !futuro && hoy >= ini) proy0 = Math.round(cent(llevas0) * diasEntre(ini, `${anio}-12-31`) / diasEntre(ini, hoy)) / 100;
  const proyeccion = (cent(proy0) + cent(llevas) - cent(llevas0)) / 100;       // la ayuda es puntual: se suma una vez, no se alarga
  const capado = cent(a.dificil) > 0 && cent(a.dificil) * (cent(llevas0) > 0 ? cent(proy0) / cent(llevas0) : 1) >= cent(fiscal.difJustMax);
  return { anio, modo: a.modo, llevas, proyeccion, smi, cerrado, futuro, cumple: proyeccion < smi, rendimiento: a.rendimiento, cuota: a.cuota,
    dias: diasEntre(ini, `${anio}-12-31`), dificilEnTope: capado,
    ayudas: a.ayudas, sinAyudas: { llevas: llevas0, proyeccion: proy0, cumple: proy0 < smi }, soloPorAyudas: !(proyeccion < smi) && proy0 < smi };
}
/**
 * Tarifa plana: cuándo acaba y si se cumple el requisito de la prórroga. null sin fecha de alta.
 * { fin1, fin2, pedida, fin (el que vale), fase: 'primer'|'prorroga'|'acabada', dias (hasta `fin`),
 *   mesNuevo ('AAAA-MM' del primer mes ya sin tarifa plana), faltaTramo (no hay tramo de cuota desde ese mes),
 *   avisar: 'fin' (acaba pronto y no has pedido la prórroga) | 'tramo' (ha acabado y falta la cuota nueva) | null,
 *   actual: ritmoSS del año en curso, anios: ritmoSS de cada año natural que toca la prórroga }
 */
export function tarifaPlana(estado, hoy = hoyISO()) {
  const { fiscal, fechaAlta } = estado.ajustes;
  if (!fechaAlta) return null;
  const fin1 = finPeriodo(fechaAlta, pct(fiscal.tarifaPlanaMeses));
  const sig = (iso) => { const [a, m, d] = iso.split('-').map(Number); return fechaISO(new Date(a, m - 1, d + 1)); };
  const fin2 = finPeriodo(sig(fin1), pct(fiscal.prorrogaMeses));
  const pedida = !!fiscal.prorrogaPedida, fin = pedida ? fin2 : fin1;
  const fase = hoy <= fin1 ? 'primer' : pedida && hoy <= fin2 ? 'prorroga' : 'acabada';
  const mesNuevo = sig(fin).slice(0, 7);
  const faltaTramo = !(fiscal.cuotas || []).some((t) => (t.desde || '') >= mesNuevo);
  const dias = diasEntre(hoy, fin) - 1;
  const anios = [];
  for (let y = Number(sig(fin1).slice(0, 4)); y <= Number(fin2.slice(0, 4)); y++) anios.push(ritmoSS(estado, y, hoy));
  const avisar = fase === 'primer' && !pedida && dias <= pct(fiscal.avisoTarifaDias) ? 'fin'
    : faltaTramo && (fase === 'acabada' || dias <= pct(fiscal.avisoTarifaDias)) ? 'tramo' : null;
  return { fin1, fin2, pedida, fin, fase, dias, mesNuevo, faltaTramo, avisar, actual: ritmoSS(estado, hoy.slice(0, 4), hoy), anios };
}

// ---------- cuota según el beneficio (sin tarifa plana) ----------
// REGLAS (fase 3, parte B):
//  - Beneficio al mes para la Seguridad Social = beneficio del año (a este ritmo) / días de actividad del año × 30.
//  - Tramo = el primero de la tabla cuyo «hasta» no se supera. Cuota = base mínima del tramo × tipo de cotización.
//  - Gasto que falta para no pasar de `limiteCuota` = lo que hay que bajar el beneficio anual para caer al tramo más
//    alto cuya cuota no pasa del límite, dividido por lo que baja el beneficio cada euro de gasto:
//    (1 − gastos genéricos %) × (1 − difícil justificación %; si esos gastos ya están en su tope, 1). Estimación.

const tramosOrdenados = (fiscal) => [...(fiscal.tramosCuota || [])].sort((x, y) => (x.hasta == null ? Infinity : x.hasta) - (y.hasta == null ? Infinity : y.hasta));
/** Cuota al mes de un tramo: su base mínima por el tipo de cotización (euros). */
export const cuotaDeTramo = (t, fiscal) => Math.round(cent(t.base) * pct(fiscal.tipoCotizacionPct) / 100) / 100;
/** Tramo que corresponde a un beneficio al mes: { hasta, base, cuota }. null si la tabla está vacía. */
export function tramoDe(fiscal, mensual) {
  const ts = tramosOrdenados(fiscal);
  const t = ts.find((x) => x.hasta == null || cent(mensual) <= cent(x.hasta)) || ts[ts.length - 1];
  return t ? { hasta: t.hasta, base: pct(t.base), cuota: cuotaDeTramo(t, fiscal) } : null;
}
/**
 * Cuota que tocaría sin tarifa plana con el beneficio de un año, y el gasto deducible que falta para no pasar del límite.
 * { anio, modo, anual (beneficio para la Seguridad Social a este ritmo), dias, mensual, tramo{hasta, base, cuota}, cuota,
 *   limite, objetivo (tramo más alto cuya cuota no pasa del límite, o null si ninguno), falta (euros de gasto deducible
 *   en el año; 0 si ya no pasas; null si no hay tramo que valga), porEuro (lo que baja el beneficio cada euro de gasto) }
 */
export function cuotaEstimada(estado, anio, hoy = hoyISO()) {
  const fiscal = estado.ajustes.fiscal, r = ritmoSS(estado, anio, hoy);
  const anual = cent(r.proyeccion), mensual = Math.round(anual * 30 / r.dias) / 100;
  const tramo = tramoDe(fiscal, mensual), limite = pct(fiscal.limiteCuota);
  const validos = tramosOrdenados(fiscal).filter((t) => cuotaDeTramo(t, fiscal) <= limite);
  const ult = validos[validos.length - 1];
  const objetivo = ult ? { hasta: ult.hasta, base: pct(ult.base), cuota: cuotaDeTramo(ult, fiscal) } : null;
  const porEuro = Math.round((100 - pct(fiscal.genericosSSPct)) * (r.dificilEnTope ? 100 : 100 - pct(fiscal.difJustPct))) / 1e4;
  let falta = null;
  if (tramo && objetivo) {
    const tope = objetivo.hasta == null ? Infinity : Math.round(cent(objetivo.hasta) * r.dias / 30);
    falta = tramo.cuota <= limite || anual <= tope ? 0 : Math.ceil((anual - tope) / porEuro) / 100;
  }
  return { anio: r.anio, modo: r.modo, anual: r.proyeccion, dias: r.dias, mensual, tramo, cuota: tramo ? tramo.cuota : 0, limite, objetivo, falta, porEuro };
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
