import { createContext, useContext } from 'react';

export const ToastContext = createContext({ push: () => {} });

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx.push;
}

