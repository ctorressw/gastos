import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, categorize, parseArgentineMoney } from './statementParser.js';

test('parseArgentineMoney interpreta el formato argentino y conserva devoluciones', () => {
  assert.equal(parseArgentineMoney('$ 3.265.928,06'), 326592806);
  assert.equal(parseArgentineMoney('-$ 31.042,68'), -3104268);
  assert.equal(parseArgentineMoney('U$S 146,24'), 14624);
});

test('addMonths cruza años y devuelve el primer día del mes', () => {
  assert.equal(addMonths('2026-11-11', 1), '2026-12-01');
  assert.equal(addMonths('2026-11-11', 3), '2027-02-01');
});

test('categorize clasifica consumos frecuentes', () => {
  assert.equal(categorize('AppYPF combustible'), 'Transporte');
  assert.equal(categorize('OpenAI ChatGPT subscription'), 'Suscripciones');
  assert.equal(categorize('Impuesto de sellos'), 'Impuestos');
});
