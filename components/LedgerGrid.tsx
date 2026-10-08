'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type ValueFormatterParams,
} from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

type View = 'payments' | 'actions' | 'contacts';
type Row = Record<string, unknown>;

const TABS: { id: View; label: string }[] = [
  { id: 'payments', label: '💸 Payments' },
  { id: 'actions', label: '🤖 Agent actions' },
  { id: 'contacts', label: '👥 Contacts' },
];

const theme = themeQuartz.withParams({
  accentColor: '#003087',
  headerBackgroundColor: '#f1f5f9',
  headerTextColor: '#0f172a',
});

const STATUS_STYLES: Record<string, string> = {
  EXECUTED: 'bg-green-100 text-green-800',
  SENT: 'bg-green-100 text-green-800',
  SIMULATED: 'bg-purple-100 text-purple-800',
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  REJECTED: 'bg-slate-200 text-slate-700',
  EXPIRED: 'bg-slate-200 text-slate-700',
  FAILED: 'bg-red-100 text-red-800',
};

function StatusCell(params: ICellRendererParams) {
  const value = String(params.value ?? '');
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        STATUS_STYLES[value] ?? 'bg-slate-100 text-slate-700'
      }`}
    >
      {value}
    </span>
  );
}

const dateFormatter = (p: ValueFormatterParams) =>
  p.value instanceof Date
    ? p.value.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';

const money = (p: ValueFormatterParams) =>
  typeof p.value === 'number' ? `$${p.value.toFixed(2)}` : '';

// Compares only the calendar day, so date filters behave the way people expect.
const dateComparator = (filterDate: Date, cellValue: Date) => {
  if (!(cellValue instanceof Date)) return 0;
  const cell = new Date(cellValue.getFullYear(), cellValue.getMonth(), cellValue.getDate()).getTime();
  const filter = filterDate.getTime();
  return cell < filter ? -1 : cell > filter ? 1 : 0;
};

const dateColumn = (headerName: string): ColDef => ({
  field: 'createdAt',
  headerName,
  valueFormatter: dateFormatter,
  filter: 'agDateColumnFilter',
  filterParams: { comparator: dateComparator },
  sort: 'desc',
  minWidth: 180,
});

const COLUMNS: Record<View, ColDef[]> = {
  payments: [
    dateColumn('Date'),
    { field: 'contactName', headerName: 'Recipient' },
    { field: 'email', headerName: 'Email', minWidth: 200 },
    {
      field: 'amount',
      headerName: 'Amount',
      valueFormatter: money,
      filter: 'agNumberColumnFilter',
      type: 'numericColumn',
    },
    { field: 'status', headerName: 'Status', cellRenderer: StatusCell },
    { field: 'note', headerName: 'Note', minWidth: 180 },
    { field: 'batchId', headerName: 'PayPal batch', minWidth: 180 },
  ],
  actions: [
    dateColumn('Date'),
    { field: 'tool', headerName: 'Action' },
    { field: 'summary', headerName: 'Details', minWidth: 220 },
    { field: 'status', headerName: 'Status', cellRenderer: StatusCell },
    { field: 'decidedBy', headerName: 'Decided by' },
    { field: 'error', headerName: 'Error', minWidth: 200 },
  ],
  contacts: [
    { field: 'name', headerName: 'Name' },
    { field: 'email', headerName: 'Email', minWidth: 200 },
    { field: 'autopay', headerName: 'Autopay', minWidth: 260 },
    {
      field: 'monthSpent',
      headerName: 'Sent this month',
      valueFormatter: money,
      filter: 'agNumberColumnFilter',
      type: 'numericColumn',
    },
    dateColumn('Added'),
  ],
};

const defaultColDef: ColDef = {
  sortable: true,
  filter: true,
  resizable: true,
  floatingFilter: true,
  flex: 1,
  minWidth: 120,
};

type LoadedData = { view: View; rows: Row[]; error: string | null };

export default function LedgerGrid() {
  const gridRef = useRef<AgGridReact>(null);
  const [view, setView] = useState<View>('payments');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<LoadedData | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/ledger?view=${view}`)
      .then(async (res) => {
        if (res.status === 401) {
          window.location.assign('/login');
          return;
        }
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body) {
          setData({ view, rows: [], error: body?.error ?? 'Could not load data.' });
        } else {
          setData({ view, rows: body.rows ?? [], error: null });
        }
      })
      .catch(() => {
        if (!cancelled) setData({ view, rows: [], error: 'Could not reach the server.' });
      });

    return () => {
      cancelled = true;
    };
  }, [view, reloadKey]);

  const loading = !data || data.view !== view;

  const rowData = useMemo(
    () =>
      loading || !data
        ? []
        : data.rows.map((r) => ({
            ...r,
            createdAt: typeof r.createdAt === 'string' ? new Date(r.createdAt) : r.createdAt,
          })),
    [data, loading]
  );

  const columnDefs = useMemo(() => COLUMNS[view], [view]);

  const totalSent = useMemo(
    () =>
      view === 'payments'
        ? rowData.reduce((sum, r) => sum + (typeof r.amount === 'number' ? r.amount : 0), 0)
        : 0,
    [rowData, view]
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setSearch('');
                setView(tab.id);
              }}
              className={`rounded-lg px-3 py-1.5 transition ${
                view === tab.id ? 'bg-white text-[#003087] shadow-sm' : 'text-slate-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this table…"
            className="h-9 w-48 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#009cde] focus:ring-2 focus:ring-[#009cde]/30"
          />
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 transition hover:bg-slate-100"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: `${view}.csv` })}
            disabled={loading || rowData.length === 0}
            className="h-9 rounded-lg bg-[#003087] px-3 text-sm font-semibold text-white transition hover:bg-[#00257a] disabled:opacity-40"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {view === 'payments' && !loading && rowData.length > 0 && (
        <div className="mt-3 text-sm text-slate-600">
          {rowData.length} payment{rowData.length === 1 ? '' : 's'} ·{' '}
          <span className="font-semibold text-slate-900">${totalSent.toFixed(2)}</span> in total
        </div>
      )}

      <div className="mt-3 h-[480px] w-full">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Loading…
          </div>
        ) : data?.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-red-700">
            {data.error}
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-full border border-red-300 px-3 py-1 text-xs hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        ) : (
          <AgGridReact
            ref={gridRef}
            theme={theme}
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            quickFilterText={search}
            pagination
            paginationPageSize={10}
            paginationPageSizeSelector={[10, 25, 50]}
          />
        )}
      </div>
    </section>
  );
}