"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { FormError, fieldBase, submitCls } from "@/components/public/AuthShell";
import { connectBroker, type Check, type FormState } from "./actions";
import { classify, extractAll, type Classified } from "./parse";

/**
 * The guided Groww connection. Everything that CAN be automated is: deep
 * links, paste recognition, and a live verification with Groww before
 * anything is saved. What cannot be — signing in to Groww, creating the key —
 * happens on Groww's own site, by the user. We never ask for the Groww password.
 *
 * No static IP: member accounts are read-only, and exchange rules tie one
 * static IP to one client (or one family) — Groww refuses our server's IP on
 * a second account. A static IP matters only for placing orders.
 */

const GROWW_TRADE_API = "https://groww.in/trade-api";
const GROWW_API_KEYS = "https://groww.in/trade-api/api-keys";

/** Outside render so the purity lint is satisfied; expiry is a wall-clock fact. */
const isExpired = (exp: number | null | undefined) => Boolean(exp && exp < Date.now());

const fmtDate = (ms: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(ms);

function Step({ n, title, done, children }: { n: string; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.75rem_1fr] gap-4 border-t border-pub-hair py-8 sm:grid-cols-[3.5rem_1fr]">
      <span className={`tnum text-[30px] leading-none sm:text-[38px] ${done ? "text-pub-dim" : "text-pub-cream"}`}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[0.12em] text-pub-cream uppercase">{title}</h2>
        <div className="mt-3 space-y-4 text-[15.5px] leading-[1.6] text-pub-muted">{children}</div>
      </div>
    </li>
  );
}

function OutLink({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="inline-flex items-center gap-2 border border-pub-cream px-4 py-2.5 text-[14.5px] font-medium text-pub-cream transition-colors hover:bg-pub-cream hover:text-pub-ink"
    >
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

/**
 * A checkbox that only drives client state. Nothing here is submitted: React 19
 * resets a <form> after each action, which would untick a form-associated
 * checkbox while state still says ticked — the form carries a hidden input.
 */
function Tick({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[15px] text-pub-cream">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[#d9471f]"
      />
      <span>{label}</span>
    </label>
  );
}

type Expect = "apiKey" | "secret";

const isSecretKind = (c: Classified) => c.kind === "totpSecret" || c.kind === "otpauth";

/**
 * Every letter is valid base32, so a whole paste of plain prose would classify
 * as a secret. For the smart-paste fallback, accept it only when it is written
 * in capitals or laid out in the usual groups of four ("abcd efgh …").
 */
const looksLikeSecret = (raw: string) => {
  const t = raw.trim();
  return t === t.toUpperCase() || /^(?:[a-z2-7]{4}[\s-]+)+[a-z2-7]{1,4}$/i.test(t);
};

/** Does this value belong in the field that expects `expect`? (Expiry aside.) */
const belongsIn = (c: Classified, expect: Expect) => (expect === "apiKey" ? c.kind === "apiKey" : isSecretKind(c));

/**
 * The live verdict under a field. Always rendered (empty when the field is
 * empty) so the field's aria-describedby never points at nothing.
 */
function Status({ id, c, expect }: { id: string; c: Classified; expect: Expect }) {
  if (c.kind === "empty") return <p id={id} />;
  const line = "mt-2 font-plex text-[11.5px] tracking-[0.04em]";

  if (belongsIn(c, expect)) {
    if (c.kind === "apiKey" && isExpired(c.exp)) {
      return (
        <p id={id} className={`${line} text-pub-coral`}>
          ✗ This key has expired on Groww — generate a new TOTP key
        </p>
      );
    }
    const extra =
      c.kind === "apiKey"
        ? c.exp
          ? ` · valid until ${fmtDate(c.exp)}`
          : ""
        : c.kind === "otpauth"
          ? ` · from an authenticator link${c.issuer ? ` (${c.issuer})` : ""}`
          : "";
    return (
      <p id={id} className={`${line} text-pub-upl`}>
        ✓ Recognised{extra}
      </p>
    );
  }

  const msg =
    c.kind === "otpCode"
      ? "That is a one-time code (it expires in 30s). Paste the secret text beside the QR code."
      : expect === "secret" && c.kind === "apiKey"
        ? "That is the API key — it goes in the other field."
        : expect === "apiKey" && isSecretKind(c)
          ? "That looks like the TOTP secret — it goes in the other field."
          : "Not recognised as this value.";
  return (
    <p id={id} className={`${line} text-pub-coral`}>
      ✗ {msg}
    </p>
  );
}

const CHECK_LABEL: [keyof NonNullable<FormState["checks"]>, string][] = [
  ["keyFormat", "API key format"],
  ["secretFormat", "TOTP secret format"],
  ["token", "Groww issued a session"],
  ["account", "Account read"],
];

function Checks({ checks }: { checks: NonNullable<FormState["checks"]> }) {
  const mark = (c: Check) => (c === "ok" ? "✓" : c === "fail" ? "✗" : "·");
  return (
    <ul className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1.5 font-plex text-[12px] sm:grid-cols-4">
      {CHECK_LABEL.map(([k, label]) => (
        <li key={k} className={checks[k] === "ok" ? "text-pub-upl" : checks[k] === "fail" ? "text-pub-coral" : "text-pub-dim"}>
          {mark(checks[k])} {label}
        </li>
      ))}
    </ul>
  );
}

function Submit({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || !ready} className={submitCls}>
      {pending ? "Checking with Groww…" : "Verify with Groww & connect"}
      {!pending && <span className="pub-arrow" aria-hidden="true">→</span>}
    </button>
  );
}

export default function ConnectWizard({ assignedIp }: { assignedIp: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(connectBroker, {});
  const [subscribed, setSubscribed] = useState(false);
  const [opened, setOpened] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [smart, setSmart] = useState("");
  const [clipNote, setClipNote] = useState<string | null>(null);

  const keyC = classify(apiKey);
  const secC = classify(secret);
  const keyOk = keyC.kind === "apiKey" && !isExpired(keyC.exp);
  const secOk = isSecretKind(secC);

  /** Route whatever was pasted into the right field(s). */
  function absorb(text: string) {
    // The paste read as ONE value catches what the token scan only sees in
    // fragments: a key wrapped across lines, a secret shown as "ABCD EFGH …".
    const whole = classify(text);
    // Token scan first: it splits "key + secret" pasted together correctly.
    const found = extractAll(text);
    let k: Classified | null = found.apiKey;
    let t: Classified | null = found.totp;
    // A key wrapped across lines, pasted on its own: the scan only sees a
    // fragment, but the whole paste reads as one key.
    if (!k && !t && whole.kind === "apiKey") k = whole;
    if (!k && !t && (whole.kind === "otpauth" || (whole.kind === "totpSecret" && looksLikeSecret(text)))) t = whole;
    if (k) setApiKey(k.value);
    if (t) setSecret(t.value);
    if (k || t) {
      setClipNote(k && t ? "Found both — the key and the secret." : k ? "Found the API key. Now paste the secret." : "Found the TOTP secret. Now paste the API key.");
    } else {
      setClipNote(whole.kind === "otpCode" ? "That is a one-time code — we need the secret text beside the QR code." : "Nothing recognisable in that paste.");
    }
  }

  async function fromClipboard() {
    try {
      absorb(await navigator.clipboard.readText());
    } catch {
      setClipNote("Your browser blocked clipboard access — paste into the box instead.");
    }
  }

  return (
    <div>
      <p className="font-plex text-[11px] tracking-[0.12em] text-pub-coral uppercase">Step 03 · Connect Groww</p>
      <h1 className="pub-display mt-4 text-[clamp(2.8rem,5vw,3.8rem)] leading-[0.98] text-pub-cream">
        Connect your <em>Groww.</em>
      </h1>
      <p className="mt-4 max-w-[38rem] text-[16px] leading-relaxed text-pub-muted">
        Two short steps on Groww&apos;s site, then one paste here — about five minutes. You sign in on Groww itself;
        we never ask for your Groww password, PIN or OTP, and a key cannot withdraw money.
      </p>

      <ol className="mt-10 border-b border-pub-hair">
        <Step n="1" title="Turn on Groww's Trading API" done={subscribed}>
          <p>
            Groww sells API access as a subscription. If you don&apos;t have it yet, open Trading APIs on Groww, pick a
            plan and confirm — check the current price there.
          </p>
          <OutLink href={GROWW_TRADE_API}>Open Groww Trading APIs</OutLink>
          <Tick label="My Groww Trading API subscription is active" checked={subscribed} onChange={setSubscribed} />
        </Step>

        <Step n="2" title="Generate a TOTP key" done={opened && keyOk}>
          <p>
            On the API keys page, open the dropdown beside <strong className="text-pub-cream">Generate API key</strong> →{" "}
            <strong className="text-pub-cream">Generate TOTP token</strong> → name it <strong className="text-pub-cream">MNHA</strong> →
            Continue. Groww shows two values: the <strong className="text-pub-cream">TOTP token</strong> (your API key) and the{" "}
            <strong className="text-pub-cream">secret</strong> beside the QR code. Keep that tab open.
          </p>
          <OutLink href={GROWW_API_KEYS} onClick={() => setOpened(true)}>
            Open Groww API keys
          </OutLink>
          <p className="border-l-2 border-pub-accent pl-3.5 text-[14px]">
            Choose <strong className="text-pub-cream">TOTP</strong>. An access token expires every morning, and a key + secret
            pair needs your approval every day — the desk would stop working each morning.
          </p>
          {assignedIp ? (
            <div className="border-l-2 border-pub-accent pl-3.5 text-[14px]">
              <p>
                <strong className="text-pub-cream">Add this static IP to the key:</strong>
              </p>
              <p className="my-1.5 font-mono text-[15px] tracking-wide text-pub-cream select-all">{assignedIp}</p>
              <p>
                It is reserved for your account alone — Groww allows one IP on one account only, so nobody else is given
                it. Your orders are sent from exactly this address; without it on the key, the exchange refuses them.
              </p>
            </div>
          ) : (
            <p className="border-l-2 border-pub-accent pl-3.5 text-[14px]">
              <strong className="text-pub-cream">Leave the static IP empty for now.</strong> We have no free address to
              reserve for this account yet. Orders stay unavailable until one is assigned — everything else works.
            </p>
          )}
        </Step>

        <Step n="3" title="Paste, and we verify it live" done={false}>
          <p>Paste what Groww showed you — the key, the secret, or the whole lot at once. We sort it into the right place.</p>

          <div>
            <textarea
              value={smart}
              onChange={(e) => {
                setSmart(e.target.value);
                if (e.target.value.trim()) absorb(e.target.value);
              }}
              rows={3}
              placeholder="Paste here…"
              aria-label="Smart paste"
              spellCheck={false}
              autoComplete="off"
              className="w-full resize-none border border-dashed border-pub-cream/60 bg-transparent px-3.5 py-3 font-plex text-[13px] text-pub-cream outline-none placeholder:text-pub-dim focus:border-solid focus:border-pub-cream"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={fromClipboard} className="text-[14px] font-medium text-pub-cream underline decoration-pub-accent decoration-2 underline-offset-4 hover:opacity-80">
                Paste from clipboard
              </button>
              {/* Always mounted: a live region that appears with its text is often not announced. */}
              <span className="font-plex text-[11.5px] text-pub-muted" aria-live="polite">
                {clipNote ?? ""}
              </span>
            </div>
          </div>

          <form id="connect-form" action={action} className="space-y-5 pt-2">
            {assignedIp && <input type="hidden" name="staticIp" value={assignedIp} />}
            <div>
              <label htmlFor="cb-apiKey" className="mb-2 block text-[11px] font-semibold tracking-[0.12em] text-pub-cream uppercase">
                API key (TOTP token)
              </label>
              <textarea
                id="cb-apiKey"
                name="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                rows={3}
                required
                spellCheck={false}
                autoComplete="off"
                placeholder="eyJ…"
                aria-describedby="cb-apiKey-status"
                aria-invalid={keyC.kind !== "empty" && !keyOk}
                className={`${fieldBase} h-auto resize-none py-3 font-plex text-[12.5px] leading-relaxed break-all`}
              />
              <Status id="cb-apiKey-status" c={keyC} expect="apiKey" />
            </div>
            <div>
              <label htmlFor="cb-totpSecret" className="mb-2 block text-[11px] font-semibold tracking-[0.12em] text-pub-cream uppercase">
                TOTP secret
              </label>
              <input
                id="cb-totpSecret"
                name="totpSecret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required
                spellCheck={false}
                autoComplete="off"
                data-1p-ignore
                placeholder="The text beside the QR code"
                aria-describedby="cb-totpSecret-status"
                aria-invalid={secC.kind !== "empty" && !secOk}
                className={`${fieldBase} font-plex text-[13.5px] tracking-wide`}
              />
              <Status id="cb-totpSecret-status" c={secC} expect="secret" />
            </div>

            {state.error && <FormError>{state.error}</FormError>}
            {state.checks && <Checks checks={state.checks} />}

            <Submit ready={keyOk && secOk} />
            <p className="text-[13px] leading-relaxed text-pub-dim">
              We mint a session with Groww and read your margin before saving anything. Keys are stored AES-256
              encrypted, used only for your own account, and you can revoke them on Groww at any time.
            </p>
          </form>
        </Step>
      </ol>
    </div>
  );
}
