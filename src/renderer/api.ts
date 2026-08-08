import type { MahikoApi } from "../shared/contracts";

if (!window.mahiko) throw new Error("Secure mahiko preload API is unavailable");

export const api: MahikoApi = window.mahiko;
export const isElectron = true;
