import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ToastItem {
  id: number;
  message: string;
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

/**
 * The app's one "something failed" channel ("nothing silent"): any handler
 * whose failure would otherwise vanish — capture, todo flips, settings saves —
 * reports through this. Success stays quiet; the UI itself shows it.
 */
export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, message }]);
      window.setTimeout(() => dismiss(id), 8000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-background p-3 text-sm shadow-lg"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <p className="min-w-0 flex-1">{t.message}</p>
              <button
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
