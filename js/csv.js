// csv.js — Exportación a CSV (una fila por servicio). Formato para Excel en español: ';' y coma decimal.
// OJO: el CSV NO va cifrado.

import { vivos, bruto, ESTADOS, esAutonomo, desglose } from './modelo.js';
import { calculoGasto } from './fiscal.js';

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
