import type { FormFoxField, FormFoxProfile } from "../types";
import { findMatchingField, getLabelTextForElement, normalizeText } from "./fieldMatcher";

function dispatchInputEvents(el: HTMLElement) {
  try {
    el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    // `blur` иногда нужен для валидации/пересчётов.
    el.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));
  } catch (err) {
    console.error("[FormFox] dispatchInputEvents error:", err);
  }
}

function setTextLikeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  // Важно: React/прочие контролы часто читают `.value` и слушают `input`/`change`.
  el.value = value;
  dispatchInputEvents(el);
}

function setSelectValue(el: HTMLSelectElement, value: string) {
  const valueNorm = normalizeText(value);

  const options = Array.from(el.options);
  const matched =
    options.find((o) => normalizeText(o.textContent || "") === valueNorm) ||
    options.find((o) => normalizeText(o.value || "") === valueNorm) ||
    options.find((o) => normalizeText(o.textContent || "").includes(valueNorm)) ||
    options.find((o) => normalizeText(o.value || "").includes(valueNorm)) ||
    null;

  if (matched) {
    el.value = matched.value;
  } else {
    // Если не нашли совпадение — пробуем прямую установку по value.
    el.value = value;
  }

  dispatchInputEvents(el);
}

function setRadioCheckboxGroupValue(
  representative: HTMLInputElement,
  profileField: FormFoxField,
  root: Document | HTMLElement
) {
  const type = (representative.type || "").toLowerCase();
  const groupName = representative.name;
  if (!groupName) return;

  const groupSelector = `input[type="${type}"][name="${CSS.escape(groupName)}"]`;
  const groupEls = Array.from(root.querySelectorAll<HTMLInputElement>(groupSelector));
  if (groupEls.length === 0) return;

  const valueNorm = normalizeText(profileField.value);

  let chosen: HTMLInputElement | null = null;

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

  // Для radio выбираем один. Для checkbox — включаем выбранный, остальные выключаем (MVP-поведение).
  for (const el of groupEls) {
    const shouldCheck = chosen ? el === chosen : false;
    if (el.checked !== shouldCheck) el.checked = shouldCheck;
  }

  if (chosen) dispatchInputEvents(chosen);
}

function fillOneField(profileField: FormFoxField, doc: Document) {
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

    // input (text/email/tel/number/...).
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

  // Фоллбэк: если вдруг нашли что-то другое, пытаемся записать в `.value`.
  const anyEl = matched as unknown as { value?: string };
  if (typeof anyEl.value === "string") {
    anyEl.value = value;
    dispatchInputEvents(matched);
  }
}

/**
 * Заполняет форму на текущей странице по профилю.
 *
 * Требование: для React/Vue формы генерируем input/change/blur события.
 */
export async function fillFormWithProfile(profile: FormFoxProfile, doc: Document) {
  console.info(`[FormFox] Начинаю fillFormWithProfile для "${profile.name}"`);

  // В MVP: просто последовательно заполняем все поля.
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

