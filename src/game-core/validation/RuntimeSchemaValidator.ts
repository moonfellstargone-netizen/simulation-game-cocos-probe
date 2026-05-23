import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';

export interface RuntimeSchemaValidationErrorDetail {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
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
  private readonly ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true
  });

  private readonly validators = new Map<string, ValidateFunction>();

  constructor(schemas: Record<string, unknown>) {
    for (const [path, schema] of Object.entries(schemas)) {
      this.addSchema(path, schema);
    }
  }

  static fromSnapshotSchemas(schemas: Record<string, unknown>): RuntimeSchemaValidator {
    return new RuntimeSchemaValidator(schemas);
  }

  assertValid<T>(schemaId: string, value: T): T {
    const validate = this.getValidator(schemaId);
    const ok = validate(value);
    if (!ok) {
      throw new RuntimeSchemaValidationError(schemaId, this.normalizeErrors(validate.errors));
    }
    return value;
  }

  validate(schemaId: string, value: unknown): { ok: true } | { ok: false; errors: RuntimeSchemaValidationErrorDetail[] } {
    const validate = this.getValidator(schemaId);
    const ok = validate(value);
    if (ok) return { ok: true };
    return { ok: false, errors: this.normalizeErrors(validate.errors) };
  }

  private addSchema(path: string, schema: unknown): void {
    if (!schema || typeof schema !== 'object') return;
    const record = schema as { $id?: string };
    const id = record.$id ?? this.basename(path);
    if (!this.ajv.getSchema(id)) {
      this.ajv.addSchema(schema, id);
    }
  }

  private getValidator(schemaId: string): ValidateFunction {
    const aliases = [schemaId, this.basename(schemaId)];
    for (const alias of aliases) {
      const cached = this.validators.get(alias);
      if (cached) return cached;
      const compiled = this.ajv.getSchema(alias);
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
