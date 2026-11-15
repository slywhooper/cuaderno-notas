// csv.js — Exportación a CSV (una fila por servicio). Formato para Excel en español: ';' y coma decimal.
// OJO: el CSV NO va cifrado.

import { vivos, bruto, ESTADOS, esAutonomo, desglose, anioDe, fechaDeFactura, hoyISO } from './modelo.js';
import { calculoGasto, amortizadoEnAnio, valorAmortizable } from './fiscal.js';

const BOM = '\ufeff'; // marca para que Excel lea bien los acentos
const num = (n) => (n == null ? '' : String(n).replace('.', ','));
function texto(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // evita que Excel lo interprete como fórmula
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function aCSV(estado) {
  const clientes = new Map(estado.clientes.map((c) => [c.id, c.nombre]));
  const filas = [['numero', 'referencia', 'cliente', 'estado', 'fecha_factura', 'fecha_cobro', 'neto_factura', 'bruto_factura',
    'dias_cotizados', 'evento', 'modalidad', 'fecha_servicio', 'dias_servicio', 'importe_servicio', 'nota',
    'regimen', 'iva_pct', 'iva', 'retencion_pct', 'retencion', 'total_a_cobrar']];
  const facturas = vivos(estado.facturas).sort((a, b) => (a.n || 0) - (b.n || 0));
  for (const f of facturas) {
    const aut = esAutonomo(f, estado.ajustes), d = aut ? desglose(f, estado.ajustes.fiscal) : null;
    const comun = [num(f.n), texto(f.ref), texto(clientes.get(f.clienteId) || ''), ESTADOS[f.estado] || '', f.fechaFactura || '', f.fechaCobro || '',
      num(aut ? d.neto : f.neto), num(bruto(f)), num(aut ? null : f.diasSS)];
    const cola = aut ? ['autónomo', num(d.ivaPct), num(d.iva), num(d.retPct), num(d.retencion), num(d.total)] : ['cooperativa', '', '', '', '', ''];
    const servicios = f.servicios.length ? f.servicios : [{}];
    for (const s of servicios) filas.push([...comun, texto(s.evento), texto(s.mod), s.fecha || '', num(s.dias), num(s.importe), texto(f.nota), ...cola]);
  }
  return BOM + filas.map((f) => f.join(';')).join('\r\n') + '\r\n';
}

/** Libro de gastos en CSV: una fila por gasto, con lo que resta de IVA y de IRPF. Tampoco va cifrado. */
export function gastosCSV(estado) {
  const fiscal = estado.ajustes.fiscal, cats = new Map((fiscal.categorias || []).map((c) => [c.id, c.nombre]));
  const filas = [['fecha', 'proveedor', 'numero_factura', 'categoria', 'base', 'iva_pct', 'iva', 'total', 'deducible_iva_pct', 'iva_deducible',
    'deducible_irpf_pct', 'gasto_irpf', 'justificante_guardado', 'nota', 'se_amortiza', 'amortizacion_pct']];
  for (const g of vivos(estado.gastos || []).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))) {
    const c = calculoGasto(g, fiscal);
    filas.push([g.fecha || '', texto(g.proveedor), texto(g.numFactura), texto(cats.get(g.categoria) || g.categoria || ''), num(g.base), num(g.ivaPct), num(g.iva), num(c.total),
      num(g.dedIva), num(c.ivaDed), num(g.dedIrpf), num(c.gastoIrpf), g.justificante ? 'sí' : 'no', texto(g.nota), g.amortiza ? 'sí' : 'no', num(g.amortiza ? g.amortPct : null)]);
  }
  return BOM + filas.map((f) => f.join(';')).join('\r\n') + '\r\n';
}

// ---------- Libros registro (fase 3B) ----------
// Tres CSV por año con el contenido de los libros de IVA e IRPF. Solo actividad de autónomo (desde la fecha de alta).
// No son el formato electrónico oficial de la Agencia Tributaria: llevan los mismos datos, en columnas legibles.
// La columna de NIF va vacía: la app no guarda el NIF de clientes ni de proveedores (decisión del usuario).
const csv = (filas) => BOM + filas.map((f) => f.join(';')).join('\r\n') + '\r\n';
const deAutonomo = (estado, fecha) => !!estado.ajustes.fechaAlta && !!fecha && fecha >= estado.ajustes.fechaAlta;

/** Libro de facturas emitidas: una fila por factura de autónomo emitida en el año (las «sin cerrar» no). Al final, las ayudas, que no son facturas pero sí ingresos. */
export function libroEmitidas(estado, anio) {
  anio = String(anio);
  const clientes = new Map(estado.clientes.map((c) => [c.id, c.nombre])), fiscal = estado.ajustes.fiscal;
  const filas = [['tipo', 'fecha_expedicion', 'numero', 'referencia', 'nif_cliente', 'cliente', 'concepto', 'base_imponible', 'tipo_iva_pct', 'cuota_iva',
    'total_factura', 'retencion_pct', 'retencion_irpf', 'total_a_cobrar', 'estado', 'fecha_cobro']];
  const fs = vivos(estado.facturas).filter((f) => f.estado !== 'abierta' && anioDe(f) === anio && esAutonomo(f, estado.ajustes))
    .sort((a, b) => fechaDeFactura(a).localeCompare(fechaDeFactura(b)) || (a.n || 0) - (b.n || 0));
  for (const f of fs) {
    const d = desglose(f, fiscal), concepto = [...new Set(f.servicios.map((s) => s.evento).filter(Boolean))].join(' / ');
    filas.push(['factura', fechaDeFactura(f), num(f.n), texto(f.ref), '', texto(clientes.get(f.clienteId) || ''), texto(concepto), num(d.base), num(d.ivaPct), num(d.iva),
      num(Math.round((d.base + d.iva) * 100) / 100), num(d.retPct), num(d.retencion), num(d.total), ESTADOS[f.estado] || '', f.fechaCobro || '']);
  }
  for (const y of vivos(estado.ayudas || []).filter((x) => deAutonomo(estado, x.fecha) && x.fecha.slice(0, 4) === anio).sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    filas.push(['ayuda (no es factura)', y.fecha, '', '', '', '', texto(y.concepto || 'Ayuda'), num(y.importe), num(0), num(0), num(y.importe), num(0), num(0), num(y.importe), '', '']);
  }
  return csv(filas);
}

/** Libro de facturas recibidas: una fila por gasto del año, con lo que se deduce de IVA y de IRPF. */
export function libroRecibidas(estado, anio) {
  anio = String(anio);
  const fiscal = estado.ajustes.fiscal, cats = new Map((fiscal.categorias || []).map((c) => [c.id, c.nombre]));
  const filas = [['fecha', 'numero_factura', 'nif_proveedor', 'proveedor', 'concepto', 'base_imponible', 'tipo_iva_pct', 'cuota_iva', 'total_factura',
    'iva_deducible', 'gasto_deducible_irpf', 'se_amortiza', 'justificante_guardado', 'nota']];
  for (const g of vivos(estado.gastos || []).filter((x) => deAutonomo(estado, x.fecha) && x.fecha.slice(0, 4) === anio).sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const c = calculoGasto(g, fiscal);
    filas.push([g.fecha, texto(g.numFactura), '', texto(g.proveedor), texto(cats.get(g.categoria) || g.categoria || ''), num(g.base), num(g.ivaPct), num(g.iva), num(c.total),
      num(c.ivaDed), g.amortiza ? '' : num(c.gastoIrpf), g.amortiza ? 'sí (ver libro de bienes de inversión)' : 'no', g.justificante ? 'sí' : 'no', texto(g.nota)]);
  }
  return csv(filas);
}

/** Libro de bienes de inversión: el material que se amortiza, comprado hasta ese año, con lo amortizado en el año y en total. */
export function libroBienes(estado, anio, hoy = hoyISO()) {
  anio = String(anio);
  const fiscal = estado.ajustes.fiscal, cats = new Map((fiscal.categorias || []).map((c) => [c.id, c.nombre]));
  const fin = anio < hoy.slice(0, 4) ? `${anio}-12-31` : hoy;
  const filas = [['fecha_compra', 'numero_factura', 'proveedor', 'descripcion', 'base_imponible', 'cuota_iva', 'iva_deducido', 'valor_amortizable', 'amortizacion_pct_anual',
    `amortizacion_${anio}`, 'amortizacion_acumulada', 'pendiente_de_amortizar', 'bien_de_inversion_en_iva']];
  for (const g of vivos(estado.gastos || []).filter((x) => x.amortiza && deAutonomo(estado, x.fecha) && x.fecha.slice(0, 4) <= anio).sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const valor = valorAmortizable(g, fiscal), delAnio = amortizadoEnAnio(g, fiscal, anio, fin);
    let acum = delAnio;
    for (let a = Number(g.fecha.slice(0, 4)); a < Number(anio); a++) acum += amortizadoEnAnio(g, fiscal, String(a), `${a}-12-31`);
    const enIva = fiscal.regimenIva !== 'franquicia' && Math.round(g.base * 100) >= Math.round(fiscal.umbralInversionIva * 100);
    filas.push([g.fecha, texto(g.numFactura), texto(g.proveedor), texto(g.nota || cats.get(g.categoria) || ''), num(g.base), num(g.iva), num(calculoGasto(g, fiscal).ivaDed), num(valor / 100),
      num(g.amortPct), num(delAnio / 100), num(acum / 100), num((valor - acum) / 100), enIva ? 'sí' : 'no']);
  }
  return csv(filas);
}
