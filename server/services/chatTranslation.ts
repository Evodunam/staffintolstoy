import { v2 as translateV2 } from "@google-cloud/translate";

const SUPPORTED_CHAT_LANGUAGES = new Set(["en", "es", "zh", "pt", "fr"]);
const TRANSLATABLE_MAX_LENGTH = 5000;

let translateClient: translateV2.Translate | null = null;

function getTranslateClient(): translateV2.Translate {
  if (translateClient) return translateClient;
  const config: { key?: string; projectId?: string } = {};
  if (process.env.GOOGLE_TRANSLATE_API_KEY?.trim()) {
    config.key = process.env.GOOGLE_TRANSLATE_API_KEY.trim();
  }
  if (process.env.GOOGLE_CLOUD_PROJECT_ID?.trim()) {
    config.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID.trim();
  }
  translateClient = new translateV2.Translate(config);
  return translateClient;
}

export function normalizeLanguageCode(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const base = input.trim().toLowerCase().split("-")[0];
  if (!base || !SUPPORTED_CHAT_LANGUAGES.has(base)) return undefined;
  return base;
}

export async function translateChatText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  if (!text.trim()) return text;
  if (text.length > TRANSLATABLE_MAX_LENGTH) return text;

  const source = normalizeLanguageCode(sourceLanguage);
  const target = normalizeLanguageCode(targetLanguage);
  if (!source || !target || source === target) return text;

  try {
    const client = getTranslateClient();
    const [translated] = await client.translate(text, {
      from: source,
      to: target,
    });
    if (Array.isArray(translated)) return translated[0] || text;
    return translated || text;
  } catch (error) {
    console.error("[ChatTranslation] Translation failed:", error);
    return text;
  }
}
