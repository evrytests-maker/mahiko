import type { MaHiKoApi } from "../shared/contracts";

declare global {
  interface Window {
    maHiKo?: MaHiKoApi;
  }
}

export {};

