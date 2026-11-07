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

export interface WechatQuantity { readonly amount: number; readonly unit: string }
export interface WechatFieldOption { readonly id: string; readonly definition_id: string; readonly enabled: boolean; readonly occupied_tiles: number; readonly active_crop_count: number }
export interface WechatMaterialOption {
  readonly id: string; readonly enabled: boolean; readonly base_id: string; readonly current_form: string;
  readonly quantity: WechatQuantity;
  readonly storage_ref: { readonly location_id: string; readonly storage_type: string; readonly container_id: string };
}
export interface WechatCropOption { readonly id: string; readonly enabled: boolean; readonly crop_base_id: string; readonly field_plot_id: string }
export interface WechatStorageOption {
  readonly id: string; readonly enabled: boolean; readonly location_id: string; readonly storage_type: string;
  readonly capacity: WechatQuantity; readonly used_capacity: number; readonly supported_forms: readonly string[];
}
export interface WechatMenuSnapshot {
  readonly view_model: { readonly time_label: string } | null;
  readonly selectable_view_model: {
    readonly field_options: readonly WechatFieldOption[];
    readonly seed_lot_options: readonly WechatMaterialOption[];
    readonly harvestable_crop_options: readonly WechatCropOption[];
    readonly splittable_lot_options: readonly WechatMaterialOption[];
    readonly storage_target_options: readonly WechatStorageOption[];
  } | null;
}

// Copy only the public fields needed by this screen. No platform clone API or SaveFile is used.
function copyMenu(value: WechatMenuSnapshot): WechatMenuSnapshot {
  const s = value.selectable_view_model;
  const material = (item: WechatMaterialOption): WechatMaterialOption => ({ id: item.id, enabled: item.enabled,
    base_id: item.base_id, current_form: item.current_form, quantity: { amount: item.quantity.amount, unit: item.quantity.unit },
    storage_ref: { location_id: item.storage_ref.location_id, storage_type: item.storage_ref.storage_type, container_id: item.storage_ref.container_id } });
  return { view_model: value.view_model ? { time_label: value.view_model.time_label } : null,
    selectable_view_model: s ? {
      field_options: s.field_options.map(item => ({ id: item.id, definition_id: item.definition_id, enabled: item.enabled, occupied_tiles: item.occupied_tiles, active_crop_count: item.active_crop_count })),
      seed_lot_options: s.seed_lot_options.map(material),
      harvestable_crop_options: s.harvestable_crop_options.map(item => ({ id: item.id, enabled: item.enabled, crop_base_id: item.crop_base_id, field_plot_id: item.field_plot_id })),
      splittable_lot_options: s.splittable_lot_options.map(material),
      storage_target_options: s.storage_target_options.map(item => ({ id: item.id, enabled: item.enabled, location_id: item.location_id,
        storage_type: item.storage_type, capacity: { amount: item.capacity.amount, unit: item.capacity.unit }, used_capacity: item.used_capacity,
        supported_forms: [...item.supported_forms] }))
    } : null };
}

export interface WechatCommandResult {
  readonly command_result: {
    readonly command_name?: string;
    readonly status: string;
    readonly error_message?: string | null;
    readonly snapshot?: {
      readonly menu?: {
        readonly last_preview_result?: { readonly action_type: string; readonly success: boolean; readonly status_code: string } | null;
        readonly last_split_validation_result?: { readonly action_type: string; readonly success: boolean; readonly status_code: string } | null;
        readonly last_action_result?: { readonly success: boolean; readonly status_code?: string; readonly created_objects?: readonly { readonly object_type: string; readonly object_id: string }[]; readonly updated_objects?: readonly { readonly object_type: string; readonly object_id: string }[] } | null;
      };
      readonly save_load?: {
        readonly last_save_result?: { readonly slot_id: string } | null;
        readonly last_load_result?: { readonly slot_id: string } | null;
      };
    };
  };
}

export type WechatCommand =
  | { readonly name: 'menu_preview' | 'menu_confirm_split_direct'; readonly selection: { readonly action_type: 'split_lot'; readonly source_lot_option_id: string; readonly quantity: WechatQuantity } }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'advance_time'; readonly minutes: 60 | 1440 } }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'plant_crop'; readonly field_option_id: string; readonly seed_lot_option_id: string; readonly seed_quantity: WechatQuantity } }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'harvest_crop'; readonly crop_option_id: string } }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'store_item'; readonly source_lot_option_id: string; readonly target_storage_option_id: string } }
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
  readonly menu: WechatMenuSnapshot | null;
  readonly split_preview: WechatSplitPreview | null;
  readonly split_result: WechatSplitResult | null;
}

export interface WechatSplitPreview { readonly sourceLotId: string; readonly quantity: WechatQuantity; readonly success: boolean; readonly statusCode: string }
export interface WechatSplitResult { readonly sourceLotId: string; readonly newLotId: string; readonly quantity: WechatQuantity; readonly remainingQuantity: WechatQuantity | null }

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
  private menu: WechatMenuSnapshot | null = null;
  private splitGeneration = 0;
  private splitPreview: WechatSplitPreview | null = null;
  private splitResult: WechatSplitResult | null = null;
  private splitCommandInFlight: 'preview' | 'confirm' | null = null;

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
      last_error: this.error, menu: this.menu ? copyMenu(this.menu) : null,
      split_preview: this.splitPreview ? { ...this.splitPreview, quantity: { ...this.splitPreview.quantity } } : null,
      split_result: this.splitResult ? { ...this.splitResult, quantity: { ...this.splitResult.quantity }, remainingQuantity: this.splitResult.remainingQuantity ? { ...this.splitResult.remainingQuantity } : null } : null });
  }

  acceptMenuPatch(value: unknown): void {
    if (this.disposed) return;
    if (!value || typeof value !== 'object') throw new Error('ERR_WECHAT_MENU_PATCH_INVALID');
    const next = copyMenu(value as WechatMenuSnapshot);
    // A preview can emit its own identical menu patch before its receipt. Changed
    // public state invalidates the pending receipt; confirmation itself changes it.
    if (this.splitCommandInFlight !== 'confirm' && JSON.stringify(this.menu) !== JSON.stringify(next)) {
      this.invalidateSplitPreview();
    }
    this.menu = next;
    this.notify();
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

  async advanceDay(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } });
  }

  async plant(fieldId: string, seedId: string, quantity: WechatQuantity): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'plant_crop', field_option_id: fieldId,
      seed_lot_option_id: seedId, seed_quantity: { amount: quantity.amount, unit: quantity.unit } } });
  }

  async harvest(cropId: string): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: cropId } });
  }

  async move(lotId: string, targetId: string): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'store_item', source_lot_option_id: lotId, target_storage_option_id: targetId } });
  }

  invalidateSplitPreview(): void {
    this.splitGeneration++;
    this.splitPreview = null;
    this.splitResult = null;
    if (!this.disposed) this.notify();
  }

  async previewSplit(lotId: string, quantity: WechatQuantity): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_preview', selection: { action_type: 'split_lot', source_lot_option_id: lotId,
      quantity: { amount: quantity.amount, unit: quantity.unit } } });
  }

  async confirmSplit(lotId: string, quantity: WechatQuantity): Promise<WechatProbeSnapshot> {
    const lot = this.menu?.selectable_view_model?.splittable_lot_options.find(item => item.id === lotId && item.enabled);
    if (!lot || !quantity || !Number.isFinite(quantity.amount) || quantity.amount <= 0 || quantity.unit !== lot.quantity.unit) {
      throw new Error('ERR_WECHAT_SPLIT_INPUT_INVALID');
    }
    return this.execute({ name: 'menu_confirm_split_direct', selection: { action_type: 'split_lot', source_lot_option_id: lotId,
      quantity: { amount: quantity.amount, unit: quantity.unit } } });
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
    this.invalidateSplitPreview();
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
    if (!visible) this.invalidateSplitPreview();
    this.notify();
  }

  private async execute(command: WechatCommand): Promise<WechatProbeSnapshot> {
    if (this.disposed || this.phase !== 'ready' || this.binding === null) throw new Error('ERR_WECHAT_PROBE_NOT_READY');
    if (!this.visible) throw new Error('ERR_WECHAT_PROBE_HIDDEN');
    if (this.busy) throw new Error('ERR_WECHAT_PROBE_BUSY');
    const splitBefore = command.name === 'menu_confirm_split_direct'
      ? this.menu?.selectable_view_model?.splittable_lot_options ?? [] : [];
    this.busy = true;
    this.invalidateSplitPreview();
    const splitGeneration = this.splitGeneration;
    this.splitCommandInFlight = (command.name === 'menu_preview' || command.name === 'menu_confirm_split_direct') && command.selection.action_type === 'split_lot'
      ? (command.name === 'menu_preview' ? 'preview' : 'confirm') : null;
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
      let result: WechatCommandResult;
      try {
        result = await this.binding.execute(actualCommand);
      } catch (error) {
        if (actualCommand.name === 'menu_confirm_split_direct') {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`ERR_WECHAT_SPLIT_RESULT_UNCERTAIN:${reason}`);
        }
        throw error;
      }
      const current = result.command_result;
      const preview = current.snapshot?.menu?.last_preview_result;
      const previewValid = preview?.action_type === 'split_lot' && typeof preview.success === 'boolean'
        && typeof preview.status_code === 'string' && preview.status_code.length > 0;
      if (!this.disposed && actualCommand.name === 'menu_confirm_split_direct') {
        // A failed shell command can occur after dispatch; it does not prove rollback.
        const validation = current.snapshot?.menu?.last_split_validation_result;
        const validationValid = validation?.action_type === 'split_lot' && typeof validation.success === 'boolean'
          && typeof validation.status_code === 'string' && validation.status_code.length > 0;
        if (current.status !== 'completed' || current.command_name !== actualCommand.name || !validationValid) {
          throw new Error(`ERR_WECHAT_SPLIT_RESULT_UNCERTAIN${current.error_message ? `:${current.error_message}` : ''}`);
        }
        const action = current.snapshot?.menu?.last_action_result;
        if (!validation!.success) {
          // A definite rejection must come from the pre-dispatch validator, with no action result.
          if (action !== null) throw new Error('ERR_WECHAT_SPLIT_RESULT_UNCERTAIN');
          throw new Error(`ERR_WECHAT_PROBE_ACTION_FAILED:${validation!.status_code}`);
        }
        if (action?.success === false) {
          // Post-dispatch checks can fail even after the transaction committed.
          throw new Error('ERR_WECHAT_SPLIT_RESULT_UNCERTAIN');
        }
        const selection = actualCommand.selection;
        const ids = action?.created_objects?.filter(item => item.object_type === 'MaterialLot') ?? [];
        const lots = this.menu?.selectable_view_model?.splittable_lot_options ?? [];
        const created = ids.length === 1 ? lots.find(item => item.id === ids[0].object_id) : undefined;
        const source = lots.find(item => item.id === selection.source_lot_option_id);
        const oldSource = splitBefore.find(item => item.id === selection.source_lot_option_id);
        const sourceUpdated = action?.updated_objects?.filter(item => item.object_type === 'MaterialLot'
          && item.object_id === selection.source_lot_option_id) ?? [];
        const remaining = oldSource ? oldSource.quantity.amount - selection.quantity.amount : NaN;
        if (action?.success !== true || !created || created.id === selection.source_lot_option_id
            || !oldSource || splitBefore.some(item => item.id === created.id) || sourceUpdated.length !== 1
            || created.quantity.amount !== selection.quantity.amount || created.quantity.unit !== selection.quantity.unit
            || created.base_id !== oldSource.base_id || created.current_form !== oldSource.current_form
            || created.storage_ref.container_id !== oldSource.storage_ref.container_id
            || (remaining === 0 ? !!source : !source || source.quantity.amount !== remaining || source.quantity.unit !== oldSource.quantity.unit)) {
          throw new Error('ERR_WECHAT_SPLIT_RESULT_UNCERTAIN');
        }
        this.completed++;
        if (splitGeneration === this.splitGeneration && this.visible) {
          this.splitResult = { sourceLotId: selection.source_lot_option_id, newLotId: created.id,
            quantity: { ...created.quantity }, remainingQuantity: source ? { ...source.quantity } : null };
        }
      }
      if (actualCommand.name !== 'menu_confirm_split_direct') {
        const success = actualCommand.name === 'menu_preview'
          ? previewValid && current.command_name === actualCommand.name
          : actualCommand.name === 'menu_confirm'
            ? current.snapshot?.menu?.last_action_result?.success === true
            : actualCommand.name === 'save'
              ? current.snapshot?.save_load?.last_save_result?.slot_id === actualCommand.selection.slot_id
              : actualCommand.name === 'load' && current.snapshot?.save_load?.last_load_result?.slot_id === actualCommand.selection.slot_id;
        if (!this.disposed && (current.status !== 'completed' || !success)) {
          throw new Error(current.error_message ?? (actualCommand.name === 'menu_confirm'
            ? 'ERR_WECHAT_PROBE_ACTION_FAILED' : actualCommand.name === 'menu_preview'
              ? 'ERR_WECHAT_PROBE_PREVIEW_FAILED' : 'ERR_WECHAT_PROBE_STORAGE_FAILED'));
        }
        if (!this.disposed) {
          this.completed++;
          if (actualCommand.name === 'menu_preview' && splitGeneration === this.splitGeneration && this.visible && previewValid) {
            const selection = actualCommand.selection;
            this.splitPreview = { sourceLotId: selection.source_lot_option_id, quantity: { ...selection.quantity },
              success: preview!.success, statusCode: preview!.status_code };
          }
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = recovered ? new Error(`ERR_WECHAT_BACKUP_RESTORED_RESULT_UNCERTAIN:${reason}`) : error;
      if (!this.disposed) this.error = result instanceof Error ? result.message : String(result);
      throw result;
    } finally {
      this.splitCommandInFlight = null;
      if (!this.disposed) { this.busy = false; this.notify(); }
    }
    return this.snapshot();
  }

  dispose(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.disposed = true;
    this.invalidateSplitPreview();
    this.menu = null;
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
