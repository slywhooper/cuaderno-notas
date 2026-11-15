// modelo.js — Estructura de los datos y todos los cálculos. Funciones puras: no tocan pantalla ni disco.
//
// ESTADO (lo que se cifra y se guarda):
// {
//   esquema: 3,
//   ajustes:  { fechaAlta, avisoCopiaDias, fiscal: {...ver fiscalPorDefecto()}, _mod, _base },
//   clientes: [{ id, nombre, plazo, _mod, _base, _borrado? }],
//   facturas: [{ id, n, ref, clienteId, estado, fechaFactura, fechaCobro, neto, diasSS, nota,
//                servicios: [{ evento, mod, fecha, dias, importe }], antiguo?,
//                ivaPct?, retPct?,            <- solo facturas de autónomo: porcentajes con los que se hizo
//                _mod, _base, _borrado? }],
//   gastos:   [{ id, fecha, proveedor, numFactura, categoria, base, ivaPct, iva, dedIva, dedIrpf,
//                justificante, nota, amortiza?, amortPct?,   <- material que se amortiza: % al año
//                _mod, _base, _borrado? }]
// }
// RÉGIMEN: una factura es de AUTÓNOMO si hay ajustes.fechaAlta y su fecha de factura es igual o posterior.
//          Si no, es de COOPERATIVA (neto apuntado a mano al cobrar, días cotizados).
//          En una factura de autónomo el importe de cada servicio es la base SIN IVA y el neto se calcula.
// plazo: null | { tipo:'dias', dias } | { tipo:'mes', desde, hasta }  (días del mes siguiente a la factura)
// estado de factura: 'abierta' (sin cerrar) | 'pendiente' (de cobro) | 'cobrada'
// _mod  = cuándo se modificó por última vez (ms). _base = el _mod de la última versión compartida
//         con otro dispositivo. Con esos dos números se comparan las copias al importar (ver copias.js).
// Los registros borrados no desaparecen: quedan como { id, _borrado:true } para que el borrado viaje.

export const ESTADOS = { abierta: 'Sin cerrar', pendiente: 'Pendiente de cobro', cobrada: 'Cobrada' };
export const MODALIDADES = ['Montaopera', 'Opera', 'Operador', 'Cámara', 'Realización'];

export const ESQUEMA = 3; // 1: fase 1 · 2: ajustes fiscales y gastos · 3: amortización, difícil justificación, minoración // súbelo cuando cambie la forma de los datos y añade el paso en completar()

export const EPIGRAFES = { profesional: 'Profesional (con retención)', artistica: 'Artística (con retención)', empresarial: 'Empresarial (sin retención)' };

/**
 * Valores fiscales de partida. TODOS son editables en Más → Ajustes de autónomo y nacen como
 * «pendiente de confirmar» (fiscal.confirmados). Ningún cálculo usa un número que no salga de aquí.
 */
export function fiscalPorDefecto() {
  return {
    epigrafe: 'profesional',      // 'profesional' | 'artistica' | 'empresarial'
    regimenIva: 'general',        // 'general' | 'franquicia' (sin IVA ni modelo 303)
    ivaPct: 21,                   // IVA de mis facturas
    retencionPct: 7,              // retención de IRPF en factura (profesional o artística)
    pagoFraccionadoPct: 20,       // modelo 130: % del rendimiento neto acumulado
    umbralRetenidoPct: 70,        // con este % de ingresos con retención no hay modelo 130
    umbral347: 3005.06,           // modelo 347: importe anual por cliente
    umbralInversionIva: 3005.06,  // a partir de esta base, un bien que se amortiza va en el 303 como «bien de inversión»
    difJustPct: 5,                // gastos de difícil justificación (estimación directa simplificada): % del beneficio
    difJustMax: 2000,             // ...con este tope anual en euros (0 en el % = no aplicarlos)
    minoracion130: [              // casilla 13 del modelo 130 según el beneficio del año anterior
      { hasta: 9000, importe: 100 }, { hasta: 10000, importe: 75 }, { hasta: 11000, importe: 50 }, { hasta: 12000, importe: 25 }],
    amortizacionLibreMax: 300,    // el material que cuesta hasta esto por unidad puede ir como gasto normal, sin amortizar
    reduccionInicio: false,       // reducción por inicio de actividad en el resumen de la renta (tiene requisitos)
    reduccionInicioPct: 20,
    amortizaciones: [             // tabla de amortización simplificada: % máximo al año
      { id: 'informatica', nombre: 'Ordenadores, equipos informáticos y programas', pct: 26 },
      { id: 'herramientas', nombre: 'Útiles y herramientas', pct: 30 },
      { id: 'maquinaria', nombre: 'Maquinaria', pct: 12 },
      { id: 'vehiculos', nombre: 'Vehículos', pct: 16 },
      { id: 'resto', nombre: 'Mobiliario, instalaciones y resto', pct: 10 },
    ],
    reservaRentaPct: 20,          // estimación propia: % del beneficio a guardar para la renta
    subidaSimPct: 0,              // simulación: subida de tarifa respecto a lo facturado por cooperativa
    avisoPlazoDias: 15,           // avisar de un plazo con estos días de antelación
    diaTrimestre: 20,             // último día de abril, julio y octubre para el 303 y el 130
    diaEnero: 30,                 // último día de enero para el 4T y el 390
    cuotas: [{ desde: '', importe: 88.64 }], // tramos de cuota: desde 'AAAA-MM' ('' = desde el alta)
    categorias: [
      { id: 'material', nombre: 'Material y herramientas', ivaPct: 21, dedIva: 100, dedIrpf: 100 },
      { id: 'vehiculo', nombre: 'Gasolina y vehículo', ivaPct: 21, dedIva: 50, dedIrpf: 0 },
      { id: 'desplazamientos', nombre: 'Desplazamientos (peajes, parking, transporte)', ivaPct: 21, dedIva: 100, dedIrpf: 100 },
      { id: 'telefono', nombre: 'Teléfono e internet (línea solo de trabajo)', ivaPct: 21, dedIva: 100, dedIrpf: 100 },
      { id: 'ropa', nombre: 'Ropa de trabajo y protección', ivaPct: 21, dedIva: 100, dedIrpf: 100 },
      { id: 'servicios', nombre: 'Programas, gestoría y seguros', ivaPct: 21, dedIva: 100, dedIrpf: 100 },
      { id: 'otros', nombre: 'Otros', ivaPct: 21, dedIva: 100, dedIrpf: 100 },
    ],
    confirmados: {},              // { ivaPct: true, ... } valores que el usuario ya ha comprobado
    presentados: {},              // { '2027-303-1': true, '2027-renta': true, ... } modelos ya presentados
  };
}

export function estadoVacio() {
  return { esquema: ESQUEMA, ajustes: { fechaAlta: null, avisoCopiaDias: 7, fiscal: fiscalPorDefecto(), _mod: 0, _base: 0 }, clientes: [], facturas: [], gastos: [] };
}

/** Rellena lo que le falte a un estado guardado con una versión anterior de la app (no borra nada). */
export function completar(estado) {
  const v = estadoVacio();
  for (const k of Object.keys(v)) if (estado[k] === undefined) estado[k] = v[k];
  estado.ajustes = { ...v.ajustes, ...estado.ajustes };
  estado.ajustes.fiscal = { ...v.ajustes.fiscal, ...(estado.ajustes.fiscal || {}) }; // esquema 1 -> 2: ajustes fiscales
  estado.esquema = ESQUEMA;
  return estado;
}

export const nuevoId = (prefijo) => prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const vivos = (lista) => lista.filter((x) => !x._borrado);
/** Marca un registro como modificado ahora. */
export function tocar(reg) { reg._mod = Math.max(Date.now(), (reg._mod || 0) + 1); return reg; }

// --- Fechas (siempre texto 'AAAA-MM-DD') ---
export function fechaISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export const hoyISO = () => fechaISO(new Date());
export function sumarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  return fechaISO(new Date(a, m - 1, d + n));
}

// --- Importes (se suma en céntimos para no arrastrar decimales falsos) ---
export const cent = (n) => Math.round((Number(n) || 0) * 100);
/** Bruto de una factura = suma de los importes de sus servicios. */
export const bruto = (f) => f.servicios.reduce((a, s) => a + cent(s.importe), 0) / 100;

export function ultimaFechaServicio(f) {
  return f.servicios.reduce((m, s) => (s.fecha && s.fecha > m ? s.fecha : m), '') || null;
}
/** Fecha que manda para ordenar y para el año: la de factura y, si no hay, la del último servicio. */
export const fechaDeFactura = (f) => f.fechaFactura || ultimaFechaServicio(f);
export const anioDe = (f) => (fechaDeFactura(f) || '').slice(0, 4);

/** Fecha (o rango) en que se espera cobrar una factura según el plazo de su cliente. */
export function cobroPrevisto(f, cliente) {
  const base = fechaDeFactura(f);
  const p = cliente && cliente.plazo;
  if (!base || !p) return null;
  if (p.tipo === 'dias') { const x = sumarDias(base, p.dias || 0); return { desde: x, hasta: x }; }
  if (p.tipo === 'mes') {
    const [a, m] = base.split('-').map(Number);       // m es 1-12; como índice 0-11 apunta al mes siguiente
    const ultimo = new Date(a, m + 1, 0).getDate();
    const dia = (x) => fechaISO(new Date(a, m, Math.min(Math.max(1, x || 1), ultimo)));
    return { desde: dia(p.desde), hasta: dia(p.hasta || p.desde) };
  }
  return null;
}

export function textoPlazo(p) {
  if (!p) return 'Sin plazo';
  if (p.tipo === 'dias') return p.dias ? `${p.dias} días` : 'Al momento';
  if (p.tipo === 'mes') return p.desde === p.hasta || !p.hasta ? `Día ${p.desde} del mes siguiente` : `Días ${p.desde}–${p.hasta} del mes siguiente`;
  return 'Sin plazo';
}

// --- Régimen de cada factura: cooperativa o autónomo ---
/** ¿La factura es de autónomo? Sí cuando hay fecha de alta y su fecha de factura es igual o posterior. */
export function esAutonomo(f, ajustes) {
  const alta = ajustes && ajustes.fechaAlta;
  return !!alta && (fechaDeFactura(f) || hoyISO()) >= alta;
}
/** Retención que lleva una factura nueva según el epígrafe (la empresarial no lleva). */
export const retencionPorDefecto = (fiscal) => (fiscal.epigrafe === 'empresarial' ? 0 : Number(fiscal.retencionPct) || 0);
/** IVA que lleva una factura nueva según el régimen de IVA. */
export const ivaPorDefecto = (fiscal) => (fiscal.regimenIva === 'franquicia' ? 0 : Number(fiscal.ivaPct) || 0);

/**
 * Desglose de una factura como autónomo. La base es la suma de los servicios (sin IVA).
 *   iva       = base × IVA %                    (no es mío: se ingresa en el modelo 303)
 *   retencion = base × retención %              (el cliente la ingresa por mí)
 *   total     = base + iva − retencion          (lo que entra en el banco)
 *   irpf      = la retención o, si no lleva, base × % del pago trimestral (estimación de lo que hay que apartar)
 *   neto      = base − irpf                     (la cuota se resta en el total del mes o del año, no aquí)
 * Usa los porcentajes guardados en la factura; si no tiene (simulación), los de ajustes.
 * opciones.subidaPct: subida de tarifa para la simulación.
 */
export function desglose(f, fiscal, opciones = {}) {
  const base = Math.round(cent(bruto(f)) * (1 + (Number(opciones.subidaPct) || 0) / 100));
  const ivaPct = f.ivaPct != null ? Number(f.ivaPct) : ivaPorDefecto(fiscal);
  const retPct = f.retPct != null ? Number(f.retPct) : retencionPorDefecto(fiscal);
  const iva = Math.round(base * ivaPct / 100);
  const retencion = Math.round(base * retPct / 100);
  const irpf = retPct > 0 ? retencion : Math.round(base * (Number(fiscal.pagoFraccionadoPct) || 0) / 100);
  return { base: base / 100, ivaPct, iva: iva / 100, retPct, retencion: retencion / 100, total: (base + iva - retencion) / 100, irpf: irpf / 100, neto: (base - irpf) / 100 };
}
/** Neto de una factura: calculado si es de autónomo; el apuntado al cobrar si es de cooperativa. */
export const netoDe = (f, ajustes) => (esAutonomo(f, ajustes) ? desglose(f, ajustes.fiscal).neto : f.neto);

/**
 * Totales de un grupo de facturas. Regla de la app: el neto manda.
 *  - netoCobrado: solo facturas cobradas (dinero real).
 *  - netoPrevisto: pendientes o sin cerrar que ya tienen neto (apuntado, o calculado si son de autónomo).
 *  - brutoSinNeto: pendientes o sin cerrar SIN neto ("neto por confirmar"); nunca se suman al neto.
 * Con `ajustes` distingue las facturas de autónomo (neto calculado, sin días cotizados); sin él, todo es cooperativa.
 */
export function totales(facturas, ajustes = null) {
  const t = { n: 0, servicios: 0, bruto: 0, netoCobrado: 0, nCobradas: 0, netoPrevisto: 0, nPrevistas: 0, brutoPrevisto: 0, brutoSinNeto: 0, nSinNeto: 0, dias: 0, nAutonomo: 0 };
  for (const f of facturas) {
    const b = cent(bruto(f));
    const aut = !!ajustes && esAutonomo(f, ajustes);
    const neto = aut ? desglose(f, ajustes.fiscal).neto : f.neto;
    t.n++; t.servicios += f.servicios.length; t.bruto += b;
    if (aut) t.nAutonomo++; else t.dias += Number(f.diasSS) || 0;
    if (f.estado === 'cobrada') { t.netoCobrado += cent(neto); t.nCobradas++; }
    else if (neto != null) { t.netoPrevisto += cent(neto); t.brutoPrevisto += b; t.nPrevistas++; }
    else { t.brutoSinNeto += b; t.nSinNeto++; }
  }
  for (const k of ['bruto', 'netoCobrado', 'netoPrevisto', 'brutoPrevisto', 'brutoSinNeto']) t[k] /= 100;
  return t;
}

export function anios(estado) {
  const s = new Set(vivos(estado.facturas).map(anioDe).filter(Boolean));
  for (const g of vivos(estado.gastos || [])) if (g.fecha) s.add(g.fecha.slice(0, 4));
  s.add(String(new Date().getFullYear()));
  return [...s].sort().reverse();
}

export function resumenPorAnio(estado) {
  const fs = vivos(estado.facturas);
  return anios(estado).map((a) => ({ anio: a, ...totales(fs.filter((f) => anioDe(f) === a), estado.ajustes) }));
}

/**
 * Comparación de lo facturado (bruto) con el año anterior. Solo cuentan las facturas cobradas o
 * pendientes de cobro; las que están sin cerrar no. Para el año en curso se compara
 * "hasta hoy" con "hasta el mismo día del año pasado"; para años cerrados, año entero contra año entero.
 */
export function comparativa(estado, anio, hoy = hoyISO()) {
  const fs = vivos(estado.facturas);
  const previo = String(Number(anio) - 1);
  const corte = anio === hoy.slice(0, 4) ? hoy.slice(4) : '-12-31';
  const suma = (a) => fs.filter((f) => f.estado !== 'abierta' && anioDe(f) === a && fechaDeFactura(f) <= a + corte).reduce((x, f) => x + cent(bruto(f)), 0) / 100;
  const actual = suma(anio), anterior = suma(previo);
  return { anio, previo, corte: corte.slice(1), actual, anterior, pct: anterior ? (actual - anterior) / anterior * 100 : null };
}

export const siguienteNumero = (estado) => estado.facturas.reduce((m, f) => Math.max(m, Number(f.n) || 0), 0) + 1;

/** Modalidades para sugerir: las que ya hay en los datos más las habituales que falten. */
export function modalidadesEnUso(estado) {
  const vistas = new Map();
  for (const f of vivos(estado.facturas)) for (const s of f.servicios) if (s.mod) vistas.set(s.mod.toLowerCase(), s.mod);
  for (const m of MODALIDADES) if (!vistas.has(m.toLowerCase())) vistas.set(m.toLowerCase(), m);
  return [...vistas.values()];
}
