export type RpcMode = "rpc-ui" | "rpc";

export interface RpcStatus {
  ready: boolean;
  mode: RpcMode | null;
  protocolVersion: number | null;
  supportedProtocolVersions: number[];
  detail: string;
}

export interface RuntimeSnapshot {
  checkedAt: string;
  executable: string | null;
  expectedVersion: string;
  version: string | null;
  available: boolean;
  compatible: boolean;
  rpc: RpcStatus;
}

export interface MohikoApi {
  runtime: {
    getSnapshot(): Promise<RuntimeSnapshot>;
    refresh(): Promise<RuntimeSnapshot>;
  };
}
