'use client';

/** Transient notifications, ported from the single-file build's `toast()`
 *  (the map used one pinned above the canvas: "Zoom in to load Zoning",
 *  "Site polygon saved", "Gross site area updated…").
 *
 *  The API is deliberately tiny, because everything else in the app has to
 *  be able to reach for it without ceremony:
 *
 *      import { toast } from '@/components/Toast';
 *      toast('Site polygon saved');
 *      toast.error('Zoning layer could not be loaded');
 *
 *  Two properties are not negotiable:
 *   - every toast is dismissible (click it, or its ×, or press Escape), and
 *   - the stack is capped, so a failing poll cannot paper over the screen.
 *     The oldest is dropped once MAX is reached, and an identical message
 *     fired again just resets the existing one's timer instead of stacking.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

export type ToastKind = 'info' | 'success' | 'error';
export type ToastItem = { id: number; message: string; kind: ToastKind; ms: number };

const MAX = 4;
const DEFAULT_MS = 3600;
const ERROR_MS = 6000;

let items: ToastItem[] = [];
let nextId = 1;
let mounted = 0;                                   // how many <Toaster/>s exist
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const snapshot = () => items;
const serverSnapshot = () => EMPTY;
const EMPTY: ToastItem[] = [];

function arm(t: ToastItem) {
  clearTimeout(timers.get(t.id));
  timers.set(t.id, setTimeout(() => dismiss(t.id), t.ms));
}

export function dismiss(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  items = items.filter((t) => t.id !== id);
  emit();
}

export function dismissAll() {
  for (const id of timers.keys()) clearTimeout(timers.get(id)!);
  timers.clear();
  items = [];
  emit();
}

function push(message: string, kind: ToastKind, ms?: number): number {
  const text = String(message ?? '').trim();
  if (!text) return 0;

  // repeat of what is already on screen: refresh it rather than stack it
  const existing = items.find((t) => t.message === text && t.kind === kind);
  if (existing) {
    items = items.filter((t) => t.id !== existing.id).concat(existing);
    arm(existing);
    emit();
    return existing.id;
  }

  const item: ToastItem = {
    id: nextId++, message: text, kind,
    ms: ms ?? (kind === 'error' ? ERROR_MS : DEFAULT_MS),
  };
  items = [...items, item];
  while (items.length > MAX) {
    const dropped = items[0];
    items = items.slice(1);
    clearTimeout(timers.get(dropped.id));
    timers.delete(dropped.id);
  }
  arm(item);
  emit();
  ensureToaster();
  return item.id;
}

/** If the app never rendered a <Toaster/>, mount one on demand rather than
 *  swallow the message. Anything can call toast() from anywhere without the
 *  caller having to know whether the host page wired the provider up. */
function ensureToaster() {
  if (mounted > 0 || typeof document === 'undefined') return;
  if (document.getElementById('toast-auto-root')) return;
  const host = document.createElement('div');
  host.id = 'toast-auto-root';
  document.body.appendChild(host);
  import('react-dom/client')
    .then(({ createRoot }) => { createRoot(host).render(<Toaster />); })
    .catch(() => { /* no React DOM: the message is simply not shown */ });
}

type ToastFn = {
  (message: string, ms?: number): number;
  info: (message: string, ms?: number) => number;
  success: (message: string, ms?: number) => number;
  error: (message: string, ms?: number) => number;
  dismiss: (id: number) => void;
  dismissAll: () => void;
};

const base = (message: string, ms?: number) => push(message, 'info', ms);
export const toast: ToastFn = Object.assign(base, {
  info: (m: string, ms?: number) => push(m, 'info', ms),
  success: (m: string, ms?: number) => push(m, 'success', ms),
  error: (m: string, ms?: number) => push(m, 'error', ms),
  dismiss,
  dismissAll,
});

/* ------------------------------------------------------------------- view */

/** Render once, near the root. Optional — toast() will mount its own if the
 *  app does not include one. */
export function Toaster(
  { position = 'bottom-right' }: { position?: 'bottom-right' | 'top-center' } = {},
) {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  useEffect(() => {
    mounted++;
    return () => { mounted--; };
  }, []);

  // Escape clears the stack — the fastest way out of a wall of failures
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && items.length) dismissAll(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className={`toastwrap ${position}`} role="region" aria-label="Notifications">
        {/* assertive for errors only: a status update should not interrupt a
            screen-reader user mid-sentence, a failure should */}
        <div aria-live="polite" aria-atomic="false" className="toaststack">
          {list.map((t) => (
            <Toast key={t.id} item={t} />
          ))}
        </div>
      </div>
    </>
  );
}

function Toast({ item }: { item: ToastItem }) {
  const [leaving, setLeaving] = useState(false);

  const close = () => {
    setLeaving(true);
    setTimeout(() => dismiss(item.id), 140);
  };

  return (
    <div
      className={`toast ${item.kind}${leaving ? ' leaving' : ''}`}
      role={item.kind === 'error' ? 'alert' : 'status'}
      onClick={close}
    >
      <span className="toast-msg">{item.message}</span>
      <button
        type="button" className="toast-x" aria-label="Dismiss notification"
        onClick={(e) => { e.stopPropagation(); close(); }}
      >
        ×
      </button>
    </div>
  );
}

export default Toaster;

/* Styles travel with the component: app/globals.css is owned elsewhere, and
   a notification that depends on someone else remembering to add CSS is a
   notification that will one day be invisible. */
const CSS = `
.toastwrap{position:fixed;z-index:9999;display:flex;pointer-events:none}
.toastwrap.bottom-right{right:16px;bottom:16px;justify-content:flex-end}
.toastwrap.top-center{left:50%;top:14px;transform:translateX(-50%)}
.toaststack{display:flex;flex-direction:column;gap:8px;align-items:stretch;max-width:min(380px,calc(100vw - 32px))}
.toastwrap.bottom-right .toaststack{align-items:flex-end}
.toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;cursor:pointer;
  padding:10px 12px;border:1px solid #d7dde5;border-left:3px solid #3e5e7f;border-radius:8px;
  background:#fff;color:#22303f;font:500 12.5px/1.4 var(--sans,system-ui,-apple-system,sans-serif);
  box-shadow:0 6px 20px rgba(18,47,86,.14);overflow-wrap:anywhere;
  animation:toast-in .16s ease-out}
.toast.success{border-left-color:#1f8a53}
.toast.error{border-left-color:#c02b2b;background:#fff8f8;color:#8a1f1f}
.toast.leaving{opacity:0;transform:translateY(4px);transition:opacity .14s,transform .14s}
.toast-msg{flex:1;min-width:0}
.toast-x{flex:0 0 auto;border:0;background:transparent;cursor:pointer;padding:0 2px;line-height:1;
  font-size:16px;color:inherit;opacity:.5}
.toast-x:hover{opacity:1}
.toast-x:focus-visible{outline:2px solid #2e6fc2;outline-offset:2px;border-radius:3px}
@keyframes toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.toast{animation:none}.toast.leaving{transition:none}}
`;
