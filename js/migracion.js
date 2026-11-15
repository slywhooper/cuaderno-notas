// migracion.js — Convierte la copia de seguridad de la app antigua ("mis-facturas", versión 2, sin cifrar)
// al estado de esta app, sin perder datos, y devuelve un informe con cifras de control.

import { estadoVacio, bruto, ultimaFechaServicio, totales } from './modelo.js';

const ESTADO_ANTIGUO = { 'cobrada': 'cobrada', 'pendiente de cobro': 'pendiente', 'sin cerrar': 'abierta' };

export const esCopiaAntigua = (o) => !!o && o.app === 'mis-facturas' && Array.isArray(o.facturas);

/** Nombre reducido a letras y números en minúscula, para comparar "Tele-Uno" con "Tele - UNO". */
export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const numero = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function migrarCopiaV2(copia) {
  const marca = Date.parse(copia.fecha) || Date.now(); // todos los registros nacen con la fecha de la copia
  const estado = estadoVacio();
  const informe = { netosDescartados: [], estadosRaros: [], plazosAsignados: [], plazosSinCliente: [], fechasPuestas: 0, huecos: [] };

  // Clientes: uno por cada nombre distinto que aparece en las facturas (id estable a partir del nombre).
  const porNombre = new Map();
  for (const f of copia.facturas) {
    const nombre = String(f.cliente || 'Sin cliente').trim();
    if (!porNombre.has(nombre)) porNombre.set(nombre, { id: 'c_' + normalizar(nombre), nombre, plazo: null, _mod: marca, _base: marca });
  }
  estado.clientes = [...porNombre.values()];

  // Plazos de cobro: se enganchan al cliente cuyo nombre coincide o empieza igual. Si no hay uno claro, se avisa.
  for (const p of copia.plazos || []) {
    const clave = normalizar(p.cliente);
    const plazo = p.tipo === 'mes' ? { tipo: 'mes', desde: Number(p.desde) || 1, hasta: Number(p.hasta) || Number(p.desde) || 1 }
                                   : { tipo: 'dias', dias: Number(p.dias) || 0 };
    const candidatos = estado.clientes.filter((c) => { const n = normalizar(c.nombre); return clave && (n === clave || n.startsWith(clave) || clave.startsWith(n)); });
    if (candidatos.length === 1 && !candidatos[0].plazo) { candidatos[0].plazo = plazo; informe.plazosAsignados.push({ plazo: p.cliente, cliente: candidatos[0].nombre }); }
    else informe.plazosSinCliente.push({ nombre: p.cliente, plazo });
  }

  // Facturas
  for (const f of copia.facturas) {
    const servicios = (f.servicios || []).map((s) => ({
      evento: String(s.evento || ''), mod: String(s.mod || ''), fecha: s.fecha || null, dias: numero(s.dias), importe: numero(s.importe) || 0,
    }));
    const nueva = {
      id: String(f.id), n: numero(f.n), ref: String(f.ref || ''), clienteId: 'c_' + normalizar(String(f.cliente || 'Sin cliente').trim()),
      estado: ESTADO_ANTIGUO[String(f.estado || '').toLowerCase()] || 'abierta',
      fechaFactura: f.fechaFactura || null, fechaCobro: null, neto: numero(f.neto), diasSS: numero(f.diasSS), nota: String(f.nota || ''),
      servicios, _mod: marca, _base: marca,
    };
    if (!ESTADO_ANTIGUO[String(f.estado || '').toLowerCase()]) informe.estadosRaros.push({ n: f.n, estado: f.estado });
    // Datos de la app antigua que ya no se usan en cálculos pero se conservan tal cual.
    if (numero(f.total) !== null || numero(f.ajuste)) nueva.antiguo = { total: numero(f.total), ajuste: numero(f.ajuste) };
    // Sin fecha de factura: se usa la del último servicio (se puede editar después).
    if (!nueva.fechaFactura) { nueva.fechaFactura = ultimaFechaServicio(nueva); nueva.fechaEstimada = true; informe.fechasPuestas++; }
    // Un neto mayor que el importe no puede ser correcto: se deja vacío y se avisa.
    if (nueva.neto !== null && nueva.neto > bruto(nueva) + 0.005) {
      informe.netosDescartados.push({ n: nueva.n, neto: nueva.neto, bruto: bruto(nueva) });
      nueva.neto = null;
    }
    estado.facturas.push(nueva);
  }

  // Cifras de control: lo que dice el archivo frente a lo que queda en la app.
  const crudo = { facturas: copia.facturas.length, servicios: 0, brutoCent: 0, netoCent: 0, dias: 0 };
  for (const f of copia.facturas) {
    crudo.servicios += (f.servicios || []).length;
    for (const s of f.servicios || []) crudo.brutoCent += Math.round((Number(s.importe) || 0) * 100);
    crudo.netoCent += Math.round((Number(f.neto) || 0) * 100);
    crudo.dias += Number(f.diasSS) || 0;
  }
  const t = totales(estado.facturas);
  const netoApp = estado.facturas.reduce((a, f) => a + Math.round((f.neto || 0) * 100), 0) / 100;
  informe.archivo = { facturas: crudo.facturas, servicios: crudo.servicios, bruto: crudo.brutoCent / 100, neto: crudo.netoCent / 100, dias: crudo.dias };
  informe.app = { facturas: t.n, servicios: t.servicios, bruto: t.bruto, neto: netoApp, dias: t.dias };
  const nums = estado.facturas.map((f) => f.n).filter((n) => n != null);
  for (let i = 1; i <= Math.max(0, ...nums); i++) if (!nums.includes(i)) informe.huecos.push(i);
  informe.idsFacturas = estado.facturas.map((f) => f.id);
  return { estado, informe };
}
