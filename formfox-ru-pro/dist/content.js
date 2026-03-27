(() => {
  "use strict";

  const ACTIVE_KEY = "__activeProfile";

  // =========================
  //  Поиск полей и заполнение
  // =========================

  function normalizeText(input) {
    return (input ?? "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getLabelTextForElement(el) {
    try {
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        const id = el.id;
        if (id) {
          const lbl = el.ownerDocument.querySelector(
            `label[for="${CSS.escape(id)}"]`
          );
          if (lbl && lbl.textContent) return lbl.textContent;
        }
      }

      const closestLabel = el.closest && el.closest("label");
      if (closestLabel && closestLabel.textContent) return closestLabel.textContent;

      const prev = el.previousElementSibling;
      if (prev && prev.textContent && prev.textContent.trim().length > 0) return prev.textContent;

      return "";
    } catch {
      return "";
    }
  }

  function getElementTerms(el) {
    const terms = [];
    const anyEl = el;
    if (anyEl.id) terms.push(anyEl.id);
    if (anyEl && anyEl.name) terms.push(anyEl.name);

    if (el instanceof HTMLInputElement) {
      if (el.type) terms.push(el.type);
      if (el.placeholder) terms.push(el.placeholder);
      const aria = el.getAttribute("aria-label");
      if (aria) terms.push(aria);
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.placeholder) terms.push(el.placeholder);
      const aria = el.getAttribute("aria-label");
      if (aria) terms.push(aria);
    } else if (el instanceof HTMLSelectElement) {
      const aria = el.getAttribute("aria-label");
      if (aria) terms.push(aria);
    }

    const labelText = getLabelTextForElement(el);
    if (labelText) terms.push(labelText);

    return terms.filter(Boolean);
  }

  function scoreTermAgainstKey(term, keyNorm) {
    const t = normalizeText(term);
    if (!t) return 0;
    if (t === keyNorm) return 100;
    if (t.includes(keyNorm)) return 60;
    if (keyNorm.includes(t) && t.length >= 3) return 40;
    return 0;
  }

  /**
   * Возвращает наиболее подходящий элемент для `profileField.key`.
   * Для radio/checkbox возвращаем "репрезентант" (конкретный input из группы),
   * но финальный выбор делаем по value внутри этой группы.
   */
  function findMatchingField(profileField, root = document) {
    const keyNorm = normalizeText(profileField.key);
    if (!keyNorm) return null;

    try {
      const candidates = Array.from(root.querySelectorAll("input, textarea, select")).filter((el) => {
        if (
          !(
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement
          )
        )
          return false;

        if (el instanceof HTMLInputElement) {
          const t = (el.type || "text").toLowerCase();
          return ![
            "hidden",
            "submit",
            "button",
            "image",
            "reset",
            "file",
            "range",
            "color",
          ].includes(t);
        }
        return true;
      });

      let best = null;

      for (const el of candidates) {
        const terms = getElementTerms(el);
        let bestLocalScore = 0;
        for (const term of terms) bestLocalScore = Math.max(bestLocalScore, scoreTermAgainstKey(term, keyNorm));
        if (bestLocalScore <= 0) continue;

        if (el instanceof HTMLInputElement) {
          const t = (el.type || "text").toLowerCase();
          if (["text", "email", "tel", "number", "search", "url", "password", "radio", "checkbox"].includes(t)) {
            bestLocalScore += 5;
          }
        }

        if (!best || bestLocalScore > best.score) {
          best = { el, score: bestLocalScore };
        }
      }

      return best?.el ?? null;
    } catch (err) {
      console.error("[FormFox] findMatchingField error:", err);
      return null;
    }
  }

  function dispatchInputEvents(el) {
    try {
      el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));
    } catch (err) {
      console.error("[FormFox] dispatchInputEvents error:", err);
    }
  }

  function setTextLikeValue(el, value) {
    el.value = value;
    dispatchInputEvents(el);
  }

  function setSelectValue(el, value) {
    const valueNorm = normalizeText(value);
    const options = Array.from(el.options);

    const matched =
      options.find((o) => normalizeText(o.textContent || "") === valueNorm) ||
      options.find((o) => normalizeText(o.value || "") === valueNorm) ||
      options.find((o) => normalizeText(o.textContent || "").includes(valueNorm)) ||
      options.find((o) => normalizeText(o.value || "").includes(valueNorm)) ||
      null;

    if (matched) el.value = matched.value;
    else el.value = value;

    dispatchInputEvents(el);
  }

  function setRadioCheckboxGroupValue(representative, profileField, root) {
    const type = (representative.type || "").toLowerCase();
    const groupName = representative.name;
    if (!groupName) return;

    const groupSelector = `input[type="${type}"][name="${CSS.escape(groupName)}"]`;
    const groupEls = Array.from(root.querySelectorAll(groupSelector));
    if (groupEls.length === 0) return;

    const valueNorm = normalizeText(profileField.value);

    let chosen = null;
    for (const el of groupEls) {
      const elValueNorm = normalizeText(el.value || "");
      const labelNorm = normalizeText(getLabelTextForElement(el));
      if (elValueNorm === valueNorm || labelNorm === valueNorm) {
        chosen = el;
        break;
      }
      if (elValueNorm && elValueNorm.includes(valueNorm)) chosen = el;
      if (!chosen && labelNorm && labelNorm.includes(valueNorm)) chosen = el;
    }

    for (const el of groupEls) {
      const shouldCheck = chosen ? el === chosen : false;
      if (el.checked !== shouldCheck) el.checked = shouldCheck;
    }

    if (chosen) dispatchInputEvents(chosen);
  }

  function fillOneField(profileField, doc) {
    const matched = findMatchingField(profileField, doc);
    if (!matched) {
      console.warn(`[FormFox] Не нашёл поле для ключа "${profileField.key}"`);
      return;
    }

    const value = profileField.value ?? "";
    const tag = matched.tagName.toLowerCase();

    if (matched instanceof HTMLInputElement) {
      const t = (matched.type || "text").toLowerCase();
      if (t === "radio" || t === "checkbox") {
        setRadioCheckboxGroupValue(matched, profileField, doc);
        return;
      }
      setTextLikeValue(matched, value);
      return;
    }

    if (tag === "textarea" && matched instanceof HTMLTextAreaElement) {
      setTextLikeValue(matched, value);
      return;
    }

    if (tag === "select" && matched instanceof HTMLSelectElement) {
      setSelectValue(matched, value);
      return;
    }

    const anyEl = matched;
    if (typeof anyEl.value === "string") {
      anyEl.value = value;
      dispatchInputEvents(matched);
    }
  }

  async function fillFormWithProfile(profile, doc) {
    // В MVP заполняем поля последовательно.
    // Если сайт рендерит DOM асинхронно, может потребоваться повторный клик.
    console.info(`[FormFox] Начинаю fillFormWithProfile для "${profile.name}"`);
    for (const field of profile.fields) {
      try {
        const key = field.key?.trim();
        if (!key) continue;
        fillOneField(field, doc);
      } catch (err) {
        console.error("[FormFox] Ошибка при заполнении поля:", field, err);
      }
    }
    console.info("[FormFox] fillFormWithProfile завершено.");
  }

  (async () => {
    try {
      const res = await chrome.storage.local.get({ [ACTIVE_KEY]: null });
      const profile = res[ACTIVE_KEY];
      if (!profile) {
        console.warn("[FormFox] Нет активного профиля в storage для заполнения.");
        return;
      }

      // На момент инъекции background уже записал выбранный профиль в storage.
      console.info(`[FormFox] Content script: заполняю форму "${profile.name}"`);

      await fillFormWithProfile(profile, document);
      await chrome.storage.local.remove([ACTIVE_KEY]);
      console.info("[FormFox] Content script: профиль очищен.");
    } catch (err) {
      console.error("[FormFox] Content script error:", err);
    }
  })();
})();

