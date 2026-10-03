import Anthropic from '@anthropic-ai/sdk';
import { isValidValue } from '@kbg/domain';
import type { AttrValue } from '@kbg/domain';

export interface Suggestion { attr: string; value: AttrValue; confidence: number }

// Klucz tylko ze środowiska serwera; bez klucza AI jest po prostu niedostępne.
const MODEL = 'claude-haiku-4-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 30_000, maxRetries: 0 }) : null;

const ATTR_KEYS = ['surface', 'smoothness', 'tactile_paving', 'steps'] as const;

const field = (type: object) => ({
  type: 'object' as const,
  properties: { value: type, confidence: { type: 'number', description: '0..1' } },
  required: ['value', 'confidence'],
});
const TOOL: Anthropic.Tool = {
  name: 'report_pavement',
  description: 'Zgłoś cechy nawierzchni widoczne na zdjęciu chodnika lub przejścia. Użyj "unknown", gdy cechy nie da się ocenić.',
  input_schema: {
    type: 'object',
    properties: {
      surface: field({ type: 'string', enum: ['asphalt', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'concrete:plates', 'gravel', 'ground', 'grass', 'unknown'] }),
      smoothness: field({ type: 'string', enum: ['excellent', 'good', 'intermediate', 'bad', 'very_bad', 'unknown'] }),
      tactile_paving: field({ type: 'string', enum: ['yes', 'no', 'unknown'] }),
      steps: field({ type: 'string', enum: ['yes', 'no', 'unknown'] }),
    },
    required: [...ATTR_KEYS],
  },
};
const PROMPT = `Zdjęcie przedstawia fragment chodnika, przejścia dla pieszych lub drogi pieszej w Krakowie.
Oceń tylko to, co widać: rodzaj nawierzchni (sett = kostka granitowa, cobblestone = bruk, paving_stones = kostka betonowa, concrete:plates = płyty), jej gładkość, obecność pól uwagi (żółte lub ryflowane płyty z guzkami przed przejściem) i schodów.
Nie oceniaj wysokości krawężnika ani nachylenia. Przy wątpliwości wybierz "unknown".`;

/** Zamienia wejście narzędzia na sugestie; odrzuca wszystko, co nie przechodzi walidacji domeny. */
export function parseSuggestions(input: unknown): Suggestion[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const out: Suggestion[] = [];
  for (const attr of ATTR_KEYS) {
    if (!Object.hasOwn(input, attr)) continue;
    const raw = (input as Record<string, unknown>)[attr];
    if (!raw || typeof raw !== 'object') continue;
    const v = (raw as { value?: unknown }).value;
    if (typeof v !== 'string' || v === 'unknown') continue;
    const value: AttrValue = v === 'yes' ? true : v === 'no' ? false : v;
    if (!isValidValue(attr, value)) continue;
    const confidence = Math.max(0, Math.min(1, Number((raw as { confidence?: unknown }).confidence) || 0));
    out.push({ attr, value, confidence });
  }
  return out;
}

export async function classifyPhoto(jpeg: Buffer): Promise<Suggestion[] | null> {
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 400, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
        { type: 'text', text: PROMPT },
      ] }],
    });
    const use = res.content.find((b) => b.type === 'tool_use');
    return use && use.type === 'tool_use' ? parseSuggestions(use.input) : [];
  } catch (err) {
    console.error('AI niedostępne:', err instanceof Error ? err.message : err);
    return null;
  }
}
