import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AlertTriangle,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  ExternalLink,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Settings2,
  Tags,
  TrendingUp,
  Trash2,
  UploadCloud,
  WalletCards,
  Users,
  X,
} from 'lucide-react';
import { api } from './api.js';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { id: 'movements', label: 'Movimientos', icon: ReceiptText },
  { id: 'planning', label: 'Planificación', icon: CalendarDays },
  { id: 'reports', label: 'Reportes', icon: ChartNoAxesColumnIncreasing },
  { id: 'import', label: 'Importar resumen', icon: UploadCloud },
  { id: 'database', label: 'Base de datos', icon: Settings2 },
  { id: 'users', label: 'Usuarios', icon: Users },
];

const CATEGORY_COLORS = ['#2769d2', '#59a88f', '#ec8b66', '#755fb4', '#d6a136', '#4b8daa', '#d46376', '#8d765c', '#82909a'];

const money = (value, currency = 'ARS') => new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency,
  maximumFractionDigits: currency === 'ARS' ? 0 : 2,
}).format(value || 0);

const monthLabel = (month, style = 'long') => {
  const [year, number] = month.split('-').map(Number);
  const value = new Intl.DateTimeFormat('es-AR', { month: style, year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, number - 1, 1)));
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const shortDate = (value) => new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', timeZone: 'UTC' })
  .format(new Date(`${value}T00:00:00Z`));

function shiftMonth(month, delta) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(month) {
  const [year, number] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

const fullDate = (value) => value ? new Intl.DateTimeFormat('es-AR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`)) : 'Sin fecha';

function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    api.session().then((result) => setSession(result.user)).catch(() => setSession(null));
    const expired = () => setSession(null);
    window.addEventListener('saldo-session-expired', expired);
    return () => window.removeEventListener('saldo-session-expired', expired);
  }, []);
  if (session === undefined) return <PageLoader />;
  if (!session) return <Login onLogin={setSession} />;
  return <Workspace user={session} onLogout={() => setSession(null)} />;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(''); try { const result = await api.login({ username, password }); onLogin(result.user); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  return <main className="login-shell"><form className="login-card" onSubmit={submit}><div className="login-brand"><span className="brand-mark"><span /><span /><span /></span><strong>saldo</strong></div><h1>Ingresá a tu cuenta</h1><p>Accedé a tus movimientos y tu planificación.</p><label>Usuario<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="primary-button wide" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button></form></main>;
}

function Workspace({ user, onLogout }) {
  const [activeView, setActiveView] = useState('dashboard');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [imports, setImports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transactionModal, setTransactionModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [categoriesModal, setCategoriesModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardData, movementData, importData, categoryData] = await Promise.all([
        api.dashboard(month),
        api.transactions(month),
        api.imports(),
        api.categories(),
      ]);
      setDashboard(dashboardData);
      setTransactions(movementData);
      setImports(importData);
      setCategories(categoryData);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [month, notify]);

  useEffect(() => { refresh(); }, [refresh]);

  const addTransaction = async (values) => {
    try {
      const result = await api.addTransaction(values);
      setTransactionModal(false);
      const quantity = result.transactions?.length || 1;
      if (result.account?.isOverLimit) {
        notify(`Movimiento guardado. El descubierto supera su límite en ${money(result.account.overdraftUsedArs - result.account.overdraftLimitArs)}.`, 'error');
      } else if (result.account?.isOverdraft) {
        notify(`Movimiento guardado. Estás usando ${money(result.account.overdraftUsedArs)} del descubierto.`, 'warning');
      } else {
        notify(quantity > 1 ? `${quantity} cuotas mensuales guardadas.` : values.type === 'income' ? 'Ingreso guardado.' : 'Egreso guardado.');
      }
      await refresh();
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const deleteTransaction = async (id, movement) => {
    if (movement?.installment_total > 1 && !window.confirm(`¿Eliminar las ${movement.installment_total} cuotas de “${movement.description}”?`)) return;
    try {
      const result = await api.deleteTransaction(id);
      notify(result.deletedSeries ? `Plan eliminado: ${result.deletedCount} cuotas quitadas.` : 'Movimiento eliminado.');
      await refresh();
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const importStatement = async (file, cards) => {
    const result = await api.importStatement(file, cards);
    notify(`${result.transactionCount} consumos y ${result.projectedCount} cuotas futuras incorporadas.`);
    await refresh();
    return result;
  };

  const deleteImport = async (id) => {
    try {
      await api.deleteImport(id);
      notify('Resumen y proyecciones eliminados.');
      await refresh();
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />
      <main className="main-content">
        <Topbar
          month={month}
          onPrevious={() => setMonth((value) => shiftMonth(value, -1))}
          onNext={() => setMonth((value) => shiftMonth(value, 1))}
          onAdd={() => setTransactionModal(true)}
        />

        {loading && !dashboard ? <PageLoader /> : (
          <>
            {activeView === 'dashboard' && <Dashboard data={dashboard} categoriesConfig={categories} onNavigate={setActiveView} onEditSettings={() => setSettingsModal(true)} />}
            {activeView === 'movements' && (
              <Movements transactions={transactions} categories={categories} onEdit={setEditingTransaction} onDelete={deleteTransaction} onAdd={() => setTransactionModal(true)} onRecurring={async (item) => { try { await api.recurring(item.id, !item.is_recurring); await refresh(); notify('Recurrencia actualizada.'); } catch (error) { notify(error.message, 'error'); } }} />
            )}
            {activeView === 'planning' && <Planning data={dashboard} month={month} notify={notify} />}
            {activeView === 'database' && <DatabaseManager notify={notify} onChanged={refresh} />}
            {activeView === 'users' && <UsersManager user={user} onLogout={onLogout} notify={notify} />}
            {activeView === 'reports' && <Reports key={month} month={month} notify={notify} categoriesConfig={categories} onManageCategories={() => setCategoriesModal(true)} />}
            {activeView === 'import' && (
              <ImportStatement imports={imports} onImport={importStatement} onDelete={deleteImport} notify={notify} />
            )}
          </>
        )}
      </main>

      <MobileNav activeView={activeView} onNavigate={setActiveView} />
      {transactionModal && <TransactionModal month={month} categories={categories} account={dashboard?.account} onManageCategories={() => setCategoriesModal(true)} onClose={() => setTransactionModal(false)} onSave={addTransaction} />}
      {editingTransaction && <EditTransactionModal item={editingTransaction} categories={categories} onClose={() => setEditingTransaction(null)} onSave={async (values) => { try { await api.updateTransaction(editingTransaction.id, values); setEditingTransaction(null); await refresh(); notify('Movimiento actualizado.'); } catch (error) { notify(error.message, 'error'); } }} />}
      {categoriesModal && <CategoriesModal categories={categories} notify={notify} onChanged={refresh} onClose={() => setCategoriesModal(false)} />}
      {settingsModal && <AccountSettingsModal account={dashboard?.account} notify={notify} onSaved={refresh} onClose={() => setSettingsModal(false)} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function Sidebar({ activeView, onNavigate }) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate('dashboard')} aria-label="Ir al inicio">
        <span className="brand-mark"><span /><span /><span /></span>
        <span>saldo</span>
      </button>
      <nav className="desktop-nav" aria-label="Navegación principal">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeView === id ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate(id)}>
            <Icon size={19} strokeWidth={1.9} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <ShieldCheck size={20} />
        <p>Tus datos quedan en tu propia base local.</p>
      </div>
    </aside>
  );
}

function MobileNav({ activeView, onNavigate }) {
  return (
    <nav className="mobile-nav" aria-label="Navegación móvil">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button key={id} className={activeView === id ? 'active' : ''} onClick={() => onNavigate(id)}>
          <Icon size={20} /><span>{label === 'Importar resumen' ? 'Importar' : label}</span>
        </button>
      ))}
    </nav>
  );
}

function Topbar({ month, onPrevious, onNext, onAdd }) {
  return (
    <header className="topbar">
      <div className="month-control">
        <button className="icon-button" onClick={onPrevious} aria-label="Mes anterior"><ArrowLeft size={18} /></button>
        <div>
          <span>Período</span>
          <strong>{monthLabel(month)}</strong>
        </div>
        <button className="icon-button" onClick={onNext} aria-label="Mes siguiente"><ArrowRight size={18} /></button>
      </div>
      <button className="primary-button" onClick={onAdd}><Plus size={18} />Nuevo movimiento</button>
    </header>
  );
}

function Dashboard({ data, categoriesConfig, onNavigate, onEditSettings }) {
  if (!data) return null;
  const nextMonth = data.forecast[1] || data.forecast[0];
  const account = data.account || { accountBalanceArs: data.availableArs, overdraftLimitArs: 0, overdraftUsedArs: 0, overdraftRemainingArs: 0 };
  return (
    <div className="page page-dashboard">
      <section className="balance-grid">
        <div className="balance-panel">
          <div className="balance-heading">
            <span>Saldo de cuenta</span>
            <WalletCards size={25} />
          </div>
          <div className={account.accountBalanceArs < 0 ? 'balance-value negative' : 'balance-value'}>{money(account.accountBalanceArs)}</div>
          <p>{account.isOverdraft ? 'Estás usando el descubierto. Los próximos ingresos reducirán este saldo.' : 'Saldo acumulado al cierre del período seleccionado.'}</p>
          <div className="balance-breakdown">
            <div><ArrowDownLeft size={18} /><span>Ingresos</span><strong>{money(data.incomeArs)}</strong></div>
            <div><ArrowUpRight size={18} /><span>Egresos</span><strong>{money(data.expenseArs)}</strong></div>
          </div>
        </div>
        <div className="next-panel">
          <div className="section-title compact">
            <div><span>Próximo compromiso</span><h2>{monthLabel(nextMonth.month, 'long')}</h2></div>
            <CalendarDays size={24} />
          </div>
          <div className="commitment-amount">{money(nextMonth.installmentArs)}</div>
          <p>{nextMonth.installmentCount ? `${nextMonth.installmentCount} cuotas ya previstas` : 'No hay cuotas previstas todavía'}</p>
          {nextMonth.installmentUsd > 0 && <div className="usd-note">más {money(nextMonth.installmentUsd, 'USD')}</div>}
          <button className="text-button" onClick={() => onNavigate('planning')}>Ver planificación <ChevronRight size={17} /></button>
        </div>
      </section>

      <OverdraftBar account={account} onEdit={onEditSettings} />

      <section className="content-grid">
        <CategoryBreakdown categories={data.categories} categoriesConfig={categoriesConfig} />
        <ForecastStrip forecast={data.forecast} />
      </section>

      <section className="recent-section">
        <div className="section-title">
          <div><h2>Últimos movimientos</h2><p>Lo que cambió tu saldo en este período.</p></div>
          <button className="text-button" onClick={() => onNavigate('movements')}>Ver todos <ChevronRight size={17} /></button>
        </div>
        <TransactionRows rows={data.recent} />
      </section>
    </div>
  );
}

function OverdraftBar({ account, onEdit }) {
  const limit = account.overdraftLimitArs || 0;
  const used = account.overdraftUsedArs || 0;
  const percentage = limit ? Math.min((used / limit) * 100, 100) : 0;
  const state = account.isOverLimit ? 'over-limit' : account.isOverdraft ? 'in-use' : 'available';
  return (
    <section className={`overdraft-bar ${state}`}>
      <div className="overdraft-copy">
        <span className="overdraft-icon">{account.isOverdraft ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}</span>
        <div><strong>Descubierto bancario</strong><p>{account.isOverLimit ? `Excediste el límite por ${money(used - limit)}.` : account.isOverdraft ? `Estás usando ${money(used)} de ${money(limit)}.` : `Tenés ${money(limit)} disponibles si el saldo llega a cero.`}</p></div>
      </div>
      <div className="overdraft-meter"><span><i style={{ width: `${percentage}%` }} /></span><small>{account.isOverdraft ? `${money(account.overdraftRemainingArs)} restantes` : `Capacidad total ${money(account.spendingCapacityArs)}`}</small></div>
      <button className="icon-button" onClick={onEdit} aria-label="Configurar saldo y descubierto"><Settings2 size={18} /></button>
    </section>
  );
}

function CategoryBreakdown({ categories, categoriesConfig = [] }) {
  const total = categories.reduce((sum, item) => sum + item.amount, 0);
  const top = categories.slice(0, 5);
  const colorFor = (name, index) => categoriesConfig.find((item) => item.name === name)?.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length];
  return (
    <section className="category-section">
      <div className="section-title"><div><h2>En qué se fue</h2><p>Distribución de egresos en pesos.</p></div></div>
      {top.length ? (
        <>
          <div className="category-ribbon" aria-label="Distribución por categoría">
            {top.map((item, index) => (
              <span key={item.category} style={{ width: `${Math.max((item.amount / total) * 100, 3)}%`, background: colorFor(item.category, index) }} />
            ))}
          </div>
          <div className="category-list">
            {top.map((item, index) => (
              <div key={item.category}>
                <span className="category-dot" style={{ background: colorFor(item.category, index) }} />
                <span>{item.category}</span>
                <strong>{money(item.amount)}</strong>
                <small>{Math.round((item.amount / total) * 100)}%</small>
              </div>
            ))}
          </div>
        </>
      ) : <EmptyState compact icon={Gauge} text="Todavía no hay egresos para analizar." />}
    </section>
  );
}

function ForecastStrip({ forecast }) {
  const max = Math.max(...forecast.map((item) => item.committedArs), 1);
  return (
    <section className="forecast-section">
      <div className="section-title"><div><h2>Lo que viene</h2><p>Egresos cargados y cuotas proyectadas.</p></div></div>
      <div className="mini-chart" role="img" aria-label="Compromisos de los próximos seis meses">
        {forecast.map((item, index) => (
          <div className="mini-column" key={item.month}>
            <span className="mini-value">{item.committedArs ? money(item.committedArs).replace('$', '$ ') : '—'}</span>
            <div className="mini-track"><span style={{ height: `${Math.max((item.committedArs / max) * 100, item.committedArs ? 7 : 0)}%` }} /></div>
            <small className={index === 0 ? 'current' : ''}>{monthLabel(item.month, 'short').split(' ')[0]}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function Movements({ transactions, categories, onEdit, onDelete, onAdd, onRecurring }) {
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const shown = transactions.filter((item) => (filter === 'all' || item.type === filter) && (category === 'all' || item.category === category));
  return (
    <div className="page">
      <PageHeading title="Movimientos" description="Ingresos, egresos y consumos importados en un solo lugar." />
      <div className="list-toolbar">
        <div className="segmented">
          {[['all', 'Todos'], ['income', 'Ingresos'], ['expense', 'Egresos']].map(([id, label]) => (
            <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <label className="movement-category-filter">Categoría<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Todas las categorías</option>{[...new Set([...categories.map((item) => item.name), ...transactions.map((item) => item.category)])].sort((a, b) => a.localeCompare(b, 'es')).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <button className="secondary-button" onClick={onAdd}><Plus size={17} />Agregar</button>
      </div>
      <div className="movement-table">
        {shown.length ? shown.map((item) => (
          <MovementRow key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} onRecurring={onRecurring} />
        )) : <EmptyState icon={ReceiptText} text="No hay movimientos para los filtros seleccionados." action="Agregar movimiento" onAction={onAdd} />}
      </div>
    </div>
  );
}

function TransactionRows({ rows }) {
  if (!rows.length) return <EmptyState compact icon={ReceiptText} text="Cargá un ingreso o importá un resumen para empezar." />;
  return <div className="recent-list">{rows.map((item) => <MovementRow item={item} key={item.id} />)}</div>;
}

function MovementRow({ item, onEdit, onDelete, onRecurring }) {
  const isIncome = item.type === 'income';
  return (
    <div className="movement-row">
      <div className={isIncome ? 'movement-icon income' : 'movement-icon expense'}>
        {isIncome ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
      </div>
      <div className="movement-copy">
        <strong>{item.description}</strong>
        <span>{item.category} · {shortDate(item.transaction_date)}{item.source === 'visa' ? ` · Visa ${item.card_last4 || ''}` : ''}{item.is_recurring ? ' · Recurrente' : ''}</span>
      </div>
      {item.installment_current && <span className="installment-badge">{item.installment_current} de {item.installment_total}</span>}
      <div className={isIncome ? 'movement-amount income' : 'movement-amount'}>
        <strong>{isIncome ? '+' : '−'} {money(item.amount, item.currency)}</strong>
        <span>{item.source === 'visa' ? 'Resumen' : 'Manual'}</span>
      </div>
      {(onEdit || onDelete || onRecurring) && <div className="movement-actions">
        {onEdit && <button className="row-action" onClick={() => onEdit(item)} title="Editar movimiento" aria-label={`Editar ${item.description}`}><Pencil size={17} /></button>}
        {onRecurring && !(item.installment_total > 1) && <button className="row-action" onClick={() => onRecurring(item)} title={item.is_recurring ? 'Quitar recurrencia' : 'Marcar recurrente'} aria-label={item.is_recurring ? 'Quitar recurrencia' : 'Marcar recurrente'}><RefreshCw size={17} color={item.is_recurring ? '#2769d2' : undefined} /></button>}
        {onDelete && item.source === 'manual' && <button className="row-action" onClick={() => onDelete(item.id, item)} aria-label={item.installment_total > 1 ? `Eliminar plan ${item.description}` : `Eliminar ${item.description}`}><Trash2 size={17} /></button>}
      </div>}
    </div>
  );
}

function Planning({ data, month, notify }) {
  const [projection, setProjection] = useState(null);
  const [plans, setPlans] = useState([]);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('0');
  const [monthly, setMonthly] = useState('');
  const load = useCallback(async () => { try { const [p, s] = await Promise.all([api.projection(month), api.savings()]); setProjection(p); setPlans(s); } catch (error) { notify(error.message, 'error'); } }, [month, notify]);
  useEffect(() => { load(); }, [load]);
  const addPlan = async (event) => { event.preventDefault(); try { await api.addSavings({ name, target, saved, monthly }); setName(''); setTarget(''); setSaved('0'); setMonthly(''); await load(); notify('Plan de ahorro creado.'); } catch (error) { notify(error.message, 'error'); } };
  if (!data) return null;
  const max = Math.max(...data.forecast.map((item) => item.committedArs), 1);
  const total = data.forecast.slice(1).reduce((sum, item) => sum + item.installmentArs, 0);
  return (
    <div className="page">
      <PageHeading title="Planificación" description="Una vista anticipada de las cuotas y movimientos que ya conocés." />
      {projection && <section className="projection-panel">
        <div className="section-title"><div><h2>Estimación para {monthLabel(projection.month)}</h2><p>Partiendo del saldo al cierre de {monthLabel(month)}.</p></div></div>
        <div className="projection-grid">
          <div><span>Saldo inicial estimado</span><strong>{money(projection.startBalance)}</strong></div>
          <div><span>Ingresos previstos</span><strong>+ {money(projection.income + projection.recurringIncome)}</strong><small>Recurrentes: {money(projection.recurringIncome)}</small></div>
          <div><span>Gastos previstos</span><strong>− {money(projection.expense + projection.recurringExpense)}</strong><small>Recurrentes: {money(projection.recurringExpense)}</small></div>
          <div><span>Aporte a ahorro</span><strong>− {money(projection.savings)}</strong></div>
          <div className="projection-result"><span>Saldo estimado</span><strong>{money(projection.endBalance)}</strong><small>{projection.endBalance < 0 ? `Descubierto estimado: ${money(-projection.endBalance)}${-projection.endBalance > projection.overdraftLimit ? ' · supera el límite' : ''}` : 'Sin uso del descubierto'}</small></div>
        </div>
        <p className="projection-note">Las recurrencias se estiman todos los meses desde el siguiente al movimiento original. Son estimaciones y no crean movimientos reales. Evitá cargar por separado el mismo gasto futuro para no contarlo dos veces. {projection.rate ? `Dólar usado: ${money(projection.rate)}.` : ''}</p>
        {projection.missingRate && <p className="projection-warning">Falta una cotización: los montos en dólares no se incluyen en el saldo estimado.</p>}
        {projection.recurring.length > 0 && <details><summary>Ver movimientos recurrentes ({projection.recurring.length})</summary>{projection.recurring.map((item) => <p key={item.id}>{item.description}: {item.type === 'income' ? '+' : '−'} {money(item.amount, item.currency)}</p>)}</details>}
      </section>}
      <section className="projection-panel savings-panel">
        <div className="section-title"><div><h2>Planes de ahorro</h2><p>El aporte mensual se reserva en la estimación; no genera movimientos bancarios.</p></div></div>
        <form className="savings-form" onSubmit={addPlan}>
          <label>Objetivo<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ej. Vacaciones" /></label>
          <label>Meta en pesos<input type="number" min="0.01" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} required /></label>
          <label>Ya ahorrado<input type="number" min="0" step="0.01" value={saved} onChange={(e) => setSaved(e.target.value)} required /></label>
          <label>Aporte mensual<input type="number" min="0" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} required /></label>
          <button className="primary-button">Crear plan</button>
        </form>
        {plans.map((plan) => <SavingsItem key={plan.id} plan={plan} load={load} notify={notify} />)}
      </section>
      <section className="planning-summary">
        <div><span>Cuotas de los próximos 5 meses</span><strong>{money(total)}</strong><p>No incluye consumos nuevos ni ajustes del banco.</p></div>
        <div className="planning-mark"><Sparkles size={25} /><span>Se actualiza al importar cada resumen</span></div>
      </section>
      <section className="timeline">
        {data.forecast.map((item, index) => (
          <div className="timeline-row" key={item.month}>
            <div className="timeline-date"><span>{monthLabel(item.month, 'short').split(' ')[0]}</span><strong>{item.month.slice(0, 4)}</strong></div>
            <div className="timeline-visual">
              <div className="timeline-track"><span style={{ width: `${Math.max((item.committedArs / max) * 100, item.committedArs ? 4 : 0)}%` }} /></div>
              <div className="timeline-meta">
                <span>{item.installmentCount ? `${item.installmentCount} cuotas` : index === 0 ? 'Mes actual' : 'Sin cuotas'}</span>
                {item.installmentUsd > 0 && <span>{money(item.installmentUsd, 'USD')}</span>}
              </div>
            </div>
            <div className="timeline-amount">
              <strong>{money(item.committedArs)}</strong>
              <span>{item.expenseArs > 0 && item.installmentArs > 0 ? `${money(item.installmentArs)} en cuotas` : 'comprometido'}</span>
            </div>
          </div>
        ))}
      </section>
      <div className="info-note"><CircleDollarSign size={21} /><p>Las cuotas se proyectan con el mismo importe del resumen importado. El banco puede aplicar diferencias, impuestos o redondeos.</p></div>
    </div>
  );
}

function SavingsItem({ plan, load, notify }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({ name: plan.name, target: plan.target_cents / 100, saved: plan.saved_cents / 100, monthly: plan.monthly_cents / 100 });
  const remaining = Math.max(0, plan.target_cents - plan.saved_cents);
  const months = plan.monthly_cents ? Math.ceil(remaining / plan.monthly_cents) : null;
  const change = (key) => (event) => setValues((old) => ({ ...old, [key]: event.target.value }));
  return <div className="savings-item"><div><strong>{plan.name}</strong><p>{money(plan.saved_cents / 100)} de {money(plan.target_cents / 100)} · {money(plan.monthly_cents / 100)} por mes · {remaining === 0 ? 'Meta alcanzada' : months ? `${months} meses estimados` : 'Sin aporte mensual'}</p><progress max={plan.target_cents} value={Math.min(plan.saved_cents, plan.target_cents)} />
    {editing && <form className="savings-form" onSubmit={async (event) => { event.preventDefault(); try { await api.updateSavings(plan.id, values); setEditing(false); await load(); notify('Plan actualizado.'); } catch (error) { notify(error.message, 'error'); } }}><label>Objetivo<input value={values.name} onChange={change('name')} required /></label><label>Meta<input type="number" min="0.01" step="0.01" value={values.target} onChange={change('target')} required /></label><label>Ya ahorrado<input type="number" min="0" step="0.01" value={values.saved} onChange={change('saved')} required /></label><label>Aporte mensual<input type="number" min="0" step="0.01" value={values.monthly} onChange={change('monthly')} required /></label><button className="primary-button">Guardar</button></form>}</div>
    <button className="secondary-button" onClick={() => { setValues({ name: plan.name, target: plan.target_cents / 100, saved: plan.saved_cents / 100, monthly: plan.monthly_cents / 100 }); setEditing(!editing); }}>{editing ? 'Cancelar' : 'Editar'}</button><button className="row-action" aria-label={`Eliminar ${plan.name}`} onClick={async () => { if (!window.confirm(`¿Eliminar el plan “${plan.name}”?`)) return; try { await api.deleteSavings(plan.id); await load(); } catch (error) { notify(error.message, 'error'); } }}><Trash2 size={17} /></button></div>;
}

function Reports({ month, notify, categoriesConfig = [], onManageCategories }) {
  const bounds = monthBounds(month);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [rate, setRate] = useState(null);
  const [report, setReport] = useState(null);
  const [view, setView] = useState('consolidated');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshingRate, setRefreshingRate] = useState(false);
  const [editingRate, setEditingRate] = useState(false);
  const [manualRate, setManualRate] = useState('');
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));

  const loadReport = useCallback(async (selectedRate = rate) => {
    const data = await api.categoryReport(from, to, selectedRate?.rate);
    setReport(data);
    return data;
  }, [from, to, rate]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const currentRate = await api.exchangeRate(true);
        if (!active) return;
        setRate(currentRate);
        setManualRate(currentRate.rate || '');
        await loadReport(currentRate);
      } catch (error) {
        if (active) notify(error.message, 'error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []); // The report is re-mounted when the selected month changes.

  const applyDates = async () => {
    setLoading(true);
    try { await loadReport(); } catch (error) { notify(error.message, 'error'); } finally { setLoading(false); }
  };

  const refreshRate = async () => {
    setRefreshingRate(true);
    try {
      const currentRate = await api.refreshExchangeRate();
      setRate(currentRate);
      setManualRate(currentRate.rate);
      await loadReport(currentRate);
      notify('Cotización actualizada desde Dólar Hoy.');
    } catch (error) {
      notify(`${error.message} Podés cargar el valor manualmente.`, 'error');
    } finally {
      setRefreshingRate(false);
    }
  };

  const saveManualRate = async (event) => {
    event.preventDefault();
    try {
      const currentRate = await api.saveExchangeRate({ rate: Number(manualRate), date: manualDate });
      setRate(currentRate);
      await loadReport(currentRate);
      setEditingRate(false);
      notify('Cotización manual guardada.');
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const filteredDetails = useMemo(() => {
    if (!report) return [];
    return category === 'all' ? report.details : report.details.filter((item) => item.category === category);
  }, [report, category]);

  const maxCategory = Math.max(...(report?.categories || []).map((item) => item.consolidatedArs), 1);
  const colorFor = (name, index) => categoriesConfig.find((item) => item.name === name)?.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length];

  return (
    <div className="page">
      <PageHeading title="Reportes por categoría" description="Compará el gasto original y su equivalente consolidado en pesos." />

      <div className="report-toolbar">
        <div className="date-range">
          <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button className="secondary-button" onClick={applyDates} disabled={loading}>Actualizar reporte</button>
        </div>
        <div className="report-toolbar-actions">
          <button className="secondary-button manage-categories-button" onClick={onManageCategories}><Tags size={17} />Categorías</button>
          <div className="segmented report-tabs">
            <button className={view === 'consolidated' ? 'active' : ''} onClick={() => setView('consolidated')}>Consolidado</button>
            <button className={view === 'detail' ? 'active' : ''} onClick={() => setView('detail')}>Detalle</button>
          </div>
        </div>
      </div>

      <section className="report-summary-grid">
        <div className="report-total">
          <div><span>Gasto consolidado</span><TrendingUp size={23} /></div>
          <strong>{money(report?.totals.consolidatedArs || 0)}</strong>
          <p>{report?.totals.count || 0} movimientos entre el {shortDate(from)} y el {shortDate(to)}</p>
          <div className="currency-breakdown">
            <span><b>{money(report?.totals.arsAmount || 0)}</b> en pesos</span>
            <span><b>{money(report?.totals.usdAmount || 0, 'USD')}</b> en dólares</span>
          </div>
        </div>
        <div className="rate-panel">
          <div className="rate-heading">
            <div><span>Dólar blue</span><h2>Venta</h2></div>
            <span className={rate?.stale ? 'rate-status stale' : 'rate-status'}>{rate?.source === 'manual' ? 'Manual' : rate?.stale ? 'Anterior' : 'Actualizado'}</span>
          </div>
          <div className="rate-value">{rate?.rate ? money(rate.rate) : 'Sin cotización'}</div>
          <p>{rate?.date ? `${fullDate(rate.date)} · ${rate.source === 'manual' ? 'Carga manual' : 'Dólar Hoy'}` : 'Cargá un valor para convertir los consumos en USD.'}</p>
          {rate?.warning && <div className="rate-warning">{rate.warning}</div>}
          <div className="rate-actions">
            <button className="text-button" onClick={refreshRate} disabled={refreshingRate}>
              <RefreshCw className={refreshingRate ? 'spin' : ''} size={16} />Actualizar ahora
            </button>
            <button className="text-button muted" onClick={() => setEditingRate((value) => !value)}><Pencil size={15} />Carga manual</button>
            <a href={rate?.sourceUrl || 'https://dolarhoy.com/historico-dolar-blue'} target="_blank" rel="noreferrer" aria-label="Abrir fuente Dólar Hoy"><ExternalLink size={15} /></a>
          </div>
          {editingRate && (
            <form className="manual-rate-form" onSubmit={saveManualRate}>
              <label>Venta<input type="number" min="0.01" step="0.01" value={manualRate} onChange={(event) => setManualRate(event.target.value)} required /></label>
              <label>Fecha<input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} required /></label>
              <button className="primary-button">Guardar</button>
            </form>
          )}
        </div>
      </section>

      {loading ? <PageLoader /> : view === 'consolidated' ? (
        <section className="report-table-section">
          <div className="section-title"><div><h2>Consolidado por categoría</h2><p>Los dólares se convierten a {rate?.rate ? money(rate.rate) : 'la cotización cargada'}.</p></div></div>
          {report?.categories.length ? (
            <div className="report-table">
              <div className="report-table-head"><span>Categoría</span><span>Movimientos</span><span>Pesos</span><span>Dólares</span><span>Consolidado</span></div>
              {report.categories.map((item, index) => (
                <button className="report-category-row" key={item.category} onClick={() => { setCategory(item.category); setView('detail'); }}>
                  <div className="report-category-name">
                    <span className="category-dot" style={{ background: colorFor(item.category, index) }} />
                    <div><strong>{item.category}</strong><small>{item.count} mov. · {money(item.arsAmount)} · {money(item.usdAmount, 'USD')}</small><span className="category-bar"><i style={{ width: `${Math.max((item.consolidatedArs / maxCategory) * 100, 2)}%` }} /></span></div>
                  </div>
                  <span>{item.count}</span>
                  <span>{money(item.arsAmount)}</span>
                  <span>{money(item.usdAmount, 'USD')}</span>
                  <strong>{money(item.consolidatedArs)}</strong>
                </button>
              ))}
            </div>
          ) : <EmptyState compact icon={ChartNoAxesColumnIncreasing} text="No hay egresos en el rango elegido." />}
        </section>
      ) : (
        <section className="report-detail-section">
          <div className="section-title report-detail-heading">
            <div><h2>Detalle de movimientos</h2><p>Importe original y equivalente en pesos.</p></div>
            <label>Categoria<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Todas</option>{report?.categories.map((item) => <option key={item.category}>{item.category}</option>)}</select></label>
          </div>
          {filteredDetails.length ? <div className="report-detail-list">{filteredDetails.map((item) => <ReportDetailRow key={item.id} item={item} rate={report.rate} />)}</div>
            : <EmptyState compact icon={ReceiptText} text="No hay movimientos para esta categoría." />}
        </section>
      )}
    </div>
  );
}

function ReportDetailRow({ item, rate }) {
  const isRefund = item.type === 'income';
  return (
    <div className="report-detail-row">
      <div className={isRefund ? 'movement-icon income' : 'movement-icon expense'}>{isRefund ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</div>
      <div><strong>{item.description}</strong><span>{item.category} · {shortDate(item.transaction_date)}{item.source === 'visa' ? ` · Visa ${item.card_last4 || ''}` : ''}</span></div>
      <span className="detail-original">{isRefund ? '−' : ''}{money(item.amount, item.currency)}</span>
      <div className="detail-converted"><strong>{money(item.convertedArs)}</strong><span>{item.currency === 'USD' ? `a ${money(rate)}` : 'importe en pesos'}</span></div>
    </div>
  );
}

function ImportStatement({ imports, onImport, onDelete, notify }) {
  const [dragging, setDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [selectedCards, setSelectedCards] = useState([]);

  const processFile = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') return notify('El archivo debe ser un PDF.', 'error');
    setAnalyzing(true);
    setResult(null);
    try {
      const data = await api.previewStatement(file);
      setPreview(data);
      setPendingFile(file);
      setSelectedCards(data.cards.map((card) => card.last4));
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmImport = async () => {
    if (!pendingFile || !preview) return;
    setImporting(true);
    try {
      const imported = await onImport(pendingFile, selectedCards);
      setResult(imported);
      setPreview(null);
      setPendingFile(null);
      setSelectedCards([]);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const toggleCard = (last4) => setSelectedCards((current) => current.includes(last4)
    ? current.filter((value) => value !== last4)
    : [...current, last4]);

  const selectedSummary = useMemo(() => {
    if (!preview) return null;
    return preview.cards.filter((card) => selectedCards.includes(card.last4)).reduce((summary, card) => ({
      transactionCount: summary.transactionCount + card.transactionCount,
      totalArs: summary.totalArs + card.totalArs,
      totalUsd: summary.totalUsd + card.totalUsd,
    }), { ...preview.common });
  }, [preview, selectedCards]);

  return (
    <div className="page">
      <PageHeading title="Importar resumen" description="Subí el PDF de Visa y convertí sus cuotas en una planificación mensual." />
      <section className="import-layout">
        <label
          className={dragging ? 'dropzone dragging' : 'dropzone'}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); processFile(event.dataTransfer.files[0]); }}
        >
          <input type="file" accept="application/pdf,.pdf" onChange={(event) => processFile(event.target.files[0])} disabled={analyzing || importing} />
          <span className="drop-icon">{analyzing ? <LoaderCircle className="spin" size={30} /> : <UploadCloud size={30} />}</span>
          <h2>{analyzing ? 'Analizando las tarjetas…' : preview ? 'Elegir otro resumen' : 'Soltá tu resumen Visa acá'}</h2>
          <p>o hacé clic para elegir un PDF de hasta 15 MB</p>
          <small>El archivo se procesa localmente y no se conserva.</small>
        </label>
        <div className="import-explainer">
          <h2>Qué vamos a tomar</h2>
          <ol>
            <li><span><FileText size={18} /></span><div><strong>Elegís las tarjetas</strong><p>Antes de importar podés incluir o excluir cada adicional.</p></div></li>
            <li><span><WalletCards size={18} /></span><div><strong>Compras en cuotas</strong><p>Las cuotas pendientes se distribuyen en los próximos meses.</p></div></li>
            <li><span><Check size={18} /></span><div><strong>Gastos comunes</strong><p>Impuestos y percepciones se incluyen siempre.</p></div></li>
          </ol>
        </div>
      </section>

      {preview && (
        <section className="card-selection">
          <div className="section-title">
            <div><h2>Elegí las tarjetas a importar</h2><p>{preview.filename} · vence {shortDate(preview.dueDate)}</p></div>
            <button className="text-button" onClick={() => setSelectedCards(selectedCards.length === preview.cards.length ? [] : preview.cards.map((card) => card.last4))}>{selectedCards.length === preview.cards.length ? 'Desmarcar todas' : 'Seleccionar todas'}</button>
          </div>
          <div className="card-choice-list">
            {preview.cards.map((card) => {
              const selected = selectedCards.includes(card.last4);
              return (
                <label className={selected ? 'card-choice selected' : 'card-choice'} key={card.last4}>
                  <input type="checkbox" checked={selected} onChange={() => toggleCard(card.last4)} />
                  <span className="visa-chip">VISA</span>
                  <div><strong>{card.holder || `Tarjeta terminada en ${card.last4}`}</strong><span>Terminada en {card.last4} · {card.transactionCount} consumos</span></div>
                  <div className="card-choice-amount"><strong>{money(card.totalArs)}</strong>{card.totalUsd > 0 && <span>{money(card.totalUsd, 'USD')}</span>}</div>
                </label>
              );
            })}
            {preview.common.transactionCount > 0 && (
              <div className="card-choice common selected">
                <span className="common-check"><Check size={17} /></span>
                <span className="common-icon"><ShieldCheck size={19} /></span>
                <div><strong>Gastos comunes</strong><span>Impuestos y percepciones · {preview.common.transactionCount} movimientos · siempre incluidos</span></div>
                <div className="card-choice-amount"><strong>{money(preview.common.totalArs)}</strong>{preview.common.totalUsd > 0 && <span>{money(preview.common.totalUsd, 'USD')}</span>}</div>
              </div>
            )}
          </div>
          <div className="selection-footer">
            <div><span>Total a incorporar</span><strong>{money(selectedSummary?.totalArs || 0)}</strong>{(selectedSummary?.totalUsd || 0) > 0 && <small>más {money(selectedSummary.totalUsd, 'USD')}</small>}</div>
            <p>{selectedSummary?.transactionCount || 0} movimientos · {selectedCards.length} de {preview.cards.length} tarjetas</p>
            <button className="primary-button" onClick={confirmImport} disabled={importing || !(selectedSummary?.transactionCount)}>{importing && <LoaderCircle className="spin" size={18} />}{importing ? 'Importando…' : 'Importar selección'}</button>
          </div>
        </section>
      )}

      {result && (
        <section className="import-result">
          <div className="success-seal"><Check size={22} /></div>
          <div><strong>Resumen incorporado</strong><p>{result.transactionCount} consumos · {result.projectedCount} cuotas futuras · vence {shortDate(result.dueDate)}</p></div>
          <strong>{money(result.totalArs)}</strong>
        </section>
      )}

      <section className="imports-history">
        <div className="section-title"><div><h2>Resúmenes importados</h2><p>Podés quitar uno para corregir o volver a importarlo.</p></div></div>
        {imports.length ? imports.map((item) => (
          <div className="import-row" key={item.id}>
            <span className="file-tile"><FileText size={20} /></span>
            <div><strong>{item.filename}</strong><span>Vence {shortDate(item.due_date)} · {item.transaction_count} consumos</span></div>
            <strong>{money(item.totalArs)}</strong>
            <button className="row-action" onClick={() => onDelete(item.id)} aria-label={`Eliminar ${item.filename}`}><Trash2 size={17} /></button>
          </div>
        )) : <EmptyState compact icon={FileText} text="Todavía no importaste ningún resumen." />}
      </section>
    </div>
  );
}

function EditTransactionModal({ item, categories, onClose, onSave }) {
  const [values, setValues] = useState({ type: item.type, description: item.description, amount: item.amount, currency: item.currency, category: item.category, transactionDate: item.transaction_date, recurring: Boolean(item.is_recurring) });
  const [saving, setSaving] = useState(false);
  const change = (name) => (event) => setValues((old) => ({ ...old, [name]: event.target.value }));
  const submit = async (event) => { event.preventDefault(); setSaving(true); try { await onSave({ ...values, amount: Number(values.amount) }); } finally { setSaving(false); } };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="modal" onSubmit={submit}>
      <div className="modal-header"><div><h2>Editar movimiento</h2><p>{item.source === 'visa' ? 'Movimiento importado de Visa.' : 'Movimiento manual.'}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button></div>
      <label>Tipo<select value={values.type} onChange={change('type')}><option value="expense">Egreso</option><option value="income">Ingreso</option></select></label>
      <label>Descripción<input autoFocus value={values.description} onChange={change('description')} required /></label>
      <div className="form-row amount-row"><label>Monto<input type="number" min="0.01" step="0.01" value={values.amount} onChange={change('amount')} required /></label><label>Moneda<select value={values.currency} onChange={change('currency')}><option>ARS</option><option>USD</option></select></label></div>
      <div className="form-row"><label>Categoría<select value={values.category} onChange={change('category')} required>{!categories.some((category) => category.name === values.category) && <option value={values.category}>{values.category} (ya no existe)</option>}{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label><label>Fecha<input type="date" value={values.transactionDate} onChange={change('transactionDate')} required /></label></div>
      {!(item.installment_total > 1) && <label className="check-row recurring-check"><input type="checkbox" checked={values.recurring} onChange={(event) => setValues((old) => ({ ...old, recurring: event.target.checked }))} /><span><strong>Repetir como estimación mensual</strong><small>Se incluye desde el mes siguiente, sin crear movimientos automáticamente.</small></span></label>}
      {item.installment_total > 1 && <p className="modal-footnote edit-installment-note">Los cambios se aplican sólo a esta cuota. Las demás cuotas y proyecciones conservan sus valores.</p>}
      {values.recurring && <p className="modal-footnote edit-installment-note">Los valores modificados se usarán en las próximas estimaciones recurrentes.</p>}
      <button className="primary-button wide" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
    </form>
  </div>;
}

function TransactionModal({ month, categories = [], account, onManageCategories, onClose, onSave }) {
  const [type, setType] = useState('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('ARS');
  const [category, setCategory] = useState('Otros');
  const [installments, setInstallments] = useState(1);
  const [recurring, setRecurring] = useState(false);
  const [date, setDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return today.startsWith(month) ? today : `${month}-01`;
  });
  const [saving, setSaving] = useState(false);
  const numericAmount = Number(amount) || 0;
  const previewBalance = (account?.accountBalanceArs || 0) - (type === 'expense' && currency === 'ARS' ? numericAmount : 0);
  const previewUsed = Math.max(0, -previewBalance);
  const previewLimit = account?.overdraftLimitArs || 0;
  const usesOverdraft = type === 'expense' && currency === 'ARS' && numericAmount > 0 && previewBalance < 0;

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    await onSave({ type, description, amount: Number(amount), currency, category, transactionDate: date, installments, recurring: installments === 1 && recurring });
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-header"><div><h2>Nuevo movimiento</h2><p>Agregá un ingreso o egreso manual.</p></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></div>
        <div className="type-switch">
          <button type="button" className={type === 'expense' ? 'active expense' : ''} onClick={() => setType('expense')}><ArrowUpRight size={18} />Egreso</button>
          <button type="button" className={type === 'income' ? 'active income' : ''} onClick={() => setType('income')}><ArrowDownLeft size={18} />Ingreso</button>
        </div>
        <label>Descripción<input autoFocus value={description} onChange={(event) => setDescription(event.target.value)} placeholder={type === 'income' ? 'Ej. Sueldo' : installments > 1 ? 'Ej. Préstamo personal' : 'Ej. Alquiler'} required /></label>
        <div className="form-row amount-row">
          <label>{installments > 1 ? 'Monto de cada cuota' : 'Monto'}<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" required /></label>
          <label>Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>ARS</option><option>USD</option></select></label>
        </div>
        <div className="form-row">
          <label>Categoría<div className="select-with-action"><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item.id}>{item.name}</option>)}</select><button type="button" className="icon-button" onClick={onManageCategories} aria-label="Administrar categorías"><Tags size={17} /></button></div></label>
          <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        </div>
        <div className="installment-control">
          <label className="check-row"><input type="checkbox" checked={installments > 1} onChange={(event) => setInstallments(event.target.checked ? 2 : 1)} /><span><strong>Movimiento en cuotas</strong><small>Se crea un movimiento por mes desde la fecha elegida.</small></span></label>
          {installments > 1 && <label className="installment-count">Cantidad de cuotas<input type="number" min="2" max="120" step="1" value={installments} onChange={(event) => setInstallments(Number(event.target.value))} required /></label>}
          {installments > 1 && numericAmount > 0 && <div className="installment-total"><span>Total del plan</span><strong>{installments} × {money(numericAmount, currency)} = {money(installments * numericAmount, currency)}</strong></div>}
        </div>
        {installments === 1 && <label className="check-row recurring-check"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /><span><strong>Repetir como estimación mensual</strong><small>Se incluye desde el mes siguiente, sin crear movimientos automáticamente.</small></span></label>}
        {usesOverdraft && (
          <div className={previewUsed > previewLimit ? 'overdraft-preview over-limit' : 'overdraft-preview'}>
            <AlertTriangle size={19} />
            <div><strong>{previewUsed > previewLimit ? 'Supera el descubierto disponible' : 'Este movimiento usa el descubierto'}</strong><p>{previewUsed > previewLimit ? `Excedería el límite por ${money(previewUsed - previewLimit)}.` : `Quedarías usando ${money(previewUsed)} y te restarían ${money(Math.max(0, previewLimit - previewUsed))}.`}</p></div>
          </div>
        )}
        <button className="primary-button wide" disabled={saving}>{saving && <LoaderCircle className="spin" size={18} />}{saving ? 'Guardando…' : 'Guardar movimiento'}</button>
      </form>
    </div>
  );
}

function DatabaseManager({ notify, onChanged }) {
  const [tables, setTables] = useState([]);
  const [table, setTable] = useState('transactions');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState('');
  const load = useCallback(async () => { try { const [names, rows] = await Promise.all([api.databaseTables(), api.databaseRows(table)]); setTables(names); setData(rows); } catch (error) { setData(null); notify(error.message, 'error'); } }, [table, notify]);
  useEffect(() => { load(); }, [load]);
  const mutate = async (fn) => { try { await fn(); setEditing(null); await load(); await onChanged(); notify('Datos actualizados.'); } catch (error) { notify(error.message, 'error'); } };
  const confirmClear = (name) => window.prompt(`Se eliminarán ${name === 'all' ? 'todos los datos' : `los registros de ${name}`}. Los registros relacionados también pueden eliminarse. Escribí ELIMINAR para confirmar:`) === 'ELIMINAR';
  return <div className="page"><PageHeading title="Administrador de base de datos" description="Consultá y modificá los registros locales. Los importes en columnas terminadas en cents están expresados en centavos." />
    <section className="projection-panel"><p>Disponible sólo desde la computadora que ejecuta la aplicación. Se muestran hasta 500 registros. Al eliminar un resumen también se eliminan sus movimientos y cuotas asociadas.</p>
      <div className="database-toolbar"><label>Tabla<select value={table} onChange={(e) => { setTable(e.target.value); setEditing(null); }}>{tables.map((name) => <option key={name}>{name}</option>)}</select></label><button className="secondary-button" onClick={() => confirmClear(table) && mutate(() => api.databaseClear(table))}>Vaciar tabla</button><button className="danger-button" onClick={() => confirmClear('all') && mutate(() => api.databaseClear('all'))}>Vaciar toda la base</button></div>
      <p>La configuración de cuenta y la categoría Otros se restauran con valores iniciales si se eliminan.</p>
      {data && <div className="database-scroll"><table><thead><tr>{data.columns.map((c) => <th key={c.name}>{c.name}</th>)}<th>Acciones</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}>{data.columns.map((c) => <td key={c.name}>{row[c.name] === null ? 'NULL' : String(row[c.name])}</td>)}<td><button className="text-button" onClick={() => { const { id, ...rest } = row; setEditing(id); setValues(JSON.stringify(rest, null, 2)); }}>Editar</button> <button className="text-button" onClick={() => window.confirm(`¿Eliminar el registro ${row.id} de ${table}? También pueden eliminarse registros relacionados.`) && mutate(() => api.databaseDelete(table, row.id))}>Eliminar</button></td></tr>)}</tbody></table>{!data.rows.length && <p>No hay registros.</p>}</div>}
      {editing !== null && <form className="database-editor" onSubmit={(e) => { e.preventDefault(); try { const parsed = JSON.parse(values); mutate(() => api.databaseUpdate(table, editing, parsed)); } catch { notify('El contenido debe ser JSON válido.', 'error'); } }}><h2>Editar registro {editing}</h2><p>Conservá los nombres de los campos; usá null para un valor vacío.</p><textarea rows="12" value={values} onChange={(e) => setValues(e.target.value)} /><div><button className="primary-button">Guardar registro</button> <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button></div></form>}
    </section></div>;
}

function UsersManager({ user, onLogout, notify }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const load = useCallback(async () => { try { setUsers(await api.users()); } catch (error) { notify(error.message, 'error'); } }, [notify]);
  useEffect(() => { load(); }, [load]);
  const add = async (event) => { event.preventDefault(); try { await api.addUser({ username, password }); setUsername(''); setPassword(''); await load(); notify('Usuario creado.'); } catch (error) { notify(error.message, 'error'); } };
  const save = async (event) => { event.preventDefault(); try { await api.updateUser(editing.id, { username: editName, password: editPassword }); if (editing.id === user.id && editPassword) { notify('Contraseña actualizada. Volvé a iniciar sesión.'); onLogout(); return; } setEditing(null); setEditPassword(''); await load(); notify('Usuario actualizado.'); } catch (error) { notify(error.message, 'error'); } };
  return <div className="page"><PageHeading title="Usuarios" description="Administrá quién puede acceder a esta aplicación." /><section className="projection-panel"><div className="section-title"><div><h2>Sesión de {user.username}</h2><p>Todos los usuarios acceden a los mismos datos y pueden administrar usuarios.</p></div><button className="secondary-button logout-button" onClick={async () => { try { await api.logout(); onLogout(); } catch (error) { notify(error.message, 'error'); } }}>Cerrar sesión</button></div>
    <form className="users-form" onSubmit={add}><label>Nuevo usuario<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" pattern="[a-zA-Z0-9_.-]{1,40}" required /></label><label>Contraseña<input type="password" autoComplete="new-password" minLength="8" maxLength="256" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><button className="primary-button">Crear usuario</button></form>
    {users.map((item) => <div className="user-item" key={item.id}><strong>{item.username}{item.id === user.id ? ' (tu usuario)' : ''}</strong><button className="secondary-button user-edit-button" onClick={() => { setEditing(item); setEditName(item.username); setEditPassword(''); }}>Editar</button>{item.id !== user.id && <button className="row-action" aria-label={`Eliminar ${item.username}`} onClick={async () => { if (!window.confirm(`¿Eliminar el usuario ${item.username}?`)) return; try { await api.deleteUser(item.id); await load(); notify('Usuario eliminado.'); } catch (error) { notify(error.message, 'error'); } }}><Trash2 size={17} /></button>}</div>)}
    {editing && <form className="users-form user-edit-form" onSubmit={save}><label>Usuario<input value={editName} onChange={(e) => setEditName(e.target.value)} pattern="[a-zA-Z0-9_.-]{1,40}" required /></label><label>Nueva contraseña (opcional)<input type="password" autoComplete="new-password" minLength="8" maxLength="256" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} /></label><button className="primary-button">Guardar</button><button type="button" className="secondary-button user-edit-button" onClick={() => setEditing(null)}>Cancelar</button></form>}
  </section></div>;
}

function CategoriesModal({ categories, notify, onChanged, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2868d2');
  const [saving, setSaving] = useState(false);

  const addCategory = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.addCategory({ name, color });
      setName('');
      await onChanged();
      notify('Categoría creada.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveCategory = async (item, nextName, nextColor) => {
    try {
      await api.updateCategory(item.id, { name: nextName, color: nextColor });
      await onChanged();
      notify('Categoría actualizada.');
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const deleteCategory = async (item) => {
    if (!window.confirm(`¿Eliminar “${item.name}”? Sus movimientos pasarán a Otros.`)) return;
    try {
      await api.deleteCategory(item.id);
      await onChanged();
      notify('Categoría eliminada; sus movimientos pasaron a Otros.');
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  return (
    <div className="modal-backdrop modal-over" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal categories-modal">
        <div className="modal-header"><div><h2>Categorías</h2><p>Personalizá los nombres y colores de tus reportes.</p></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></div>
        <form className="new-category-form" onSubmit={addCategory}>
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Color de la nueva categoría" />
          <label>Nueva categoría<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Salud" maxLength="40" required /></label>
          <button className="primary-button" disabled={saving}><Plus size={17} />Agregar</button>
        </form>
        <div className="categories-list">
          {categories.map((item) => <CategoryEditor key={item.id} item={item} onSave={saveCategory} onDelete={deleteCategory} />)}
        </div>
        <p className="modal-footnote">Las categorías base conservan su nombre para que las importaciones automáticas sigan clasificando correctamente.</p>
      </div>
    </div>
  );
}

function CategoryEditor({ item, onSave, onDelete }) {
  const [name, setName] = useState(item.name);
  const [color, setColor] = useState(item.color);
  const changed = name.trim() !== item.name || color !== item.color;
  return (
    <div className="category-editor">
      <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label={`Color de ${item.name}`} />
      <div><input value={name} onChange={(event) => setName(event.target.value)} disabled={item.isSystem} maxLength="40" /><small>{item.isSystem ? 'Categoría base' : 'Personalizada'}</small></div>
      {changed && <button className="row-action save" onClick={() => onSave(item, name.trim(), color)} aria-label={`Guardar ${item.name}`}><Check size={17} /></button>}
      {!item.isSystem && <button className="row-action" onClick={() => onDelete(item)} aria-label={`Eliminar ${item.name}`}><Trash2 size={17} /></button>}
    </div>
  );
}

function AccountSettingsModal({ account, notify, onSaved, onClose }) {
  const [openingBalance, setOpeningBalance] = useState(account?.openingBalanceArs || 0);
  const [overdraftLimit, setOverdraftLimit] = useState(account?.overdraftLimitArs ?? 2500000);
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings({ openingBalance: Number(openingBalance), overdraftLimit: Number(overdraftLimit) });
      await onSaved();
      notify('Saldo inicial y descubierto actualizados.');
      onClose();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal settings-modal" onSubmit={submit}>
        <div className="modal-header"><div><h2>Cuenta bancaria</h2><p>Definí el punto de partida y el límite de descubierto.</p></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></div>
        <div className="settings-explainer"><ShieldCheck size={22} /><p>Cuando el saldo es negativo, cada ingreso reduce automáticamente el descubierto utilizado.</p></div>
        <label>Saldo inicial de la cuenta<input type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} required /><small>Usalo para reflejar el saldo previo al primer movimiento cargado.</small></label>
        <label>Límite de descubierto<input type="number" min="0" step="0.01" value={overdraftLimit} onChange={(event) => setOverdraftLimit(event.target.value)} required /></label>
        <button className="primary-button wide" disabled={saving}>{saving && <LoaderCircle className="spin" size={18} />}{saving ? 'Guardando…' : 'Guardar configuración'}</button>
      </form>
    </div>
  );
}

function PageHeading({ title, description }) {
  return <div className="page-heading"><h1>{title}</h1><p>{description}</p></div>;
}

function EmptyState({ icon: Icon, text, compact = false, action, onAction }) {
  return (
    <div className={compact ? 'empty-state compact' : 'empty-state'}>
      <Icon size={24} /><p>{text}</p>{action && <button className="text-button" onClick={onAction}>{action}</button>}
    </div>
  );
}

function Toast({ message, tone, onClose }) {
  return <div className={`toast ${tone}`}><span>{tone === 'success' ? <Check size={18} /> : tone === 'warning' ? <AlertTriangle size={18} /> : <X size={18} />}</span><p>{message}</p><button onClick={onClose}><X size={16} /></button></div>;
}

function PageLoader() {
  return <div className="page-loader"><LoaderCircle className="spin" size={26} /><span>Preparando tus números…</span></div>;
}

export default App;
