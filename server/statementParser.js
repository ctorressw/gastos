import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{2,4})\b/;
const INSTALLMENT_RE = /(\d{1,2})\s+de\s+(\d{1,2})/i;

function clean(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseArgentineMoney(value) {
  if (!value) return null;
  const normalized = value
    .replace(/U\$S|US\$|\$/gi, '')
    .replace(/pesos?|d[oó]lares?/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function isoDate(match) {
  if (!match) return null;
  const [, day, month, rawYear] = match;
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  return `${year}-${month}-${day}`;
}

function monthKey(date) {
  return date.slice(0, 7);
}

export function addMonths(date, count) {
  const [year, month] = monthKey(date).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function categorize(description) {
  const text = description.toLowerCase();
  if (/supermercado|carrefour|nini|dia%|coto|jumbo/.test(text)) return 'Supermercado';
  if (/ypf|combust|shell|axion|autopista|peaje|neumatic/.test(text)) return 'Transporte';
  if (/spotify|netflix|primevideo|youtube|openai|chatgpt|canva|mubi/.test(text)) return 'Suscripciones';
  if (/claro|personal|tuenti|edenor|gas|factura/.test(text)) return 'Servicios';
  if (/burger|burguer|restaurant|cafe|pedidosya|rappi/.test(text)) return 'Comidas';
  if (/seguro/.test(text)) return 'Seguros';
  if (/libro|juego|toy|deporte|mimo|mercadolibre|merpago|meli/.test(text)) return 'Compras';
  if (/impuesto|sellos|rg 5617|percepci/.test(text)) return 'Impuestos';
  return 'Otros';
}

function groupRows(items) {
  const rows = [];
  for (const item of items) {
    const text = clean(item.str);
    if (!text) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    let row = rows.find((candidate) => Math.abs(candidate.y - y) < 2.4);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => ({
      ...row,
      items: row.items.sort((a, b) => a.x - b.x),
      text: clean(row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ')),
    }));
}

function findColumns(row) {
  const items = row.items;
  const xFor = (label) => items.find((item) => item.text.toLowerCase().includes(label))?.x;
  const date = xFor('fecha');
  const description = xFor('descripci');
  const installment = xFor('cuota');
  const receipt = xFor('comprobante');
  const pesos = xFor('monto en pesos');
  const dollars = xFor('monto en d');
  if ([date, description, pesos, dollars].some((value) => value == null)) return null;
  const midpoint = (a, b) => (a + b) / 2;
  if (installment != null && receipt != null) {
    return {
      description: midpoint(date, description),
      installment: midpoint(description, installment),
      receipt: midpoint(installment, receipt),
      pesos: midpoint(receipt, pesos),
      dollars: midpoint(pesos, dollars),
      detailed: true,
    };
  }
  return {
    description: midpoint(date, description),
    installment: null,
    receipt: null,
    pesos: midpoint(description, pesos),
    dollars: midpoint(pesos, dollars),
    detailed: false,
  };
}

function columnText(row, min, max = Infinity) {
  return clean(row.items.filter((item) => item.x >= min && item.x < max).map((item) => item.text).join(' '));
}

function parseTransactionRow(row, columns, carriedDate, cardLast4, cardHolder = null) {
  const dateMatch = row.text.match(DATE_RE);
  const purchaseDate = isoDate(dateMatch) || carriedDate;
  const description = columnText(row, columns.description, columns.installment ?? columns.pesos);
  const installmentText = columns.detailed ? columnText(row, columns.installment, columns.receipt) : '';
  const receiptText = columns.detailed ? columnText(row, columns.receipt, columns.pesos) : '';
  const pesosText = columnText(row, columns.pesos, columns.dollars);
  const dollarsText = columnText(row, columns.dollars);
  const amountArs = parseArgentineMoney(pesosText);
  const amountUsd = parseArgentineMoney(dollarsText);
  const amount = amountArs ?? amountUsd;

  if (!description || amount == null || amount === 0) return null;
  if (/subtotal|total|m[ií]nimo|saldo anterior|su pago/i.test(description)) return null;

  const installmentMatch = installmentText.match(INSTALLMENT_RE);
  return {
    purchaseDate,
    description,
    category: categorize(description),
    receipt: receiptText.match(/\b\d{6}\b/)?.[0] || null,
    type: amount < 0 ? 'income' : 'expense',
    amountCents: Math.abs(amount),
    currency: amountArs != null ? 'ARS' : 'USD',
    installmentCurrent: installmentMatch ? Number(installmentMatch[1]) : null,
    installmentTotal: installmentMatch ? Number(installmentMatch[2]) : null,
    cardLast4,
    cardHolder,
  };
}

function metadataFromRows(pages) {
  const allRows = pages.flatMap((page) => page.rows);
  let dueDate = null;
  let statementDate = null;
  for (const row of pages[0]?.rows || []) {
    const dates = [...row.text.matchAll(new RegExp(DATE_RE.source, 'g'))];
    if (dates.length >= 6) {
      statementDate = isoDate(dates[2]);
      dueDate = isoDate(dates[3]);
      break;
    }
  }

  let totalArsCents = 0;
  let totalUsdCents = 0;
  const totalRow = allRows.find((row) => /total a pagar/i.test(row.text) && /\$/.test(row.text));
  if (totalRow) {
    const ars = totalRow.text.match(/\$\s*([\d.]+,\d{2})/);
    const usd = totalRow.text.match(/U\$S\s*([\d.]+,\d{2})/i);
    totalArsCents = parseArgentineMoney(ars?.[1]) || 0;
    totalUsdCents = parseArgentineMoney(usd?.[1]) || 0;
  }

  if (!dueDate) throw new Error('No se pudo identificar la fecha de vencimiento del resumen.');
  return { statementDate, dueDate, totalArsCents, totalUsdCents };
}

export async function parseVisaStatement(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const pdf = await task.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({ pageNumber, rows: groupRows(content.items) });
  }

  const metadata = metadataFromRows(pages);
  const transactions = [];
  let activeColumns = null;
  let cardLast4 = null;
  let carriedDate = null;
  let movementStarted = false;
  let cardHolder = null;
  let pendingHolder = null;
  let commonSection = false;
  const cardholders = new Map();

  for (const page of pages) {
    activeColumns = null;
    for (const row of page.rows) {
      const holderMatch = row.text.match(/movimientos de\s+(.+)/i);
      if (holderMatch) {
        movementStarted = true;
        commonSection = false;
        pendingHolder = clean(holderMatch[1]);
      }
      if (/impuestos,\s*intereses\s+y\s+percepciones/i.test(row.text)) {
        commonSection = true;
        cardLast4 = null;
        cardHolder = null;
        activeColumns = null;
      }
      const cardMatch = row.text.match(/terminada en\s+(\d{4})/i);
      if (cardMatch && !commonSection) {
        cardLast4 = cardMatch[1];
        if (pendingHolder) cardholders.set(cardLast4, pendingHolder);
        cardHolder = cardholders.get(cardLast4) || null;
      }

      const columns = /fecha/i.test(row.text) && /descripci/i.test(row.text) && (movementStarted || /cuota/i.test(row.text))
        ? findColumns(row)
        : null;
      if (columns) {
        activeColumns = columns;
        continue;
      }
      if (/subtotal/i.test(row.text)) {
        activeColumns = null;
        continue;
      }
      if (!activeColumns) continue;

      const explicitDate = isoDate(row.text.match(DATE_RE));
      if (explicitDate) carriedDate = explicitDate;
      const transaction = parseTransactionRow(row, activeColumns, carriedDate, commonSection ? null : cardLast4, commonSection ? null : cardHolder);
      if (transaction) transactions.push(transaction);
    }
  }

  if (!transactions.length) {
    throw new Error('El PDF no contiene consumos reconocibles. Verificá que sea un resumen Visa digital.');
  }

  const projectedInstallments = [];
  transactions.forEach((transaction, index) => {
    const current = transaction.installmentCurrent;
    const total = transaction.installmentTotal;
    if (!current || !total || current >= total) return;
    for (let number = current + 1; number <= total; number += 1) {
      projectedInstallments.push({
        description: transaction.description,
        category: transaction.category,
        amountCents: transaction.amountCents,
        currency: transaction.currency,
        dueMonth: addMonths(metadata.dueDate, number - current),
        installmentNumber: number,
        installmentTotal: total,
        cardLast4: transaction.cardLast4,
        sourceIndex: index,
      });
    }
  });

  const summarize = (rows) => rows.reduce((summary, transaction) => {
    const sign = transaction.type === 'income' ? -1 : 1;
    if (transaction.currency === 'USD') summary.usdCents += sign * transaction.amountCents;
    else summary.arsCents += sign * transaction.amountCents;
    summary.transactionCount += 1;
    return summary;
  }, { transactionCount: 0, arsCents: 0, usdCents: 0 });
  const cards = [...new Set(transactions.map((transaction) => transaction.cardLast4).filter(Boolean))].map((last4) => ({
    last4,
    holder: cardholders.get(last4) || transactions.find((transaction) => transaction.cardLast4 === last4)?.cardHolder || null,
    ...summarize(transactions.filter((transaction) => transaction.cardLast4 === last4)),
  }));
  const common = summarize(transactions.filter((transaction) => !transaction.cardLast4));

  return { ...metadata, transactions, projectedInstallments, cards, common, pages: pdf.numPages };
}
