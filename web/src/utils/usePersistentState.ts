import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';

function resolveInitial<T>(initial: T | (() => T)): T {
  return typeof initial === 'function' ? (initial as () => T)() : initial;
}

/**
 * useState whose value is mirrored to localStorage under `key`, so it survives a
 * page refresh. Reads the stored value on first mount (falling back to `initial`,
 * which may be a lazy factory), and writes back whenever the value changes.
 *
 * Priority of the initial value: `override` (when defined) > stored value >
 * `initial`. `override` is intended for an explicit external source such as a URL
 * query param: when present it wins over any persisted value AND is written back
 * to storage, and it is re-applied if it later changes during the session.
 *
 * SSR/permission-safe: any localStorage access is wrapped in try/catch so a
 * blocked or unavailable store just degrades to in-memory state.
 */
export function usePersistentState<T>(
  key: string,
  initial: T | (() => T),
  override?: T,
): [T, Dispatch<SetStateAction<T>>] {
  const readStored = (): T | undefined => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // ignore unavailable/blocked storage or malformed JSON
    }
    return undefined;
  };

  const [value, setValue] = useState<T>(() => {
    if (override !== undefined) return override;
    const stored = readStored();
    return stored !== undefined ? stored : resolveInitial(initial);
  });

  // Re-apply the override if it changes during the session (e.g. the URL param
  // changes via in-app navigation). Skips the initial value, which is already set.
  const lastOverride = useRef(override);
  useEffect(() => {
    if (override !== undefined && !Object.is(override, lastOverride.current)) {
      setValue(override);
    }
    lastOverride.current = override;
  }, [override]);

  // Re-read when the key changes (e.g. switching simulator variant), still
  // honouring any active override.
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    if (override !== undefined) {
      setValue(override);
      return;
    }
    const stored = readStored();
    setValue(stored !== undefined ? stored : resolveInitial(initial));
    // `initial`/`override` intentionally omitted: only react to key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore unavailable/blocked storage
    }
  }, [key, value]);

  return [value, setValue];
}
