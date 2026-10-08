"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Who is looking at the desk, and what they may do.
 *
 * `isOwner` is identity — the house account, which keeps the owner-only
 * sections. `canTrade` is capability — the owner, or a member whose own Groww
 * key carries the static IP our orders are sent from. Order controls ask for
 * the capability, never the identity, so a properly connected member gets a
 * working desk.
 *
 * Both default to false: a component rendered outside the provider shows no
 * trading controls at all. (The server refuses independently — this only
 * decides what is rendered.)
 */
const Ctx = createContext<{ isOwner: boolean; canTrade: boolean }>({ isOwner: false, canTrade: false });

export function ViewerProvider({
  isOwner,
  canTrade,
  children,
}: {
  isOwner: boolean;
  canTrade: boolean;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ isOwner, canTrade }}>{children}</Ctx.Provider>;
}

export function useIsOwner(): boolean {
  return useContext(Ctx).isOwner;
}

/** May this viewer place or cancel orders? */
export function useCanTrade(): boolean {
  return useContext(Ctx).canTrade;
}
