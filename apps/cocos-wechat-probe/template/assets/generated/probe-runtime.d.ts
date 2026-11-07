// Narrow public runtime consumer types; implementations are generated from the repository's public entries.
import type { WechatBinding, WechatHost, WechatResources } from '../scripts/WechatProbeController';
import type { PriorValidationHost } from '../scripts/WechatPriorSaveValidator';

export function createStage1AHost(input: WechatResources & {
  storage: { read(slotId: string): Promise<string | null>; write(slotId: string, serializedSave: string): Promise<void> };
  nowIso8601: string;
}): WechatHost & PriorValidationHost;

export class InMemorySaveStoragePort {
  read(slotId: string): Promise<string | null>;
  write(slotId: string, serializedSave: string): Promise<void>;
}

export class QinglanUiSceneProbeComponent implements WechatBinding {
  constructor(host: WechatHost, port: { applyNodeBindingPatch(patch: {
    readonly section: string; readonly target: string; readonly payload: unknown;
  }): void | Promise<void> });
  mount(): ReturnType<WechatBinding['mount']>;
  execute(command: Parameters<WechatBinding['execute']>[0]): ReturnType<WechatBinding['execute']>;
  unmount(): Promise<unknown>;
}
