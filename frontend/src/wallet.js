import { createAccount } from "genlayer-js";

export const walletState = {
  mode: "none",
  address: null,
  ephemeral: null,
};

export function injectedProvider() {
  if (typeof window === "undefined") return null;
  return window.ethereum || null;
}

export async function connectInjected() {
  const provider = injectedProvider();
  if (!provider) return null;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts || accounts.length === 0) return null;
  walletState.mode = "injected";
  walletState.address = accounts[0];
  walletState.ephemeral = null;
  return accounts[0];
}

export function connectEphemeral() {
  const account = createAccount();
  walletState.mode = "ephemeral";
  walletState.address = account.address;
  walletState.ephemeral = account;
  return account;
}

export function disconnect() {
  walletState.mode = "none";
  walletState.address = null;
  walletState.ephemeral = null;
}
