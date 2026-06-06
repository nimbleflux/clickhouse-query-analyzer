import { useState, useCallback, useRef, createContext, useContext, type ReactNode } from "react";
import { X } from "lucide-react";

export interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextValue {
  toast: (message: string, type?: Toast["type"]) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const MAX_TOASTS = 5;
const TOAST_DURATION: Record<Toast["type"], number> = {
  success: 3000,
  info: 4000,
  error: 6000,
};

const TOAST_STYLES: Record<Toast["type"], string> = {
  success: "border-[var(--color-success)]/30 bg-[var(--state-success)] text-[var(--color-success)]",
  error: "border-[var(--color-error)]/30 bg-[var(--state-error)] text-[var(--color-error)]",
  info: "border-[var(--color-accent)]/30 bg-[var(--state-info)] text-[var(--color-accent)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, type }]);
    setTimeout(() => dismiss(id), TOAST_DURATION[type]);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-[slideIn_0.2s_ease-out] flex items-start gap-2 rounded-lg border px-4 py-2.5 pr-8 text-sm shadow-[var(--shadow-md)] ${TOAST_STYLES[t.type]}`}
          >
            {t.message}
            <button
              onClick={() => dismiss(t.id)}
              className="absolute right-1 top-1 rounded p-0.5 opacity-60 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
