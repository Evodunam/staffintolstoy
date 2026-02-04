import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from '../locales/en.json';
import es from '../locales/es.json';
import zh from '../locales/zh.json';
import pt from '../locales/pt.json';
import fr from '../locales/fr.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

// Helper function to extract namespaces from translation object
function extractNamespaces(translations: any): Record<string, any> {
  const namespaces: Record<string, any> = { translation: translations };
  
  // Extract all top-level keys that are objects as separate namespaces
  for (const key in translations) {
    if (translations.hasOwnProperty(key) && 
        typeof translations[key] === 'object' && 
        translations[key] !== null &&
        !Array.isArray(translations[key])) {
      namespaces[key] = translations[key];
    }
  }
  
  return namespaces;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: extractNamespaces(en),
      es: extractNamespaces(es),
      zh: extractNamespaces(zh),
      pt: extractNamespaces(pt),
      fr: extractNamespaces(fr),
    },
    defaultNS: 'translation',
    fallbackLng: 'en',
    lng: localStorage.getItem('tolstoy_language') || undefined, // Explicitly set initial language
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false, // Disable suspense to ensure immediate re-renders
      bindI18n: 'languageChanged loaded', // Re-render on these events
      bindI18nStore: 'added removed',
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'tolstoy_language',
    },
  });

export default i18n;

export async function changeLanguage(lang: LanguageCode, profileId?: number) {
  try {
    console.log(`[i18n] Changing language to: ${lang}`);
    
    // Store in localStorage FIRST (before changing i18n)
    localStorage.setItem('tolstoy_language', lang);
    
    // Change language in i18n (this triggers re-renders)
    await i18n.changeLanguage(lang);
    
    // Update HTML lang attribute for accessibility
    document.documentElement.lang = lang;
    
    // Force a re-render by emitting the languageChanged event again
    // This ensures all components using useTranslation re-render
    i18n.emit('languageChanged', lang);
    
    console.log(`[i18n] Language changed successfully to: ${lang}`);
    console.log(`[i18n] Current i18n.language:`, i18n.language);
    console.log(`[i18n] localStorage value:`, localStorage.getItem('tolstoy_language'));
    
    // Optionally save to user profile if profileId is provided
    if (profileId) {
      try {
        const response = await fetch(`/api/profiles/${profileId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: lang }),
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error(`Failed to save language: ${response.statusText}`);
        }
        
        console.log(`[i18n] Language preference saved to profile ${profileId}`);
      } catch (err) {
        console.error('[i18n] Failed to save language to profile:', err);
        // Don't throw - language is still set in localStorage and i18n
      }
    }
    
    return true;
  } catch (error) {
    console.error('[i18n] Failed to change language:', error);
    throw error; // Re-throw to let caller handle it
  }
}

export function getCurrentLanguage(): LanguageCode {
  const lang = i18n.language?.split('-')[0] as LanguageCode;
  return SUPPORTED_LANGUAGES.some(l => l.code === lang) ? lang : 'en';
}
