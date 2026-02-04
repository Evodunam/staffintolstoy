import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, changeLanguage, LanguageCode } from '@/lib/i18n';
import { useProfile } from '@/hooks/use-profiles';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Globe, Loader2 } from 'lucide-react';

interface LanguageSelectorProps {
  showLabel?: boolean;
  className?: string;
}

export function LanguageSelector({ showLabel = true, className = '' }: LanguageSelectorProps) {
  const { t, i18n } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const { data: profile } = useProfile(isAuthenticated ? user?.id : undefined);
  const { toast } = useToast();
  const [isChanging, setIsChanging] = useState(false);
  
  // Use i18n.language directly so React re-renders when language changes
  const currentLang = (i18n.language?.split('-')[0] || 'en') as LanguageCode;
  const validLang = SUPPORTED_LANGUAGES.some(l => l.code === currentLang) ? currentLang : 'en';

  const handleChange = async (value: string) => {
    if (isChanging) return;
    
    setIsChanging(true);
    try {
      // Save to profile when manually changed (if authenticated)
      await changeLanguage(value as LanguageCode, profile?.id);
      
      const langName = SUPPORTED_LANGUAGES.find(l => l.code === value)?.nativeName || value;
      toast({
        title: t('settings.languageChanged') || 'Language Changed',
        description: `${t('settings.languageChangedTo') || 'Language changed to'} ${langName}`,
      });
      
      // Reload page after a short delay to apply all translations
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('Failed to change language:', error);
      toast({
        title: t('common.error') || 'Error',
        description: t('settings.languageChangeFailed') || 'Failed to change language. Please try again.',
        variant: 'destructive',
      });
      setIsChanging(false);
    }
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {showLabel && (
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-muted-foreground" />
          <span className="font-medium">{t('settings.language')}</span>
        </div>
      )}
      <Select value={validLang} onValueChange={handleChange} disabled={isChanging}>
        <SelectTrigger 
          className="w-[180px]" 
          data-testid="select-language"
        >
          <SelectValue>
            {isChanging ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('common.saving') || 'Saving...'}
              </span>
            ) : (
              SUPPORTED_LANGUAGES.find(l => l.code === validLang)?.nativeName || 'English'
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem 
              key={lang.code} 
              value={lang.code}
              data-testid={`select-language-${lang.code}`}
            >
              <span className="flex items-center gap-2">
                <span>{lang.flag}</span>
                <span>{lang.nativeName}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function LanguageSelectorCompact() {
  const { i18n, t } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const { data: profile } = useProfile(isAuthenticated ? user?.id : undefined);
  const { toast } = useToast();
  const [isChanging, setIsChanging] = useState(false);
  
  // Use i18n.language directly so React re-renders when language changes
  const currentLang = (i18n.language?.split('-')[0] || 'en') as LanguageCode;
  const validLang = SUPPORTED_LANGUAGES.some(l => l.code === currentLang) ? currentLang : 'en';
  const currentLanguage = SUPPORTED_LANGUAGES.find(l => l.code === validLang);

  const handleChange = async (value: string) => {
    if (isChanging) return;
    
    setIsChanging(true);
    try {
      // Save to profile when manually changed (if authenticated)
      await changeLanguage(value as LanguageCode, profile?.id);
      
      const langName = SUPPORTED_LANGUAGES.find(l => l.code === value)?.nativeName || value;
      toast({
        title: t('settings.languageChanged') || 'Language Changed',
        description: `${t('settings.languageChangedTo') || 'Language changed to'} ${langName}`,
      });
      
      // Reload page after a short delay to apply all translations
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('Failed to change language:', error);
      toast({
        title: t('common.error') || 'Error',
        description: t('settings.languageChangeFailed') || 'Failed to change language. Please try again.',
        variant: 'destructive',
      });
      setIsChanging(false);
    }
  };

  return (
    <Select value={validLang} onValueChange={handleChange} disabled={isChanging}>
      <SelectTrigger 
        className="w-auto gap-2 border-0 bg-transparent hover:bg-muted/50"
        data-testid="select-language-compact"
      >
        {isChanging ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <Globe className="w-4 h-4" />
            <span className="text-sm">{currentLanguage?.flag} {currentLanguage?.code.toUpperCase()}</span>
          </>
        )}
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <SelectItem 
            key={lang.code} 
            value={lang.code}
            data-testid={`select-language-compact-${lang.code}`}
          >
            <span className="flex items-center gap-2">
              <span>{lang.flag}</span>
              <span>{lang.nativeName}</span>
              <span className="text-muted-foreground text-xs">({lang.name})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
