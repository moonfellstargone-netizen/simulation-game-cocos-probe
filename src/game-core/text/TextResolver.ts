export class TextResolver {
  constructor(private readonly templates: Record<string, string> = {}) {}

  resolve(key: string, params: Record<string, unknown> = {}): string {
    const template = this.templates[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  }
}
