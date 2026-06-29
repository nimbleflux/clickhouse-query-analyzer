import { useEffect, useState } from "react";

/**
 * Returns the number of whole seconds `active` has been continuously true,
 * resetting to 0 whenever it goes false. Drives the elapsed-time feedback on
 * loading/refreshing indicators so users can tell a slow request is still in
 * flight (rather than frozen) and gauge its magnitude.
 */
export function useElapsedTimer(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}
