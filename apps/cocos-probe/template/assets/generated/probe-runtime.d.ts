// Narrow consumer types for the generated public facade, not a second runtime implementation.
import type { ProbeBinding, ProbeHost, ProbeResources } from '../scripts/ProbeLifetime';

export function createStage1AHost(input: ProbeResources & {
  storage: InMemorySaveStoragePort;
  nowIso8601: string;
}): ProbeHost;

export class InMemorySaveStoragePort {
  read(slotId: string): Promise<string | null>;
  write(slotId: string, serializedSave: string): Promise<void>;
}

export class QinglanUiSceneProbeComponent implements ProbeBinding {
  constructor(host: ProbeHost, port: { applyNodeBindingPatch(patch: {
    readonly section: string;
    readonly target: string;
    readonly payload: unknown;
  }): void | Promise<void> });
  mount(): ReturnType<ProbeBinding['mount']>;
  execute(command: Parameters<ProbeBinding['execute']>[0]): ReturnType<ProbeBinding['execute']>;
  unmount(): Promise<unknown>;
}
