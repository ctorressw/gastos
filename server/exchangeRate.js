export const DOLAR_HOY_URL = 'https://dolarhoy.com/historico-dolar-blue';

export function parseDolarHoySale(html) {
  const section = html.match(/<div class="historicodb__dolar-blue">([\s\S]*?)<div class="navigator">/i)?.[1] || html;
  const match = section.match(/<div class="venta">[\s\S]*?<div class="valor">\s*\$?\s*([\d.]+(?:,\d{1,2})?)/i);
  if (!match) throw new Error('Dólar Hoy no publicó un valor venta reconocible.');
  const normalized = match[1].replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) throw new Error('La cotización recibida no es válida.');
  return value;
}

export async function fetchDolarHoySale() {
  const response = await fetch(DOLAR_HOY_URL, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Saldo/1.0 (+personal finance dashboard)',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Dólar Hoy respondió con estado ${response.status}.`);
  const html = await response.text();
  return parseDolarHoySale(html);
}

export function argentinaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
