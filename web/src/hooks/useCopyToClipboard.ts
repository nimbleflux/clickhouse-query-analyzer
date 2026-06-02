import { useCallback } from "react";
import { useToast } from "../components/Toast";

export function useCopyToClipboard() {
  const { toast } = useToast();

  return useCallback(
    async (text: string, label = "Copied!") => {
      try {
        await navigator.clipboard.writeText(text);
        toast(label, "success");
      } catch {
        toast("Failed to copy", "error");
      }
    },
    [toast],
  );
}
