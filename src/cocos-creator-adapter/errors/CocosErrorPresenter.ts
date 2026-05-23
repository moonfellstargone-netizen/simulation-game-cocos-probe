export interface CocosPresentedError {
  code: string | null;
  message: string;
}

export class CocosErrorPresenter {
  present(error: unknown): CocosPresentedError {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.match(/ERR_[A-Z0-9_]+/)?.[0] ?? null;
    return { code, message };
  }
}
