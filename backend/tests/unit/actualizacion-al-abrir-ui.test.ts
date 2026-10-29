import { describe, expect, test, vi } from 'vitest';
import type { ResultadoAlAbrir } from '../../src/services/actualizacion-al-abrir.js';
import { actualizarClimaAlAbrir, type DependenciasActualizacionAlAbrir } from '../../../src/api/actualizacionAlAbrir.js';

const id = 'establecimiento-1';
const clima = { estado: 'error' as const, loteId: 'lote-1', mensaje: 'Sin datos guardados' };

function respuesta(climaParcial: Partial<NonNullable<ResultadoAlAbrir['resumen']>['clima']> = {}): ResultadoAlAbrir {
  return {
    ejecutado: true,
    resumen: {
      comenzoEn: '2026-10-29T10:00:00.000Z',
      terminoEn: '2026-10-29T10:00:01.000Z',
      satelite: { pendientes: 0, consultados: 0, persistidos: 0, sinDatos: 0, errores: 0, fallosProveedor: 0, erroresPersistencia: 0, cortado: false },
      clima: { pendientes: 1, consultados: 1, persistidos: 1, sinDatos: 0, errores: 0, fallosProveedor: 0, erroresPersistencia: 0, cortado: false, ...climaParcial },
    },
  };
}

function dependencias(respuestaMock: ResultadoAlAbrir): DependenciasActualizacionAlAbrir & { actualizar: ReturnType<typeof vi.fn>; obtenerLecturas: ReturnType<typeof vi.fn> } {
  return {
    actualizar: vi.fn().mockResolvedValue(respuestaMock),
    obtenerLecturas: vi.fn().mockResolvedValue({ clima: { 'lote-1': clima } }),
  };
}

describe('actualización de clima al abrir desde la interfaz', () => {
  test('recarga y muestra éxito cuando la ejecución completa guardó clima', async () => {
    const deps = dependencias(respuesta());
    const resultado = await actualizarClimaAlAbrir(id, () => true, deps);
    expect(resultado.estado).toBe('completo');
    expect(resultado.aviso).toMatchObject({ kind: 'success', text: 'Clima actualizado para 1 lote(s).' });
    expect(resultado.clima).toEqual({ 'lote-1': clima });
    expect(deps.obtenerLecturas).toHaveBeenCalledWith(id);
  });

  test('conserva lecturas persistidas y advierte ante errores, falta de datos o corte parcial', async () => {
    const deps = dependencias(respuesta({ consultados: 2, pendientes: 3, persistidos: 1, sinDatos: 1, errores: 1, cortado: true }));
    const resultado = await actualizarClimaAlAbrir(id, () => true, deps);
    expect(resultado.estado).toBe('parcial');
    expect(resultado.clima).toEqual({ 'lote-1': clima });
    expect(resultado.aviso).toMatchObject({ kind: 'warning' });
    expect(resultado.aviso?.text).toContain('1 lote(s) con error');
    expect(resultado.aviso?.text).toContain('Se conservan las lecturas guardadas');
    expect(deps.obtenerLecturas).toHaveBeenCalledOnce();
  });

  test('informa un fallo HTTP sin borrar lecturas ni intentar recargarlas', async () => {
    const deps = dependencias(respuesta());
    deps.actualizar.mockRejectedValue(new Error('HTTP unavailable'));
    const resultado = await actualizarClimaAlAbrir(id, () => true, deps);
    expect(resultado.estado).toBe('fallido');
    expect(resultado.aviso).toMatchObject({ kind: 'error', text: expect.stringContaining('Se mantienen las últimas lecturas guardadas') });
    expect(resultado.clima).toBeUndefined();
    expect(deps.obtenerLecturas).not.toHaveBeenCalled();
  });

  test('omite silenciosamente una ejecución dentro del enfriamiento', async () => {
    const deps = dependencias({ ejecutado: false, motivo: 'reciente' });
    const resultado = await actualizarClimaAlAbrir(id, () => true, deps);
    expect(resultado).toEqual({ estado: 'omitido' });
    expect(deps.obtenerLecturas).not.toHaveBeenCalled();
  });

  test('descarta la respuesta de un establecimiento que dejó de estar vigente', async () => {
    const deps = dependencias(respuesta());
    const resultado = await actualizarClimaAlAbrir(id, () => false, deps);
    expect(resultado).toEqual({ estado: 'obsoleto' });
    expect(deps.obtenerLecturas).not.toHaveBeenCalled();
  });

  test('si no puede recargar las lecturas guardadas, conserva el estado previo y avisa', async () => {
    const deps = dependencias(respuesta());
    deps.obtenerLecturas.mockRejectedValue(new Error('HTTP unavailable'));
    const resultado = await actualizarClimaAlAbrir(id, () => true, deps);
    expect(resultado.estado).toBe('fallido');
    expect(resultado.clima).toBeUndefined();
    expect(resultado.aviso?.text).toContain('actualizar o recargar el clima');
  });
});
