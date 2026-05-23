import type { ConfigRepository, RuntimeContractValidator, SaveStoragePort } from '../game-core';
import { CocosAppRuntimeSession, type CocosAppRuntimeSessionOptions } from '../cocos-app/runtime/CocosAppRuntimeSession';

export interface CocosSessionHostOptions extends CocosAppRuntimeSessionOptions {}

export class CocosSessionHost {
  private session: CocosAppRuntimeSession | null = null;

  constructor(
    private readonly configs: ConfigRepository,
    private readonly contracts: RuntimeContractValidator,
    private readonly storage: SaveStoragePort,
    private readonly options: CocosSessionHostOptions = {}
  ) {}

  createSession(): CocosAppRuntimeSession {
    if (this.session !== null) throw new Error('ERR_COCOS_SESSION_ALREADY_CREATED');
    this.session = new CocosAppRuntimeSession(this.configs, this.contracts, this.storage, this.options);
    return this.session;
  }

  requireSession(): CocosAppRuntimeSession {
    if (this.session === null) throw new Error('ERR_COCOS_SESSION_NOT_CREATED');
    return this.session;
  }

  hasSession(): boolean {
    return this.session !== null;
  }

  destroySession(): void {
    this.session = null;
  }
}
