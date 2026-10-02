"use client";

import { useId, useState } from "react";
import { FieldLabel, fieldCls } from "./AuthShell";

/**
 * A password input with a show/hide (eye) toggle. The toggle sits outside the
 * <label>, so its text never joins the field's accessible name.
 */
export default function PasswordField({
  label,
  name,
  autoComplete,
  placeholder,
  minLength,
  className = "",
}: {
  label: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  minLength?: number;
  className?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className={className}>
      <label htmlFor={id} className="block">
        <FieldLabel>{label}</FieldLabel>
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          placeholder={placeholder}
          spellCheck={false}
          className={`${fieldCls} pr-11`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          aria-controls={id}
          title={show ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-1 grid h-9 w-9 -translate-y-1/2 place-items-center text-pub-muted transition-colors hover:text-pub-cream"
        >
          {show ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8" />
              <path d="M16.7 16.7A9.6 9.6 0 0 1 12 18c-5 0-9-6-9-6a17 17 0 0 1 4.1-4.7M9.9 5.2A9.6 9.6 0 0 1 12 5c5 0 9 6 9 6a17 17 0 0 1-2.2 2.9" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Z" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
