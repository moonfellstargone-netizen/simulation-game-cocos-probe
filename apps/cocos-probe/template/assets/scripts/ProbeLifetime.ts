export interface ProbeResources {
  readonly snapshot: unknown;
  readonly schemas: Record<string, unknown>;
  readonly buildId: string;
}

export interface ProbeHost {
  hasSession(): boolean;
  destroySession(): void;
  requireSession(): { getViewModel(): { time_label: string } };
}

export type ProbeCommand =
  | { name: 'menu_confirm'; selection: { action_type: 'advance_time'; minutes: number } }
  | { name: 'save' | 'load'; selection: { slot_id: string } };

// Narrow observations of the public component result, never the mutable runtime state.
export interface ProbeCommandResult {
  readonly command_result: {
    readonly status: string;
    readonly error_message?: string | null;
    readonly snapshot?: {
      readonly save_load?: {
        readonly last_save_result?: { readonly slot_id: string; readonly world_minute: number } | null;
        readonly last_load_result?: { readonly slot_id: string; readonly world_minute: number } | null;
      };
    };
  };
}

export interface ProbeBinding {
  mount(): Promise<ProbeCommandResult>;
  execute(command: ProbeCommand): Promise<ProbeCommandResult>;
  unmount(): Promise<unknown>;
}

export type ProbePhase = 'idle' | 'loading' | 'ready' | 'failed' | 'closing' | 'closed';

export interface ProbeLifetimeOptions {
  loadResources(): Promise<ProbeResources>;
  createHost(resources: ProbeResources): ProbeHost;
  createBinding(host: ProbeHost): ProbeBinding;
  onPhase?(phase: ProbePhase): void;
  onError?(error: unknown): void;
}

// This outer coordinator owns startup/disposal, never game state or engine nodes.
export class ProbeLifetime {
  private phase: ProbePhase = 'idle';
  private disposed = false;
  private host: ProbeHost | null = null;
  private binding: ProbeBinding | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;

  constructor(private readonly options: ProbeLifetimeOptions) {}

  start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.starting !== null) return this.starting;
    const pending = this.startInternal();
    this.starting = pending;
    void pending.catch(() => {
      if (this.starting === pending) this.starting = null;
    });
    return pending;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  status(): { phase: ProbePhase; hasSession: boolean; timeLabel: string | null } {
    return {
      phase: this.phase,
      hasSession: this.host?.hasSession() ?? false,
      timeLabel: this.host?.hasSession() ? this.host.requireSession().getViewModel().time_label : null
    };
  }

  async execute(command: ProbeCommand): Promise<ProbeCommandResult> {
    if (this.disposed || this.phase !== 'ready' || this.binding === null) {
      throw new Error('ERR_COCOS_PROBE_NOT_READY');
    }
    return await this.binding.execute(command);
  }

  dispose(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.disposed = true;
    this.setPhase('closing');
    const binding = this.binding;
    const host = this.host;
    this.binding = null;
    this.closing = Promise.resolve().then(async () => {
      try {
        if (binding !== null) await binding.unmount();
      } finally {
        host?.destroySession();
        this.host = null;
        this.setPhase('closed');
      }
    });
    return this.closing;
  }

  private async startInternal(): Promise<void> {
    this.setPhase('loading');
    try {
      const resources = await this.options.loadResources();
      if (this.disposed) return;
      const host = this.options.createHost(resources);
      // A synchronous external factory may itself trigger component disposal.
      if (this.disposed) {
        host.destroySession();
        return;
      }
      this.host = host;
      const binding = this.options.createBinding(host);
      if (this.disposed) return;
      this.binding = binding;
      const mounted = await binding.mount();
      if (this.disposed) return;
      if (mounted.command_result.status !== 'completed') throw new Error('ERR_COCOS_PROBE_MOUNT_FAILED');
      this.setPhase('ready');
    } catch (error) {
      if (this.disposed) return;
      this.host?.destroySession();
      this.host = null;
      this.binding = null;
      this.setPhase('failed');
      this.options.onError?.(error);
      throw error;
    }
  }

  private setPhase(phase: ProbePhase): void {
    this.phase = phase;
    this.options.onPhase?.(phase);
  }
}
