import type OpenAI from 'openai';
import type { PlantIdentifier, PlantIdentificationResult } from './types';

const SYSTEM_PROMPT = `You identify plants in photos and return JSON only.
Return this shape:
{
  "scientific_name": "Genus species" or null,
  "common_name_en": "English common name" or null,
  "confidence": 0.0-1.0
}

Rules:
- scientific_name must be the binomial Latin name (Genus species), or null if you cannot identify.
- common_name_en must be a single English common name, or null.
- confidence must be a number in [0, 1]. Use confidence < 0.5 if uncertain.
- Identify the dominant plant in the photo. If multiple species are visible, pick the most prominent.
- Be conservative — return null/low-confidence rather than guessing.`;

export class MistralPlantIdentifier implements PlantIdentifier {
  constructor(private readonly openai: OpenAI, private readonly model: string) {}

  async identify(image: Uint8Array, mimeType: string): Promise<PlantIdentificationResult> {
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${Buffer.from(image).toString('base64')}`;

    const completion = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Identify the dominant plant in this photo.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Mistral returned an empty response');

    const parsed = JSON.parse(content) as Record<string, unknown>;
    const scientificName = typeof parsed.scientific_name === 'string' && parsed.scientific_name.trim().length > 0
      ? parsed.scientific_name.trim()
      : null;
    const commonName = typeof parsed.common_name_en === 'string' && parsed.common_name_en.trim().length > 0
      ? parsed.common_name_en.trim()
      : null;
    const confidence = typeof parsed.confidence === 'number' && !Number.isNaN(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : null;

    return { scientificName, commonName, confidence, source: 'mistral', raw: parsed };
  }
}
