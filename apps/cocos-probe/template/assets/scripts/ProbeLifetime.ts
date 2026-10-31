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
  | { name: 'menu_confirm'; selection:
    | { action_type: 'advance_time'; minutes: number }
    | { action_type: 'plant_crop'; field_option_id: string; seed_lot_option_id: string; seed_quantity: ProbeQuantity }
    | { action_type: 'harvest_crop'; crop_option_id: string }
    | { action_type: 'store_item'; source_lot_option_id: string; target_storage_option_id: string } }
  | { name: 'save'; selection: { slot_id: string } }
  | { name: 'load'; selection: { slot_id: string } };

export interface ProbeQuantity {
  readonly amount: number;
  readonly unit: string;
}

export interface ProbeFieldOption {
  readonly id: string;
  readonly definition_id: string;
  readonly enabled: boolean;
  readonly label_key: string | null;
  readonly occupied_tiles: number;
  readonly active_crop_count: number;
}

export interface ProbeMaterialOption {
  readonly id: string;
  readonly enabled: boolean;
  readonly label_key: string | null;
  readonly base_id: string;
  readonly category: string;
  readonly current_form: string;
  readonly quantity: ProbeQuantity;
  readonly storage_ref: ProbeStorageRef;
  readonly reason_key?: string | null;
  readonly active_reservation_count?: number;
}

export interface ProbeStorageRef {
  readonly location_id: string;
  readonly storage_type: string;
  readonly container_id: string;
}

export interface ProbeStorageTargetOption {
  readonly id: string;
  readonly enabled: boolean;
  readonly label_key: string | null;
  readonly reason_key: string | null;
  readonly location_id: string;
  readonly storage_type: string;
  readonly capacity: ProbeQuantity;
  readonly used_capacity: number;
  readonly supported_forms: readonly string[];
}

export interface ProbeHarvestableOption {
  readonly id: string;
  readonly enabled: boolean;
  readonly label_key: string | null;
  readonly crop_base_id: string;
  readonly field_plot_id: string;
}

export interface ProbeBusinessResult {
  readonly success: boolean;
  readonly status_code: string;
  readonly message_key: string;
  readonly message_params: readonly { readonly key: string; readonly value: string | number | boolean | null }[];
}

export interface ProbeMenuSnapshot {
  readonly view_model?: { readonly time_label: string } | null;
  readonly selectable_view_model?: {
    readonly field_options: readonly ProbeFieldOption[];
    readonly seed_lot_options: readonly ProbeMaterialOption[];
    readonly harvestable_crop_options: readonly ProbeHarvestableOption[];
    readonly splittable_lot_options: readonly ProbeMaterialOption[];
    readonly storage_target_options: readonly ProbeStorageTargetOption[];
  } | null;
  readonly last_preview_result?: (ProbeBusinessResult & { readonly action_type: string }) | null;
  readonly last_action_result?: (ProbeBusinessResult & {
    readonly request_id: string;
    readonly created_objects: readonly {
      readonly object_type: string;
      readonly object_id: string;
      readonly summary?: { readonly quantity?: ProbeQuantity } | null;
    }[];
  }) | null;
}

// Narrow observations of the public component result, never the mutable runtime state.
export interface ProbeCommandResult {
  readonly command_result: {
    readonly command_name?: string;
    readonly status: string;
    readonly error_message?: string | null;
    readonly snapshot?: {
      readonly menu?: ProbeMenuSnapshot;
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
