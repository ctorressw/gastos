async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('saldo-session-expired'));
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operación.');
  return payload;
}

export const api = {
  session: () => request('/api/auth/session'),
  login: (body) => request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  users: () => request('/api/users'),
  addUser: (body) => request('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  updateUser: (id, body) => request(`/api/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
  projection: (month) => request(`/api/projection?month=${month}`),
  savings: () => request('/api/savings'),
  addSavings: (body) => request('/api/savings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  updateSavings: (id, values) => request(`/api/savings/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }),
  deleteSavings: (id) => request(`/api/savings/${id}`, { method: 'DELETE' }),
  recurring: (id, recurring) => request(`/api/transactions/${id}/recurring`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recurring }) }),
  databaseTables: () => request('/api/database'),
  databaseRows: (table) => request(`/api/database/${table}`),
  databaseUpdate: (table, id, values) => request(`/api/database/${table}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }),
  databaseDelete: (table, id) => request(`/api/database/${table}/${id}`, { method: 'DELETE' }),
  databaseClear: (table) => request(`/api/database/${table}`, { method: 'DELETE' }),
  dashboard: (month) => request(`/api/dashboard?month=${month}`),
  transactions: (month) => request(`/api/transactions?month=${month}`),
  imports: () => request('/api/imports'),
  categories: () => request('/api/categories'),
  addCategory: (body) => request('/api/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  updateCategory: (id, body) => request(`/api/categories/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  deleteCategory: (id) => request(`/api/categories/${id}`, { method: 'DELETE' }),
  settings: () => request('/api/settings'),
  updateSettings: (body) => request('/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  exchangeRate: (auto = false) => request(`/api/exchange-rate?auto=${auto}`),
  refreshExchangeRate: () => request('/api/exchange-rate/refresh', { method: 'POST' }),
  saveExchangeRate: (body) => request('/api/exchange-rate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  categoryReport: (from, to, rate) => request(`/api/reports/categories?from=${from}&to=${to}${rate ? `&rate=${rate}` : ''}`),
  addTransaction: (body) => request('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  deleteTransaction: (id) => request(`/api/transactions/${id}`, { method: 'DELETE' }),
  updateTransaction: (id, body) => request(`/api/transactions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  previewStatement: (file) => {
    const formData = new FormData();
    formData.append('pdf', file);
    return request('/api/imports/statement/preview', { method: 'POST', body: formData });
  },
  importStatement: (file, cards = []) => {
    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('cards', JSON.stringify(cards));
    return request('/api/imports/statement', { method: 'POST', body: formData });
  },
  deleteImport: (id) => request(`/api/imports/${id}`, { method: 'DELETE' }),
};
