import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { errorMessage } from "@cloud-console/core/aws/errors";
import { useStore } from "../state/store";
import { connections, type Connection } from "../state/connections";
import { openSession, type Session } from "../services/cloud";
import { settings } from "../services/settings";

/** The connection named by the `id` route param and its opened session. */
export function useSession(): { connection?: Connection; session?: Session } {
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = useStore(connections);
  const { demoOn } = useStore(settings);
  const connection = list.find((c) => c.id === id);
  const [session, setSession] = useState<Session>();
  useEffect(() => {
    let live = true;
    setSession(undefined);
    if (connection) void openSession(connection).then((s) => live && setSession(s));
    return () => {
      live = false;
    };
  }, [connection?.id, demoOn]);
  return { connection, session };
}

/** A route param that carries a JSON-encoded object. */
export function useJsonParam<T>(name: string): T | undefined {
  const params = useLocalSearchParams<Record<string, string>>();
  const raw = params[name];
  try {
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export interface Loadable<T> {
  value?: T;
  loading: boolean;
  error?: string;
  reload: (force?: boolean) => Promise<void>;
}

/** Loads once the session is ready; `reload(true)` bypasses the cache. */
export function useLoad<T>(session: Session | undefined, fetch: (s: Session, force: boolean) => Promise<T>, deps: unknown[] = []): Loadable<T> {
  const [value, setValue] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const reload = useCallback(
    async (force = false) => {
      if (!session) return;
      setLoading(true);
      setError(undefined);
      try {
        setValue(await fetchRef.current(session, force));
      } catch (e) {
        setError(errorMessage(e));
      }
      setLoading(false);
    },
    [session, ...deps]
  );
  useEffect(() => {
    void reload(false);
  }, [reload]);
  return { value, loading, error, reload };
}
