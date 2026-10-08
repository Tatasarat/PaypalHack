'use client';

import type { AuthStatus } from '@/hooks/useUser';

export default function Splash({ status }: { status: AuthStatus }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 text-slate-600">
      {status === 'error' ? (
        <div className="text-center">
          <div className="text-sm font-medium">Could not reach the server.</div>
          <div className="mt-1 text-xs text-slate-500">Check that the app and the database are running.</div>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 rounded-full border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#003087]" />
          <div className="text-sm">Loading…</div>
        </div>
      )}
    </div>
  );
}