"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkCredentials,
  issueToken,
  expectedEmail,
} from "@/lib/auth";

export interface FormState {
  error?: string;
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = checkCredentials(email, password);
  if (!result.ok) return { error: result.error };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await issueToken(expectedEmail()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  redirect("/stocks/alerts");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
