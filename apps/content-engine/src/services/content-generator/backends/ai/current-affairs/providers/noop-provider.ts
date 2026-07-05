import type { FetchHintsParams, ICurrentAffairsProvider } from '../types.js';

export class NoopCurrentAffairsProvider implements ICurrentAffairsProvider {
  readonly name = 'noop';

  async fetchHints(_params: FetchHintsParams): Promise<string[]> {
    return [];
  }

  async refresh(): Promise<void> {
    return;
  }
}
