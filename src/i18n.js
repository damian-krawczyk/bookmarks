// Interface translations. Each language is one flat JSON file in src/locales/
// (key → text, "{name}" placeholders). Plurals use Intl.PluralRules categories as
// key suffixes: "count.bookmarks.one", ".few", ".many", ".other"; ask for
// t("count.bookmarks", { count }) and the right form is chosen.
// To add a language, copy en.json to <code>.json, translate it and rebuild.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.I18n = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PLURALS = ["zero", "one", "two", "few", "many", "other"];

  function create(locales, fallback = "en") {
    let lang = fallback;
    const listeners = [];

    function lookup(key, l) {
      const dict = locales[l] || {};
      return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined;
    }

    function t(key, params = {}) {
      let text;
      if (typeof params.count === "number") {
        let cat = "other";
        try { cat = new Intl.PluralRules(lang).select(params.count); } catch (_) { /* unknown locale */ }
        text = lookup(`${key}.${cat}`, lang) ?? lookup(`${key}.other`, lang) ?? lookup(`${key}.other`, fallback);
      }
      text = text ?? lookup(key, lang) ?? lookup(key, fallback) ?? key;
      return text.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
    }

    // The best available language for a list like navigator.languages.
    function pick(preferred) {
      for (const p of [].concat(preferred || [])) {
        const code = String(p).toLowerCase();
        if (locales[code]) return code;
        const base = code.split("-")[0];
        if (locales[base]) return base;
      }
      return fallback;
    }

    function setLang(l) {
      if (!locales[l]) l = fallback;
      lang = l;
      listeners.forEach((fn) => fn(lang));
    }

    // Fill elements marked data-i18n="key" (text) and data-i18n-title / -placeholder / -aria-label.
    function apply(rootEl) {
      for (const el of rootEl.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
      for (const a of ["title", "placeholder", "aria-label"]) {
        const ds = "i18n" + a.replace(/(^|-)(\w)/g, (m, d, c) => c.toUpperCase());
        for (const el of rootEl.querySelectorAll(`[data-i18n-${a}]`)) el.setAttribute(a, t(el.dataset[ds]));
      }
    }

    const languages = () => Object.keys(locales).sort().map((code) => ({ code, name: (locales[code] || {})._name || code }));

    return { t, pick, setLang, apply, languages, get lang() { return lang; }, onChange: (fn) => listeners.push(fn) };
  }

  // Keys without their plural suffix, to compare languages that have different plural forms.
  function baseKeys(dict) {
    const out = new Set();
    for (const k of Object.keys(dict)) {
      const parts = k.split(".");
      out.add(PLURALS.includes(parts[parts.length - 1]) && parts.length > 1 ? parts.slice(0, -1).join(".") : k);
    }
    return out;
  }

  return { create, baseKeys, PLURALS };
});
