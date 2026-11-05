import { WECHAT_BACKUP_SLOT_ID, WECHAT_SAVE_SLOT_ID } from './WechatSaveStoragePort';

export interface WechatResources {
  readonly snapshot: unknown;
  readonly schemas: Record<string, unknown>;
  readonly buildId: string;
}

export interface CandidateIdentity {
  readonly schema: 'wechat-candidate/v1';
  readonly candidate_id: string;
  readonly source_commit: string;
  readonly short_commit: string;
  readonly version: string;
  readonly build_id: string;
}

export interface WechatHost {
  hasSession(): boolean;
  destroySession(): void;
  requireSession(): { getViewModel(): { readonly time_label: string } };
}

export interface WechatCommandResult {
  readonly command_result: {
    readonly status: string;
    readonly error_message?: string | null;
    readonly snapshot?: {
      readonly menu?: { readonly last_action_result?: { readonly success: boolean } | null };
      readonly save_load?: {
        readonly last_save_result?: { readonly slot_id: string } | null;
        readonly last_load_result?: { readonly slot_id: string } | null;
      };
    };
  };
}

export type WechatCommand =
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'advance_time'; readonly minutes: 60 } }
  | { readonly name: 'save'; readonly selection: { readonly slot_id: string } }
  | { readonly name: 'load'; readonly selection: { readonly slot_id: string } };

export interface WechatBinding {
  mount(): Promise<WechatCommandResult>;
  execute(command: WechatCommand): Promise<WechatCommandResult>;
  unmount(): Promise<unknown>;
}

export interface WechatProbeSnapshot {
  readonly phase: 'idle' | 'loading' | 'ready' | 'failed' | 'closed';
  readonly identity: Readonly<CandidateIdentity> | null;
  readonly has_session: boolean;
  readonly time_label: string | null;
  readonly busy: boolean;
  readonly visible: boolean;
  readonly accepted_commands: number;
  readonly completed_commands: number;
  readonly last_error: string | null;
}

export function readCandidateIdentity(value: unknown): Readonly<CandidateIdentity> {
  if (!value || typeof value !== 'object') throw new Error('ERR_WECHAT_CANDIDATE_INVALID');
  const item = value as Record<string, unknown>;
  if (item.schema !== 'wechat-candidate/v1'
      || typeof item.candidate_id !== 'string' || !/^wechat-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(item.candidate_id)
      || typeof item.source_commit !== 'string' || !/^[a-f\d]{40}$/i.test(item.source_commit)
      || item.short_commit !== item.source_commit.slice(0, 12)
      || typeof item.version !== 'string' || !/^v\d+\.\d+\.\d+\.\d+$/.test(item.version)
      || typeof item.build_id !== 'string' || !item.build_id.startsWith('cocos_wechat_probe_')) {
    throw new Error('ERR_WECHAT_CANDIDATE_INVALID');
  }
  // Copy only the build identity. SaveFile fields and later caller mutations have no authority here.
  return Object.freeze({ schema: 'wechat-candidate/v1', candidate_id: item.candidate_id,
    source_commit: item.source_commit, short_commit: item.short_commit as string,
    version: item.version, build_id: item.build_id });
}

export class WechatProbeController {
  private phase: WechatProbeSnapshot['phase'] = 'idle';
  private identity: Readonly<CandidateIdentity> | null = null;
  private host: WechatHost | null = null;
  private binding: WechatBinding | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private disposed = false;
  private busy = false;
  private visible = true;
  private accepted = 0;
  private completed = 0;
  private error: string | null = null;

  constructor(private readonly options: {
    load: () => Promise<{ resources: WechatResources; identity: unknown }>;
    createHost: (resources: WechatResources) => WechatHost;
    createBinding: (host: WechatHost) => WechatBinding;
    prepareBackupRecovery?: () => Promise<void>;
    recoverValidatedBackup?: () => Promise<void>;
    cancelFirstFailedSave?: () => Promise<void>;
    onChange?: (snapshot: WechatProbeSnapshot) => void;
  }) {}

  snapshot(): WechatProbeSnapshot {
    const hasSession = this.host?.hasSession() ?? false;
    return Object.freeze({ phase: this.phase, identity: this.identity, has_session: hasSession,
      time_label: hasSession ? this.host!.requireSession().getViewModel().time_label : null,
      busy: this.busy, visible: this.visible, accepted_commands: this.accepted, completed_commands: this.completed,
      last_error: this.error });
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('ERR_WECHAT_PROBE_CLOSED'));
    if (this.starting !== null) return this.starting;
    this.starting = this.startInternal();
    return this.starting;
  }

  async advance(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  }

  async save(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'save', selection: { slot_id: WECHAT_SAVE_SLOT_ID } });
  }

  async load(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'load', selection: { slot_id: WECHAT_SAVE_SLOT_ID } });
  }

  async loadBackup(): Promise<WechatProbeSnapshot> {
    if (!this.options.prepareBackupRecovery || !this.options.recoverValidatedBackup) {
      throw new Error('ERR_WECHAT_BACKUP_RECOVERY_UNAVAILABLE');
    }
    return this.execute({ name: 'load', selection: { slot_id: WECHAT_BACKUP_SLOT_ID } });
  }

  async cancelFirstFailedSave(): Promise<WechatProbeSnapshot> {
    if (!this.options.cancelFirstFailedSave) throw new Error('ERR_WECHAT_FIRST_CANCEL_UNAVAILABLE');
    if (this.disposed || this.phase !== 'ready' || this.binding === null) throw new Error('ERR_WECHAT_PROBE_NOT_READY');
    if (!this.visible) throw new Error('ERR_WECHAT_PROBE_HIDDEN');
    if (this.busy) throw new Error('ERR_WECHAT_PROBE_BUSY');
    this.busy = true;
    this.accepted++;
    this.error = null;
    this.notify();
    try {
      if (this.disposed) return this.snapshot();
      await this.options.cancelFirstFailedSave();
      if (!this.disposed) this.completed++;
    } catch (error) {
      if (!this.disposed) this.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (!this.disposed) { this.busy = false; this.notify(); }
    }
    return this.snapshot();
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.notify();
  }

  private async execute(command: WechatCommand): Promise<WechatProbeSnapshot> {
    if (this.disposed || this.phase !== 'ready' || this.binding === null) throw new Error('ERR_WECHAT_PROBE_NOT_READY');
    if (!this.visible) throw new Error('ERR_WECHAT_PROBE_HIDDEN');
    if (this.busy) throw new Error('ERR_WECHAT_PROBE_BUSY');
    this.busy = true;
    this.accepted++;
    this.error = null;
    this.notify();
    const backupRecovery = command.name === 'load' && command.selection.slot_id === WECHAT_BACKUP_SLOT_ID;
    let recovered = false;
    try {
      if (backupRecovery) {
        await this.options.prepareBackupRecovery!();
        if (this.disposed) return this.snapshot();
        try {
          await this.options.recoverValidatedBackup!();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`ERR_WECHAT_BACKUP_RECOVERY_INCOMPLETE:${reason}`);
        }
        recovered = true;
        if (this.disposed) return this.snapshot();
      }
      const actualCommand: WechatCommand = backupRecovery
        ? { name: 'load', selection: { slot_id: WECHAT_SAVE_SLOT_ID } } : command;
      const result = await this.binding.execute(actualCommand);
      const current = result.command_result;
      const success = actualCommand.name === 'menu_confirm'
        ? current.snapshot?.menu?.last_action_result?.success === true
        : actualCommand.name === 'save'
          ? current.snapshot?.save_load?.last_save_result?.slot_id === actualCommand.selection.slot_id
          : current.snapshot?.save_load?.last_load_result?.slot_id === actualCommand.selection.slot_id;
      if (!this.disposed && (current.status !== 'completed' || !success)) {
        throw new Error(current.error_message ?? (actualCommand.name === 'menu_confirm'
          ? 'ERR_WECHAT_PROBE_ACTION_FAILED' : 'ERR_WECHAT_PROBE_STORAGE_FAILED'));
      }
      if (!this.disposed) this.completed++;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = recovered ? new Error(`ERR_WECHAT_BACKUP_RESTORED_RESULT_UNCERTAIN:${reason}`) : error;
      if (!this.disposed) this.error = result instanceof Error ? result.message : String(result);
      throw result;
    } finally {
      if (!this.disposed) { this.busy = false; this.notify(); }
    }
    return this.snapshot();
  }

  dispose(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.disposed = true;
    this.phase = 'closed';
    this.busy = false;
    const binding = this.binding;
    const host = this.host;
    this.binding = null;
    this.host = null;
    this.notify();
    this.closing = Promise.resolve().then(async () => {
      try { await binding?.unmount(); }
      finally { host?.destroySession(); }
    });
    return this.closing;
  }

  private async startInternal(): Promise<void> {
    this.phase = 'loading';
    this.notify();
    try {
      const loaded = await this.options.load();
      if (this.disposed) return;
      this.identity = readCandidateIdentity(loaded.identity);
      if (loaded.resources.buildId !== this.identity.build_id) throw new Error('ERR_WECHAT_CANDIDATE_BUILD_ID');
      const host = this.options.createHost(loaded.resources);
      if (this.disposed) { host.destroySession(); return; }
      this.host = host;
      const binding = this.options.createBinding(host);
      if (this.disposed) { await binding.unmount(); host.destroySession(); return; }
      this.binding = binding;
      const result = await binding.mount();
      if (this.disposed) return;
      if (result.command_result.status !== 'completed' || !host.hasSession()) throw new Error('ERR_WECHAT_PROBE_MOUNT_FAILED');
      this.phase = 'ready';
      this.notify();
    } catch (error) {
      if (this.disposed) return;
      const binding = this.binding;
      this.binding = null;
      try { await binding?.unmount(); }
      catch { /* Preserve the startup error while still destroying the half-initialized host. */ }
      finally { this.host?.destroySession(); this.host = null; }
      if (this.disposed) return;
      this.phase = 'failed';
      this.error = error instanceof Error ? error.message : String(error);
      this.notify();
      throw error;
    }
  }

  private notify(): void { this.options.onChange?.(this.snapshot()); }
}
