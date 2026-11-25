import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDolarHoySale } from './exchangeRate.js';

test('parseDolarHoySale toma el valor venta del bloque de dólar blue', () => {
  const html = `
    <div class="historicodb__dolar-blue">
      <div class="titulo">Dólar Blue Hoy</div>
      <div class="valores">
        <div class="compra"><div class="valor">$1.710</div></div>
        <div class="venta"><div class="titulo">Venta</div><div class="valor">$1.730</div></div>
      </div>
    </div><div class="navigator"></div>`;
  assert.equal(parseDolarHoySale(html), 1730);
});

test('parseDolarHoySale rechaza contenido sin cotización', () => {
  assert.throws(() => parseDolarHoySale('<html></html>'), /valor venta reconocible/);
});
