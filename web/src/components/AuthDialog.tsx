import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { setAuthToken, getAuthToken, clearAuthToken } from "@/api/client";

export const UNAUTHORIZED_EVENT = "clicklens:unauthorized";

interface UnauthorizedDetail {
  error?: string;
  hint?: string;
}

/**
 * App-level access-token dialog. The backend rejects every /api request with
 * 401 {code: "UNAUTHORIZED", hint} while -auth-token is set and the browser
 * hasn't presented the right X-Auth-Token yet; api/client.ts dispatches
 * "clicklens:unauthorized" on each such response (including the startup
 * /api/config check) and this dialog responds to it. Saving the token reloads
 * the page so the failed request's whole route re-fetches with the header set.
 */
export function AuthDialog() {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      const detail = (e as CustomEvent<UnauthorizedDetail>).detail || {};
      setHint(detail.hint || "");
      setError(detail.error || "");
      setToken(getAuthToken());
      setOpen(true);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const close = () => {
    setOpen(false);
    setSaving(false);
  };

  const submit = () => {
    setSaving(true);
    if (token.trim()) {
      setAuthToken(token.trim());
    } else {
      // An empty submit means "forget what I had" so a wrong token can be
      // cleared instead of replayed forever.
      clearAuthToken();
    }
    // Reload so every page-level fetch re-runs with the updated header.
    window.location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="max-w-md" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--color-accent)]" />
            Access token
          </DialogTitle>
          <DialogDescription>
            {hint || "This ClickLens server requires an access token. Paste it once — it is kept in this browser tab."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="px-6 py-4">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              placeholder="Access token"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--surface-base)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
            />
            {error && (
              <p className="mt-2 text-xs text-[var(--color-error)]">{error}</p>
            )}
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
              Stored in sessionStorage — closing the tab signs you out.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save &amp; reload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
