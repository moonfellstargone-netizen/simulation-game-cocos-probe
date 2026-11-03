import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';

export interface RuntimeSchemaValidationErrorDetail {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
}

export interface PrecompiledSchemaValidatorSet {
  readonly format: 'runtime-precompiled-schemas/v1';
  readonly schemaSources: Readonly<Record<string, string>>;
  readonly validators: Readonly<Record<string, ValidateFunction>>;
}

export class RuntimeSchemaValidationError extends Error {
  constructor(
    readonly schemaId: string,
    readonly details: RuntimeSchemaValidationErrorDetail[]
  ) {
    super(`ERR_SCHEMA_VALIDATION_FAILED:${schemaId}:${details.map((item) => item.instancePath || '/').join(',')}`);
  }
}

export class RuntimeSchemaValidator {
  private readonly ajv: Ajv2020 | null;

  private readonly validators = new Map<string, ValidateFunction>();

  constructor(schemas: Record<string, unknown>, precompiledValidators?: PrecompiledSchemaValidatorSet) {
    if (precompiledValidators !== undefined) {
      this.ajv = null;
      this.addPrecompiledSchemas(schemas, precompiledValidators);
    } else {
      this.ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
      for (const [path, schema] of Object.entries(schemas)) this.addSchema(path, schema);
    }
  }

  static fromSnapshotSchemas(schemas: Record<string, unknown>, precompiledValidators?: PrecompiledSchemaValidatorSet): RuntimeSchemaValidator {
    return new RuntimeSchemaValidator(schemas, precompiledValidators);
  }

  assertSchemasAvailable(schemaIds: readonly string[]): void {
    for (const schemaId of schemaIds) this.getValidator(schemaId);
  }

  assertValid<T>(schemaId: string, value: T): T {
    const validate = this.getValidator(schemaId);
    const ok = validate(value);
    this.assertSynchronousResult(schemaId, ok);
    if (!ok) {
      throw new RuntimeSchemaValidationError(schemaId, this.normalizeErrors(validate.errors));
    }
    return value;
  }

  validate(schemaId: string, value: unknown): { ok: true } | { ok: false; errors: RuntimeSchemaValidationErrorDetail[] } {
    const validate = this.getValidator(schemaId);
    const ok = validate(value);
    this.assertSynchronousResult(schemaId, ok);
    if (ok) return { ok: true };
    return { ok: false, errors: this.normalizeErrors(validate.errors) };
  }

  private addSchema(path: string, schema: unknown): void {
    if (!schema || typeof schema !== 'object') return;
    const record = schema as { $id?: string };
    const id = record.$id ?? this.basename(path);
    if (!this.ajv!.getSchema(id)) {
      this.ajv!.addSchema(schema, id);
    }
  }

  private addPrecompiledSchemas(schemas: Record<string, unknown>, set: PrecompiledSchemaValidatorSet): void {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!isRecord(schemas) || !isRecord(set) || set.format !== 'runtime-precompiled-schemas/v1'
        || !isRecord(set.schemaSources) || !isRecord(set.validators)) {
      throw new Error('ERR_PRECOMPILED_SCHEMA_SET_INVALID');
    }
    const paths = Object.keys(schemas).sort();
    if (JSON.stringify(paths) !== JSON.stringify(Object.keys(set.schemaSources).sort())) {
      throw new Error('ERR_PRECOMPILED_SCHEMA_SOURCES_MISMATCH');
    }
    const ids = new Set<string>();
    for (const path of paths) {
      const schema = schemas[path];
      if (!isRecord(schema) || typeof schema.$id !== 'string' || !schema.$id.trim()) {
        throw new Error('ERR_PRECOMPILED_SCHEMA_ID_INVALID:' + path);
      }
      if (ids.has(schema.$id)) throw new Error('ERR_PRECOMPILED_SCHEMA_ID_DUPLICATE:' + schema.$id);
      ids.add(schema.$id);
      if (typeof set.schemaSources[path] !== 'string' || set.schemaSources[path] !== JSON.stringify(schema)) {
        throw new Error('ERR_PRECOMPILED_SCHEMA_SOURCE_MISMATCH:' + path);
      }
    }
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(Object.keys(set.validators).sort())) {
      throw new Error('ERR_PRECOMPILED_SCHEMA_VALIDATORS_MISMATCH');
    }
    for (const id of ids) {
      const validate = set.validators[id];
      if (typeof validate !== 'function' || (validate as ValidateFunction & { $async?: unknown }).$async === true
          || Object.prototype.toString.call(validate) === '[object AsyncFunction]') {
        throw new Error('ERR_PRECOMPILED_SCHEMA_VALIDATOR_INVALID:' + id);
      }
      this.validators.set(id, validate);
    }
  }

  private assertSynchronousResult(schemaId: string, result: unknown): void {
    if (this.ajv === null && typeof result !== 'boolean') {
      throw new Error('ERR_PRECOMPILED_SCHEMA_RESULT_INVALID:' + schemaId);
    }
  }

  private getValidator(schemaId: string): ValidateFunction {
    const aliases = [schemaId, this.basename(schemaId)];
    for (const alias of aliases) {
      const cached = this.validators.get(alias);
      if (cached) return cached;
      const compiled = this.ajv?.getSchema(alias);
      if (compiled) {
        this.validators.set(alias, compiled);
        return compiled;
      }
    }
    throw new Error(`ERR_RUNTIME_SCHEMA_NOT_LOADED:${schemaId}`);
  }

  private normalizeErrors(errors: ErrorObject[] | null | undefined): RuntimeSchemaValidationErrorDetail[] {
    return (errors ?? []).map((error) => ({
      instancePath: error.instancePath,
      schemaPath: error.schemaPath,
      keyword: error.keyword,
      message: error.message ?? 'schema validation error'
    }));
  }

  private basename(path: string): string {
    return path.split('/').at(-1) ?? path;
  }
}
