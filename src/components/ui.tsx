"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export async function api<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(
    `/api/${path}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && path !== "auth") window.location.assign("/login");
    throw new Error(data.error || "Request failed.");
  }
  return data as T;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const d = ref.current;
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      aria-labelledby="dialog-title"
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">↗</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ConfigState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="state-page">
      <span className="brand-mark">t</span>
      <span className="eyebrow">TEMPO · SETUP</span>
      <h1>Your workspace is almost ready.</h1>
      <p>{message}</p>
      <div className="setup-steps">
        <p>
          1. Copy <code>.env.example</code> to <code>.env.local</code>.
        </p>
        <p>2. Add your Supabase project URL and publishable key.</p>
        <p>
          3. Apply the migration in <code>supabase/migrations</code>.
        </p>
        <p>
          4. Restart the development server. Gemini is optional for manual
          planning.
        </p>
      </div>
      <button className="primary" onClick={onRetry}>
        Try again
      </button>
      <a href="/login">Go to sign in</a>
    </main>
  );
}
