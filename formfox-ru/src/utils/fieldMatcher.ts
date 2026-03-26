import type { FormFoxField } from "../types";

function normalizeText(input: string): string {
  return (input ?? "")
    .toString()
    .trim()
    .toLowerCase()
    // Убираем пунктуацию/скобки, оставляем буквы/цифры и пробелы.
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLabelTextForElement(el: Element): string {
  try {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const id = el.id;
      if (id) {
        const lbl = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl && lbl.textContent) return lbl.textContent;
      }
    }

    // Часто встречается разметка вида: <label>ИНН <input ...></label>
    const closestLabel = el.closest("label");
    if (closestLabel && closestLabel.textContent) return closestLabel.textContent;

    // Иногда лейбл лежит как соседний элемент (например, <span>ИНН</span><input ...>)
    const prev = el.previousElementSibling;
    if (prev && prev.textContent && prev.textContent.trim().length > 0) return prev.textContent;

    return "";
  } catch {
    return "";
  }
}

function getElementTerms(el: Element): string[] {
  const terms: string[] = [];

  const anyEl = el as HTMLElement;
  if (anyEl.id) terms.push(anyEl.id);
  if ((anyEl as HTMLInputElement).name) terms.push((anyEl as HTMLInputElement).name);

  if (el instanceof HTMLInputElement) {
    if (el.type) terms.push(el.type);
    if (el.placeholder) terms.push(el.placeholder);
    if (el.getAttribute("aria-label")) terms.push(el.getAttribute("aria-label") || "");
  } else if (el instanceof HTMLTextAreaElement) {
    if (el.placeholder) terms.push(el.placeholder);
    if (el.getAttribute("aria-label")) terms.push(el.getAttribute("aria-label") || "");
  } else if (el instanceof HTMLSelectElement) {
    if (el.getAttribute("aria-label")) terms.push(el.getAttribute("aria-label") || "");
  }

  const labelText = getLabelTextForElement(el);
  if (labelText) terms.push(labelText);

  return terms.filter(Boolean);
}

function scoreTermAgainstKey(term: string, keyNorm: string): number {
  const t = normalizeText(term);
  if (!t) return 0;
  if (t === keyNorm) return 100;
  if (t.includes(keyNorm)) return 60;
  if (keyNorm.includes(t) && t.length >= 3) return 40;
  return 0;
}

/**
 * Возвращает наиболее подходящий элемент для `profileField.key`.
 *
 * Для radio/checkbox вернуть элемент-репрезентант (по нему потом выберем правильный чекбокс/радио
 * внутри группы, сравнивая `value`).
 */
export function findMatchingField(
  profileField: FormFoxField,
  root: Document | HTMLElement = document
): HTMLElement | null {
  const keyNorm = normalizeText(profileField.key);
  if (!keyNorm) return null;

  try {
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>("input, textarea, select")
    ).filter((el) => {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
      if (el instanceof HTMLInputElement) {
        // Исключаем тех, кому заполнять явно не надо.
        const t = (el.type || "text").toLowerCase();
        return !["hidden", "submit", "button", "image", "reset", "file", "range", "color"].includes(t);
      }
      return true;
    });

    let best: { el: HTMLElement; score: number } | null = null;

    for (const el of candidates) {
      const terms = getElementTerms(el);
      let bestLocalScore = 0;
      for (const term of terms) {
        bestLocalScore = Math.max(bestLocalScore, scoreTermAgainstKey(term, keyNorm));
      }
      if (bestLocalScore <= 0) continue;

      // Небольшой бонус за наличие value-совместимого типа.
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

export { normalizeText, getLabelTextForElement };

