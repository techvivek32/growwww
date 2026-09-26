"use server";

import { redirect } from "next/navigation";
import { createUser } from "@/lib/users";
import { setSession } from "@/lib/session";

export interface FormState {
  error?: string;
}

export async function signup(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) return { error: "The two passwords do not match." };

  const res = await createUser(email, password);
  if (!res.ok || !res.user) return { error: res.error ?? "Could not create the account." };

  await setSession(res.user.id);
  // A fresh account has no broker yet — go connect one.
  redirect("/connect-broker");
}
