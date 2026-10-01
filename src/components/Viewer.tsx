"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Who is looking at the desk. Member accounts are view-only, so every order
 * control asks this before rendering. The default is "not the owner": a
 * component rendered outside the provider shows no trading controls at all.
 * (The server refuses member orders independently — this only hides the UI.)
 */
const Ctx = createContext<{ isOwner: boolean }>({ isOwner: false });

export function ViewerProvider({ isOwner, children }: { isOwner: boolean; children: ReactNode }) {
  return <Ctx.Provider value={{ isOwner }}>{children}</Ctx.Provider>;
}

export function useIsOwner(): boolean {
  return useContext(Ctx).isOwner;
}
