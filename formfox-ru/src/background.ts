import type { FillFormMessage, FormFoxProfile, FormFoxStorageShape } from "./types";

const ACTIVE_KEY = "__activeProfile";

function isPermissionError(errMessage?: string): boolean {
  if (!errMessage) return false;
  const m = errMessage.toLowerCase();
  // В разных Chrome-версиях сообщения отличаются, поэтому ловим несколько типичных подстрок.
  return (
    m.includes("cannot access") ||
    m.includes("permission") ||
    m.includes("no permission") ||
    m.includes("matches pattern") ||
    m.includes("host permissions") ||
    m.includes("origin")
  );
}

async function executeContentScript(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        // Файл должен быть уже собран в dist при сборке проекта.
        files: ["dist/content.js"],
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve();
      }
    );
  });
}

async function ensureHostAccessForTab(tabId: number, tabUrl?: string): Promise<void> {
  if (!tabUrl) return;
  try {
    const url = new URL(tabUrl);
    const origin = url.origin;
    const pattern = `${origin}/*`;

    // Если хоста еще нет — запросим.
    const has = await new Promise<boolean>((resolve) => {
      chrome.permissions.contains({ origins: [pattern] }, (result) => resolve(Boolean(result)));
    });
    if (has) return;

    await chrome.permissions.request({ origins: [pattern] });
  } catch (err) {
    console.error("[FormFox] ensureHostAccessForTab error:", err);
  }
}

chrome.runtime.onMessage.addListener((message: FillFormMessage, sender, sendResponse) => {
  (async () => {
    if (!message || message.type !== "FILL_FORM") return;

    const tabId = message.tabId;
    const profile: FormFoxProfile = message.profile;

    if (!tabId || !profile) {
      sendResponse({ ok: false, error: "Bad request" });
      return;
    }

    try {
      console.info(`[FormFox] Background: fill request for tabId=${tabId}, profile="${profile.name}"`);

      const tab = await chrome.tabs.get(tabId);
      const tabUrl = tab?.url;

      // Перед инъекцией кладем данные в storage, чтобы content-script их прочитал.
      const storageUpdate: FormFoxStorageShape = { __activeProfile: profile, profiles: [] } as any;
      await chrome.storage.local.set({ [ACTIVE_KEY]: storageUpdate.__activeProfile });

      try {
        await executeContentScript(tabId);
      } catch (err: any) {
        console.error("[FormFox] executeContentScript failed:", err?.message || err);

        if (isPermissionError(err?.message)) {
          await ensureHostAccessForTab(tabId, tabUrl);
          // Повторяем попытку после получения доступа.
          await executeContentScript(tabId);
        } else {
          throw err;
        }
      }

      sendResponse({ ok: true });
    } catch (err: any) {
      console.error("[FormFox] Background error:", err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  // Важно: возвращаем true, чтобы sendResponse мог выполниться асинхронно.
  return true;
});

console.info("[FormFox] Background service worker started.");

