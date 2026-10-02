import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Transactional email (verification codes) over SMTP — Gmail with an app
 * password today. Configured only from the server environment:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM (optional)
 * Nothing here is ever sent to the browser.
 */

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function mailConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

const g = globalThis as { __mnhaMailer?: Transporter };

function transport(): Transporter {
  if (!g.__mnhaMailer) {
    const port = Number(env("SMTP_PORT") ?? 465);
    g.__mnhaMailer = nodemailer.createTransport({
      host: env("SMTP_HOST"),
      port,
      secure: port === 465,
      auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS")?.replace(/\s+/g, "") },
    });
  }
  return g.__mnhaMailer;
}

export async function sendMail(msg: { to: string; subject: string; text: string; html: string }): Promise<boolean> {
  if (!mailConfigured()) return false;
  try {
    await transport().sendMail({
      from: env("MAIL_FROM") ?? `"MNHA Financials" <${env("SMTP_USER")}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return true;
  } catch (e) {
    console.error("[mail] send failed:", e instanceof Error ? e.message : e);
    return false;
  }
}
