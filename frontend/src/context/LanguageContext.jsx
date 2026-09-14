import { createContext, useContext, useState, useCallback } from 'react';
import { translate } from '../i18n';

const LanguageContext = createContext(null);

function initialLang() {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'ru' || saved === 'en') return saved;
  } catch { /* private mode / blocked storage */ }
  return 'ru';
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key) => translate(lang, key), [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  // Safe fallback if a component renders outside the provider (e.g. in a test).
  if (!ctx) return { lang: 'en', setLang: () => {}, t: (k) => translate('en', k) };
  return ctx;
}
