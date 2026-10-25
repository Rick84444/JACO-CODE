import React, { createContext, useContext, useEffect, useState } from 'react';

// UI language is deliberately independent from the language used by model prompts.
// English is the default for public distribution; the operator can always select Swedish.
export type UiLanguage = 'en' | 'sv';
export const UI_LANGUAGE_STORAGE_KEY = 'jaco:aura:ui-language:v1';

interface UiLanguageContextValue {
  language: UiLanguage;
  setLanguage: (next: UiLanguage) => void;
  tr: (swedish: string, english: string) => string;
}

const UiLanguageContext = createContext<UiLanguageContextValue | null>(null);

function initialLanguage(): UiLanguage {
  try {
    return window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY) === 'sv' ? 'sv' : 'en';
  } catch {
    return 'en';
  }
}

export function UiLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<UiLanguage>(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    try { window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language); } catch { /* Storage can be unavailable. */ }
  }, [language]);

  return <UiLanguageContext.Provider value={{
    language, setLanguage,
    tr: (swedish, english) => language === 'sv' ? swedish : english,
  }}>{children}</UiLanguageContext.Provider>;
}

export function useUiLanguage(): UiLanguageContextValue {
  const context = useContext(UiLanguageContext);
  if (!context) throw new Error('UiLanguageProvider is missing');
  return context;
}
