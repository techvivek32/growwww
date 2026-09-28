import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * The consent / user-agreement flow's data layer.
 *
 * The agreement text is versioned and hashed: every consent record stores the
 * exact SHA-256 of the text the user saw, plus a server timestamp, their typed
 * signature, IP and user-agent. That record — not a client-side timer — is the
 * artifact. When the text changes, bump AGREEMENT_VERSION and everyone is asked
 * to re-consent (the hash makes silent edits impossible to hide).
 *
 * Honest note carried into the UI: a reading timer is good-faith UX, not a
 * guarantee of legal validity. A production launch should have this exact flow
 * reviewed by counsel.
 */

export const AGREEMENT_VERSION = "1.0 · 2026-09-28";

export const AGREEMENT_TITLE = "MNHA Financials — User Agreement & Consent";

/** The full agreement. Editing ANY character changes the hash below, which
 *  invalidates prior consents for this version — intended. */
export const AGREEMENT_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "1. What MNHA Financials is — and is not",
    body:
      "MNHA Financials (“the Service”) is decision-support software that connects to your own brokerage account through the broker’s official API. It is NOT a broker, NOT a bank, NOT a portfolio manager, and NOT an investment adviser. It does not hold your money or your securities; those remain with your broker (Groww) at all times. It is not registered with SEBI as a Research Analyst or Investment Adviser.",
  },
  {
    heading: "2. Not investment advice",
    body:
      "Nothing the Service shows is personalised investment advice or a recommendation to buy or sell any security. Setups, signals, backtests and statistics are generated mechanically from historical and live market data, are impersonal, and may be wrong. You must make your own decisions and, where appropriate, consult a SEBI-registered adviser.",
  },
  {
    heading: "3. Your orders are yours",
    body:
      "Every order is placed on your own brokerage account and requires your explicit, two-step confirmation. You decide what to trade, in what size, and when. You are solely responsible for your orders and their outcomes. The Service does not place, modify or cancel any order on its own.",
  },
  {
    heading: "4. Risk and no guarantee",
    body:
      "Trading in equities and derivatives carries substantial risk, including loss of your entire capital; leveraged instruments can lose more than you deposit. SEBI studies find most individual derivatives traders lose money after costs. The Service makes NO promise of profit and NO promise against loss. There is no guaranteed, indicative, or “zero-loss” return, and any such claim, from anyone, is false. Past performance does not predict future results.",
  },
  {
    heading: "5. Your data and your consent",
    body:
      "To run the Service you provide an email and password (stored only as a salted hash) and, when you connect a broker, your API key and TOTP secret (stored encrypted at rest and used only for your account). If you choose to submit identity verification, your name, PAN, date of birth, address, selfie and any document are collected for that purpose only; PAN and date of birth are encrypted and your files are kept private. You consent to this collection and processing for operating the Service, and you may withdraw consent by disconnecting your broker or deleting your account from Settings, which removes your stored data.",
  },
  {
    heading: "6. Acceptable use",
    body:
      "You confirm any account you connect is your own and that you are at least 18. You will not attempt to breach the Service’s security, access other users’ data, scrape it at scale, or use it to break any law or your broker’s terms. Access that threatens the Service or other users may be suspended.",
  },
  {
    heading: "7. Limitation of liability",
    body:
      "The Service is provided “as is”, without warranties of any kind, to the maximum extent permitted by law. It may be delayed, interrupted, or display stale or incorrect data; always verify anything material with your broker before acting. MNHA Financials is not liable for trading losses, missed trades, data errors, downtime, or any indirect or consequential damages arising from your use of the Service.",
  },
  {
    heading: "8. Changes, termination and governing law",
    body:
      "The Service and this agreement may change; a material change bumps the agreement version and asks you to consent again. You may stop using the Service and delete your account at any time. This agreement is governed by the laws of India, and disputes are subject to the jurisdiction of the courts of India.",
  },
];

/** Deterministic plaintext of the whole agreement — what gets hashed. */
export function agreementPlainText(): string {
  return (
    `${AGREEMENT_TITLE}\nVersion ${AGREEMENT_VERSION}\n\n` +
    AGREEMENT_SECTIONS.map((s) => `${s.heading}\n${s.body}`).join("\n\n")
  );
}

export function agreementHash(): string {
  return createHash("sha256").update(agreementPlainText()).digest("hex");
}

/* ------------------------------------------------------------ store */

export interface ConsentRecord {
  userId: string;
  signatureName: string;
  agreementVersion: string;
  agreementHash: string;
  consentedAt: number;
  ip: string;
  userAgent: string;
}

interface Store {
  records: ConsentRecord[];
}

const FILE = process.env.CONSENT_FILE ?? path.join(process.cwd(), "data", "consents.json");

const g = globalThis as { __mnhaConsent?: { queue: Promise<unknown> } };
g.__mnhaConsent ??= { queue: Promise.resolve() };
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaConsent!.queue.then(job, job);
  g.__mnhaConsent!.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    return Array.isArray(parsed.records) ? parsed : { records: [] };
  } catch {
    return { records: [] };
  }
}
async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try { await copyFile(FILE, `${FILE}.bak`); } catch { /* first write */ }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

/** Append an immutable consent record for the CURRENT agreement version. */
export async function recordConsent(
  userId: string,
  input: { signatureName: string; ip: string; userAgent: string },
): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    store.records.push({
      userId,
      signatureName: input.signatureName.trim().slice(0, 120),
      agreementVersion: AGREEMENT_VERSION,
      agreementHash: agreementHash(),
      consentedAt: Date.now(),
      ip: input.ip.slice(0, 64),
      userAgent: input.userAgent.slice(0, 300),
    });
    await write(store);
  });
}

/** True when the user has accepted the CURRENT agreement version. */
export async function hasConsented(userId: string): Promise<boolean> {
  const v = AGREEMENT_VERSION;
  return (await read()).records.some((r) => r.userId === userId && r.agreementVersion === v);
}

/** Admin view — who accepted which version, when, from where. */
export async function listConsents(): Promise<ConsentRecord[]> {
  return (await read()).records.slice().sort((a, b) => b.consentedAt - a.consentedAt);
}

export async function deleteConsents(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const before = store.records.length;
    store.records = store.records.filter((r) => r.userId !== userId);
    if (store.records.length !== before) await write(store);
  });
}
