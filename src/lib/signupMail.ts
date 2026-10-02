import "server-only";
import { sendMail } from "@/lib/mailer";

/** The two emails the sign-up flow sends. Plain, branded, no tracking. */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://visionmarket.in";

function frame(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f3efe6;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#15140f">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#fbf9f4;border:1px solid #e0d9ca" cellspacing="0" cellpadding="0">
<tr><td style="padding:22px 28px;border-bottom:1px solid #e0d9ca;font-family:Georgia,'Times New Roman',serif;font-size:22px">MNHA <i>Financials</i></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.1">${title}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e0d9ca;font-size:11px;color:#6e695e;line-height:1.5">
MNHA Financials · <a href="${SITE}" style="color:#b23a1c">visionmarket.in</a><br>
We will never ask for your Groww password, PIN or OTP.
</td></tr>
</table></td></tr></table></body></html>`;
}

export function sendSignupCode(to: string, code: string): Promise<boolean> {
  return sendMail({
    to,
    subject: `${code} is your MNHA Financials code`,
    text:
      `Your MNHA Financials verification code is ${code}.\n\n` +
      `Enter it on the sign-up page to create your account. It expires in 10 minutes.\n\n` +
      `If you did not try to sign up, ignore this email — no account is created without the code.\n\n` +
      `We will never ask for your Groww password, PIN or OTP.`,
    html: frame(
      "Your verification code",
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#4a463d">Enter this code on the sign-up page to create your account. It expires in 10 minutes.</p>
<p style="margin:0 0 18px;font-family:'Courier New',monospace;font-size:34px;letter-spacing:8px;color:#15140f;background:#eee9dd;padding:14px 18px;display:inline-block;user-select:all;-webkit-user-select:all">${code}</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#6e695e">Didn't try to sign up? Ignore this email — no account is created without the code.</p>`,
    ),
  });
}

/** Sent instead of a code when the address already has an account — so the
 *  sign-up form never reveals which emails are registered. */
export function sendAlreadyRegistered(to: string): Promise<boolean> {
  return sendMail({
    to,
    subject: "You already have an MNHA Financials account",
    text:
      `Someone (hopefully you) tried to sign up to MNHA Financials with this email address, which already has an account.\n\n` +
      `Sign in instead: ${SITE}/login\n\n` +
      `If this wasn't you, you can ignore this email — nothing has changed on your account.`,
    html: frame(
      "You already have an account",
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#4a463d">Someone — hopefully you — tried to sign up with this email address, which already has an MNHA Financials account.</p>
<p style="margin:0 0 18px"><a href="${SITE}/login" style="display:inline-block;background:#15140f;color:#fbf9f4;padding:12px 18px;text-decoration:none;font-size:14px">Sign in instead →</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#6e695e">Not you? Ignore this email — nothing has changed on your account.</p>`,
    ),
  });
}
