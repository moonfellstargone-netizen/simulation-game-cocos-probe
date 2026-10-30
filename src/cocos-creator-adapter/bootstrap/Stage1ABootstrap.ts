import {
  ConfigRepository,
  RuntimeContractValidator,
  RuntimeSchemaValidator,
  type RuntimeConfigSnapshot,
  type SaveStoragePort
} from '../../game-core';
import { CocosSessionHost } from '../CocosSessionHost';

export interface Stage1ABootstrapResources {
  snapshot: RuntimeConfigSnapshot;
  schemas: Record<string, unknown>;
  storage: SaveStoragePort;
  buildId: string;
  nowIso8601: string;
}

// The returned host already owns a validated session; do not call Probe.onLoad on it.
export function createStage1AHost(input: Stage1ABootstrapResources): CocosSessionHost {
  assertInput(input);
  const schemaIds = assertSchemaResources(input.snapshot.schema_paths, input.schemas);
  const schemas = RuntimeSchemaValidator.fromSnapshotSchemas(input.schemas);
  schemas.assertSchemasAvailable(schemaIds);
  const contracts = new RuntimeContractValidator(schemas);
  contracts.assertReady();

  const configs = new ConfigRepository(input.snapshot);
  const stage = configs.loadStage1A();
  if (stage.stageId !== 'stage_1A') throw new Error(`ERR_BOOTSTRAP_STAGE_UNSUPPORTED:${stage.stageId}`);
  const host = new CocosSessionHost(configs, contracts, input.storage, {
    buildId: input.buildId,
    nowIso8601: input.nowIso8601
  });
  host.createSession();
  return host;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertInput(input: Stage1ABootstrapResources): void {
  if (!isRecord(input) || !isRecord(input.snapshot) || !isRecord(input.schemas)) {
    throw new Error('ERR_BOOTSTRAP_RESOURCE_INVALID:input');
  }
  const snapshot = input.snapshot;
  for (const field of ['snapshot_id', 'source_formal_design_version', 'source_config_profile', 'source_config_hash_sha256'] as const) {
    if (typeof snapshot[field] !== 'string' || !snapshot[field].trim()) {
      throw new Error(`ERR_BOOTSTRAP_RESOURCE_INVALID:snapshot.${field}`);
    }
  }
  if (!isRecord(snapshot.loaded_documents)) throw new Error('ERR_BOOTSTRAP_RESOURCE_INVALID:loaded_documents');
  if (!Array.isArray(snapshot.schema_paths) || snapshot.schema_paths.length === 0) {
    throw new Error('ERR_BOOTSTRAP_RESOURCE_INVALID:schema_paths');
  }
  if (!isRecord(input.storage) || typeof input.storage.read !== 'function' || typeof input.storage.write !== 'function') {
    throw new Error('ERR_BOOTSTRAP_RESOURCE_INVALID:storage');
  }
  if (typeof input.buildId !== 'string' || !input.buildId.trim()) throw new Error('ERR_BOOTSTRAP_RESOURCE_INVALID:buildId');
  if (!isValidStartupTimestamp(input.nowIso8601)) {
    throw new Error('ERR_BOOTSTRAP_RESOURCE_INVALID:nowIso8601');
  }
}

function isValidStartupTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && Number(parts[4]) <= 23 && Number(parts[5]) <= 59 && Number(parts[6]) <= 59
    && (parts[7] === undefined || Number(parts[7]) <= 23)
    && (parts[8] === undefined || Number(parts[8]) <= 59)
    && Number.isFinite(Date.parse(value));
}

function assertSchemaResources(paths: readonly string[], schemas: Record<string, unknown>): string[] {
  const declared = new Set<string>();
  for (const path of paths) {
    if (typeof path !== 'string' || !path.startsWith('schemas/') || !path.endsWith('.schema.json')
      || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`ERR_BOOTSTRAP_SCHEMA_PATH_INVALID:${String(path)}`);
    }
    if (declared.has(path)) throw new Error(`ERR_BOOTSTRAP_SCHEMA_PATH_DUPLICATE:${path}`);
    declared.add(path);
    if (!Object.prototype.hasOwnProperty.call(schemas, path)) throw new Error(`ERR_BOOTSTRAP_SCHEMA_MISSING:${path}`);
  }
  for (const path of Object.keys(schemas)) {
    if (!declared.has(path)) throw new Error(`ERR_BOOTSTRAP_SCHEMA_UNDECLARED:${path}`);
  }

  const schemaIds = new Set<string>();
  for (const path of paths) {
    const schema = schemas[path];
    if (!isRecord(schema) || typeof schema.$id !== 'string' || !schema.$id.trim()) {
      throw new Error(`ERR_BOOTSTRAP_SCHEMA_INVALID:${path}`);
    }
    if (schemaIds.has(schema.$id)) throw new Error(`ERR_BOOTSTRAP_SCHEMA_ID_DUPLICATE:${schema.$id}`);
    schemaIds.add(schema.$id);
  }
  for (const path of paths) {
    if ((schemas[path] as Record<string, unknown>).$id !== path.split('/').at(-1)) {
      throw new Error(`ERR_BOOTSTRAP_SCHEMA_ID_MISMATCH:${path}`);
    }
  }
  return [...schemaIds];
}
