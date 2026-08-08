import type { MahikoApi } from "../shared/contracts";

declare global {
  interface Window {
    mahiko?: MahikoApi;
  }
}

export {};
