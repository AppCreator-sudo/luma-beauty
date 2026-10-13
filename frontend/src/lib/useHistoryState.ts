import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type Values = Record<string, unknown>;
type Entry = { index: number; values: Values };
type NavigationState = { values: Values; trail: Entry[] };
type Options = { flow?: boolean; transient?: boolean; backOnDecrease?: boolean };
type Change = { value: unknown; initial: unknown; options: Options };
type Pending = { href: string; changes: Map<string, Change>; commit: (changes: Map<string, Change>) => void };
let pending: Pending | undefined;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function current(): NavigationState {
  return window.history.state?.usr?.lumaNavigation || { values: {}, trail: [] };
}

/** Navigation state only: never put passwords, contacts or form input in history. */
export function useHistoryState<T>(name: string, initial: T | (() => T), options: Options = {}): [T, Dispatch<SetStateAction<T>>] {
  const location = useLocation(), navigate = useNavigate();
  const key = location.pathname + ':' + name;
  const base = useRef<{ key: string; value: T } | null>(null);
  if (!base.current || base.current.key !== key) base.current = { key, value: typeof initial === 'function' ? (initial as () => T)() : initial };
  const fallback = base.current.value;
  const state = (location.state?.lumaNavigation as NavigationState | undefined);
  const value = (state && Object.hasOwn(state.values, key) ? state.values[key] : fallback) as T;
  const setter = useCallback<Dispatch<SetStateAction<T>>>(action => {
    const href = window.location.href;
    const before = pending?.href === href && pending.changes.has(key) ? pending.changes.get(key)!.value : Object.hasOwn(current().values, key) ? current().values[key] : fallback;
    const next = typeof action === 'function' ? (action as (v: T) => T)(before as T) : action;
    if (equal(before, next)) return;
    if (!pending || pending.href !== href) {
      pending = { href, changes: new Map(), commit: changes => {
        const old = current(), values = { ...old.values };
        for (const [changeKey, change] of changes) {
          if (equal(change.value, change.initial)) delete values[changeKey];
          else values[changeKey] = change.value;
        }
        if (equal(old.values, values)) return;
        const index = Number(window.history.state?.idx || 0);
        // A menu selection replaces the temporary open-menu entry with its destination.
        const transientClosed = [...changes].some(([k, c]) => c.options.transient && !equal(old.values[k] ?? c.initial, c.initial) && equal(c.value, c.initial));
        const otherChange = [...changes].some(([k, c]) => (!c.options.transient || !equal(c.value, c.initial)) && !equal(old.values[k] ?? c.initial, c.value));
        const newAction = [...changes].some(([k, c]) => !equal(old.values[k] ?? c.initial, c.value) && (!equal(c.value, c.initial) || (!c.options.flow && !c.options.transient)));
        if (!transientClosed || !otherChange) {
          const returningStep = [...changes].some(([k, c]) => c.options.backOnDecrease && typeof c.value === 'number' && Number(old.values[k] ?? c.initial) > c.value);
          const previous = returningStep ? [...old.trail].reverse().find(e => equal(e.values, values)) : undefined;
          if (previous && previous.index < index) { navigate(previous.index - index); return; }
          const closing = [...changes].find(([k, c]) => c.options.flow && !equal(old.values[k] ?? c.initial, c.initial) && equal(c.value, c.initial));
          if (closing && !newAction) {
            const [k, c] = closing;
            const opener = [...old.trail].reverse().find(e => equal(e.values[k] ?? c.initial, c.initial));
            if (opener && opener.index < index) { navigate(opener.index - index); return; }
          }
        }
        const replace = transientClosed && otherChange;
        const trail = replace ? old.trail : [...old.trail, { index, values: old.values }].slice(-60);
        const usr = window.history.state?.usr || {};
        navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace, preventScrollReset: true, state: { ...usr, lumaNavigation: { values, trail } } });
      } };
      const transaction = pending;
      queueMicrotask(() => {
        if (pending !== transaction) return;
        pending = undefined;
        if (window.location.href === transaction.href) transaction.commit(transaction.changes);
      });
    }
    pending.changes.set(key, { value: next, initial: fallback, options });
  }, [key, fallback, options.flow, options.transient, options.backOnDecrease, navigate, location.pathname, location.search, location.hash]);
  return [value, setter];
}

/** Route links from a menu consume the temporary menu entry rather than reopening it on Back. */
export function navigationMenuOpen() {
  return Boolean(document.querySelector('dialog.luma-menu-layer[open]'));
}
