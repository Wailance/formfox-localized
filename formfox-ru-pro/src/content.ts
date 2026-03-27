import type { FormFoxProfile, FormFoxStorageShape } from "./types";
import { fillFormWithProfile } from "./utils/formFiller";

const ACTIVE_KEY = "__activeProfile";

async function main() {
  try {
    const res = await chrome.storage.local.get({ [ACTIVE_KEY]: null as FormFoxProfile | null });
    const storage = res as FormFoxStorageShape;
    const profile = storage[ACTIVE_KEY];

    if (!profile) {
      console.warn("[FormFox] Нет активного профиля в storage для заполнения.");
      return;
    }

    console.info(`[FormFox] Content script: заполняю форму "${profile.name}"`);

    await fillFormWithProfile(profile, document);

    // Очищаем активный профиль, чтобы следующие инъекции не использовали старые данные.
    await chrome.storage.local.remove([ACTIVE_KEY]);
    console.info("[FormFox] Content script: профиль очищен.");
  } catch (err) {
    console.error("[FormFox] Content script error:", err);
  }
}

main();

