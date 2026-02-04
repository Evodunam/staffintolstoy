import { useEffect, useRef } from 'react';
import { useAuth } from './use-auth';
import { useProfile } from './use-profiles';
import { changeLanguage, SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/i18n';
import { apiRequest } from '@/lib/queryClient';

/**
 * Hook to initialize language from user choice, profile, or device settings.
 * Priority: localStorage (user's explicit choice) > profile > device detection.
 * This ensures manual language changes are never overwritten on reload.
 */
export function useLanguageInit() {
  const { user, isAuthenticated } = useAuth();
  const { data: profile } = useProfile(isAuthenticated ? user?.id : undefined);
  const hasInitialized = useRef(false);
  const isSavingLanguage = useRef(false);

  useEffect(() => {
    // Only initialize once per session
    if (hasInitialized.current) return;
    
    // Priority 1: localStorage - user's explicit choice (e.g. just changed language)
    // This must take precedence so manual changes persist after page reload
    const savedLang = localStorage.getItem('tolstoy_language') as LanguageCode | null;
    if (savedLang && SUPPORTED_LANGUAGES.some(l => l.code === savedLang)) {
      changeLanguage(savedLang);
      hasInitialized.current = true;
      // Sync to profile if authenticated (don't block)
      if (isAuthenticated && user?.id && profile?.id && profile.language !== savedLang) {
        apiRequest('PUT', `/api/profiles/${profile.id}`, { language: savedLang })
          .catch((err) => console.error('[Language] Failed to sync to profile:', err));
      }
      return;
    }
    
    // Wait for auth to load for profile-based init
    if (!isAuthenticated || !user?.id) {
      // No saved language - use device detection for unauthenticated users
      const deviceLang = (navigator.language || navigator.languages?.[0] || 'en').split('-')[0] as LanguageCode;
      const detectedLang = SUPPORTED_LANGUAGES.some(l => l.code === deviceLang) ? deviceLang : 'en';
      changeLanguage(detectedLang);
      hasInitialized.current = true;
      return;
    }

    // Wait for profile to load
    if (!profile) return;

    // Priority 2: profile has a language preference
    if (profile.language && SUPPORTED_LANGUAGES.some(l => l.code === profile.language)) {
      const profileLang = profile.language as LanguageCode;
      changeLanguage(profileLang);
      localStorage.setItem('tolstoy_language', profileLang);
      hasInitialized.current = true;
      return;
    }

    // Priority 3: no preference anywhere - detect device and save (only once)
    if (!isSavingLanguage.current) {
      isSavingLanguage.current = true;
      const deviceLang = (navigator.language || navigator.languages?.[0] || 'en').split('-')[0] as LanguageCode;
      const detectedLang = SUPPORTED_LANGUAGES.some(l => l.code === deviceLang) ? deviceLang : 'en';
      
      changeLanguage(detectedLang);
      apiRequest('PUT', `/api/profiles/${profile.id}`, { language: detectedLang })
        .then(() => console.log(`[Language] Auto-detected and saved: ${detectedLang}`))
        .catch((err) => console.error('[Language] Failed to save to profile:', err))
        .finally(() => {
          isSavingLanguage.current = false;
          hasInitialized.current = true;
        });
    }
  }, [isAuthenticated, user?.id, profile]);
}
