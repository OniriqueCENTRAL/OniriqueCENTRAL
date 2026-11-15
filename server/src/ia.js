// L'IA du serveur, partagée par ROCKY (rocky.js) et la traduction automatique des fiches (traductions.js) :
// Gemini (GEMINI_API_KEY, offre gratuite de Google) d'abord, sinon Claude (ANTHROPIC_API_KEY).
import { config } from './config.js';

export const iaReady = () => Boolean(config.geminiApiKey || config.anthropicApiKey);

/** Le texte répondu par l'IA, ou null (pas de clé, réseau, refus, réponse vide). messages : [{ role, content }]. */
export async function askIA({ system, messages, maxTokens = 400, timeout = 30_000 }) {
  const gemini = Boolean(config.geminiApiKey);
  if (!gemini && !config.anthropicApiKey) return null;
  const r = await fetch(gemini
    ? `${config.geminiApi}/v1beta/models/${config.geminiModel}:generateContent`
    : `${config.anthropicApi}/v1/messages`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeout),
    headers: gemini
      ? { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey }
      : { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(gemini
      ? { systemInstruction: { parts: [{ text: system }] }, generationConfig: { maxOutputTokens: Math.max(2048, maxTokens) },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }
      : { model: config.rockyModel, max_tokens: maxTokens, system, messages }),
  }).catch(() => null);
  const data = r && (await r.json().catch(() => null));
  const blocks = gemini ? data?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought) : data?.content?.filter((b) => b.type === 'text');
  const text = blocks?.map((b) => b.text || '').join('').trim();
  if (!r?.ok || !text) {
    console.error('IA :', r?.status, data?.error?.message);
    return null;
  }
  return text;
}
