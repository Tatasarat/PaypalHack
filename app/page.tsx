'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ActionCard, {
  AutoCard,
  type ActionState,
  type AutoAction,
  type PendingAction,
} from '@/components/ActionCard';
import Splash from '@/components/Splash';
import { useRequireUser } from '@/hooks/useUser';
import { speak, stopSpeaking, useVoiceInput } from '@/hooks/useVoice';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
  pending?: PendingAction[];
  auto?: AutoAction[];
};

const SUGGESTIONS = [
  'Create an invoice for 20 USD to test@example.com for logo design',
  'Send 5 dollars to Ravi for the website work',
  'List my invoices',
];

function formatResult(result: unknown): string {
  let text: string;
  if (typeof result === 'string') {
    try {
      text = JSON.stringify(JSON.parse(result), null, 2);
    } catch {
      text = result;
    }
  } else {
    text = JSON.stringify(result, null, 2) ?? String(result);
  }
  return text.length > 1500 ? text.slice(0, 1500) + '\n...(truncated)' : text;
}

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        pre: ({ children }) => (
          <pre className="mb-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {children}
          </pre>
        ),
        code: ({ className, children }) =>
          className ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="rounded bg-slate-200 px-1 py-0.5 text-[0.85em] text-slate-800">
              {children}
            </code>
          ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export default function Home() {
  const { user, status, logout } = useRequireUser();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [readAloud, setReadAloud] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { listening, interim, error: voiceError, start, stop } = useVoiceInput((text) => {
    void send(text);
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function addAssistant(content: string) {
    setMessages((m) => [...m, { role: 'assistant', content }]);
  }

  async function send(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || loading) return;

    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (res.status === 401) {
        window.location.assign('/login');
        return;
      }
      const data = await res.json();
      const pending: PendingAction[] = data.pendingActions ?? [];
      const auto: AutoAction[] = data.autoExecuted ?? [];
      const content =
        data.response ||
        (pending.length > 0
          ? 'I prepared the action below. It will only run after you approve it.'
          : auto.length > 0
            ? 'Done. Details below.'
            : `Error: ${data.error ?? 'Something went wrong'}`);

      setMessages((m) => [
        ...m,
        { role: 'assistant', content, tools: data.toolsUsed, pending, auto },
      ]);
      if (readAloud) speak(content);
    } catch {
      addAssistant('Error: could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  async function decide(action: PendingAction, decision: 'approve' | 'reject') {
    setActionStates((s) => ({ ...s, [action.id]: 'working' }));

    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: action.id, decision }),
      });
      if (res.status === 401) {
        window.location.assign('/login');
        return;
      }
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setActionStates((s) => ({ ...s, [action.id]: 'failed' }));
        addAssistant(`⚠️ Could not complete **${action.toolName}**: ${data.error ?? 'unknown error'}`);
        return;
      }

      if (data.status === 'rejected') {
        setActionStates((s) => ({ ...s, [action.id]: 'rejected' }));
        addAssistant(`❌ You rejected **${action.toolName}**. Nothing was sent to PayPal.`);
      } else {
        setActionStates((s) => ({ ...s, [action.id]: 'approved' }));
        addAssistant(
          `✅ Approved and executed **${action.toolName}**.\n\n\`\`\`json\n${formatResult(data.result)}\n\`\`\``
        );
      }
    } catch {
      setActionStates((s) => ({ ...s, [action.id]: 'failed' }));
      addAssistant(`⚠️ Could not reach the server for **${action.toolName}**.`);
    }
  }

  if (status !== 'ready') return <Splash status={status} />;

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#003087] to-[#009cde] text-lg font-bold text-white">
            P
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Smart Payments Agent</div>
            <div className="text-xs text-slate-500">Powered by PayPal Agent Toolkit</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/contacts"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          >
            👥 Contacts &amp; autopay
          </Link>
          <Link
            href="/activity"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          >
            📋 Activity
          </Link>
          <button
            onClick={() => {
              if (readAloud) stopSpeaking();
              setReadAloud(!readAloud);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              readAloud
                ? 'border-[#009cde] bg-[#009cde]/10 text-[#003087]'
                : 'border-slate-300 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {readAloud ? '🔊 Reading replies' : '🔇 Read aloud'}
          </button>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            Sandbox
          </span>
          {user && (
            <span className="hidden text-xs text-slate-500 sm:inline">{user.displayName}</span>
          )}
          <button
            onClick={() => void logout()}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </header>

      {user?.isDemo && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-200 bg-purple-50 px-4 py-2 text-xs text-purple-900">
          <span>
            ✨ Demo mode: sample contacts and history, and every payment is simulated. Nothing
            touches PayPal.
          </span>
          <button
            onClick={() => void logout()}
            className="font-semibold underline"
          >
            Create your own account
          </button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {messages.length === 0 && (
            <div className="mt-10 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#003087] to-[#009cde] text-2xl font-bold text-white shadow-lg">
                P
              </div>
              <h1 className="text-2xl font-bold">What would you like to do?</h1>
              <p className="mt-2 text-sm text-slate-500">
                Type or speak. Nothing is paid until you approve it, or until one of your autopay
                rules allows it. Add people you pay on the Contacts page first.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-[#009cde] hover:text-[#003087] active:scale-95"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#003087] to-[#009cde] text-xs font-bold text-white">
                    P
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    m.role === 'user'
                      ? 'rounded-br-md bg-[#003087] text-white'
                      : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  {m.role === 'user' ? m.content : <Markdown>{m.content}</Markdown>}

                  {m.tools && m.tools.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.tools.map((t, j) => (
                        <span key={j} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          ⚙️ {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {m.auto?.map((a) => <AutoCard key={a.id} auto={a} />)}

                  {m.pending?.map((action) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      state={actionStates[action.id]}
                      onApprove={() => void decide(action, 'approve')}
                      onReject={() => void decide(action, 'reject')}
                    />
                  ))}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#003087] to-[#009cde] text-xs font-bold text-white">
                  P
                </div>
                <span className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                </span>
              </div>
            )}
          </div>
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          {listening && (
            <div className="mb-2 text-sm text-red-600">
              🎙️ Listening… <span className="text-slate-500">{interim}</span>
            </div>
          )}
          {voiceError && <div className="mb-2 text-sm text-red-600">{voiceError}</div>}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={listening ? stop : start}
              aria-label={listening ? 'Stop listening' : 'Start voice input'}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg transition active:scale-95 ${
                listening
                  ? 'animate-pulse bg-red-500 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              🎤
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Send 5 dollars to Ravi for the website work"
              className="h-11 flex-1 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#009cde] focus:ring-2 focus:ring-[#009cde]/30"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-11 rounded-full bg-[#003087] px-5 text-sm font-semibold text-white transition hover:bg-[#00257a] active:scale-95 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}