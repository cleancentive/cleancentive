import type { PlantIdentifier, PlantIdentificationResult } from './types';

export class ShadowPlantIdentifier implements PlantIdentifier {
  constructor(
    private readonly primary: PlantIdentifier,
    private readonly shadow: PlantIdentifier,
  ) {}

  async identify(image: Uint8Array, mimeType: string): Promise<PlantIdentificationResult> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.identify(image, mimeType),
      this.shadow.identify(image, mimeType),
    ]);

    if (primaryResult.status === 'rejected') {
      throw primaryResult.reason;
    }

    const primary = primaryResult.value;
    const shadow = shadowResult.status === 'fulfilled'
      ? shadowResult.value
      : { error: String(shadowResult.reason?.message ?? shadowResult.reason) };

    const shadowUsage = shadowResult.status === 'fulfilled' ? shadowResult.value.usage : undefined;

    return {
      ...primary,
      raw: { primary: primary.raw, shadow },
      // Whichever side went to a paid model, we still owe for it.
      usage: primary.usage ?? shadowUsage,
    };
  }
}
