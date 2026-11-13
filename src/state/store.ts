import { createContext, useContext, useSyncExternalStore } from "react";
import { transition, type Action, type AtlasState, type Catalog } from "./atlas-state";
/** Called after every transition that changed the state, with the action that caused it. */
export type Listener = (state: AtlasState, previous: AtlasState, action: Action) => void;
export type Store = {
  getState: () => AtlasState;
  dispatch: (action: Action) => void;
  subscribe: (listener: Listener) => () => void;
};
export function createStore(initial: AtlasState, catalog: Catalog): Store {
  let state = initial;
  const listeners = new Set<Listener>();
  // An action dispatched by a listener waits until every listener has seen
  // the one before it, so all of them observe the same sequence.
  const queue: Action[] = [];
  let notifying = false;
  return {
    getState: () => state,
    dispatch(action) {
      queue.push(action);
      if (notifying) return;
      notifying = true;
      try {
        while (queue.length) {
          const next = queue.shift()!;
          const previous = state;
          state = transition(previous, next, catalog);
          if (state === previous) continue;
          for (const listener of [...listeners]) listener(state, previous, next);
        }
      } finally {
        notifying = false;
        queue.length = 0;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export const StoreContext = createContext<Store | null>(null);
export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore needs a StoreContext provider.");
  return store;
}
/**
 * Reads one slice of the state and re-renders when it changes. The slice must
 * be a value or a reference the transitions keep, never a fresh object.
 */
export function useAtlas<T>(select: (state: AtlasState) => T): T {
  const store = useStore();
  return useSyncExternalStore(
    (notify) => store.subscribe(notify),
    () => select(store.getState()),
  );
}
