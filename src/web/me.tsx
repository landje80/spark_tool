import { createContext, useContext } from 'react';
import type { Me } from './api';

export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe buiten MeContext');
  return me;
}

/** Alleen om knoppen te tonen/verbergen; de server dwingt rechten altijd zelf af. */
export function useCan(permission: string): boolean {
  return useMe().permissions.includes(permission);
}
