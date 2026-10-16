'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Page-loaded league data for the route world.
 *
 * The scene renders the same rows the DOM sections were server-rendered from;
 * this context is how they reach the canvas. It is deliberately untyped at
 * this layer — each world declares its own payload shape (see
 * `evoliga/route/route-data.ts`) and reads it back through a typed hook.
 *
 * `<Canvas>` mounts its own reconciler root, so `RouteWorldCanvas` re-provides
 * this context inside the scene tree exactly like `WorldStateContext`.
 */
export const RouteDataContext = createContext<unknown>(null);

interface RouteDataProviderProps<T> {
  data: T;
  children: ReactNode;
}

export default function RouteDataProvider<T>({ data, children }: RouteDataProviderProps<T>) {
  return <RouteDataContext.Provider value={data}>{children}</RouteDataContext.Provider>;
}

export function useRouteData<T>(): T {
  const value = useContext(RouteDataContext);
  if (value === null) {
    throw new Error('useRouteData must be used inside a RouteDataProvider');
  }
  return value as T;
}
