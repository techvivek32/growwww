"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, OWNER_ID, issueToken, isOwnerLogin } from "@/lib/auth";
import { verifyLogin, hasBroker } from "@/lib/users";

export interface FormState {
  error?: string;
}

async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await issueToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  // The env "house" owner first, then registered users.
  if (isOwnerLogin(email, password)) {
    await setSession(OWNER_ID);
    redirect("/stocks/alerts");
  }

  const user = await verifyLogin(email, password);
  if (!user) return { error: "That email and password do not match." };

  await setSession(user.id);
  // Straight to connecting a broker if they have not yet — the terminal is
  // empty without it.
  redirect((await hasBroker(user.id)) ? "/stocks/alerts" : "/connect-broker");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
