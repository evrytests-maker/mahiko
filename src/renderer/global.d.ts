import type { MohikoApi } from "../shared/contracts";

declare global {
  interface Window {
    mohiko?: MohikoApi;
  }
}

export {};
