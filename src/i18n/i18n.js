import i18n from "i18next";
import {initReactI18next} from "react-i18next";
import translationEN from "./locales/en/translation.json";
import translationZH from "./locales/zh/translation.json";
import matchHistoryEN from "./locales/en/matchHistory.json";
import matchHistoryZH from "./locales/zh/matchHistory.json";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: translationEN,
        mh: matchHistoryEN
      },
      zh: {
        translation: translationZH,
        mh: matchHistoryZH
      }
    },
    lng: 'zh',
    fallbackLng: "en",
    interpolation: {
      escapeValue: false
    }
  });

export function translate(key) {
  return i18n.t(key);
}

export default i18n;
