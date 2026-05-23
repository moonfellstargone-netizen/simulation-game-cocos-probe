import type { SaveFile } from '../domain/types';

export interface SaveMigration {
  from: string;
  to: string;
  migrate(save: SaveFile): SaveFile;
}

export class SaveMigrationRegistry {
  private readonly migrations: SaveMigration[] = [];

  register(migration: SaveMigration): void {
    this.migrations.push(migration);
  }

  migrateToCurrent(save: SaveFile, currentSchemaVersion: string): SaveFile {
    let current = save;
    while (current.schema_version !== currentSchemaVersion) {
      const migration = this.migrations.find((item) => item.from === current.schema_version);
      if (!migration) throw new Error(`ERR_SAVE_MIGRATION_MISSING:${current.schema_version}->${currentSchemaVersion}`);
      current = migration.migrate(current);
    }
    return current;
  }
}
