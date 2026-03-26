(() => {
  "use strict";

  const ACTIVE_KEY = "__activeProfile";

  /**
   * Определяем, что ошибка связана с доступом расширения к текущему сайту.
   * Chrome показывает разные сообщения в разных версиях, поэтому используем набор подстрок.
   */
  function isPermissionError(errMessage) {
    if (!errMessage) return false;
    const m = errMessage.toLowerCase();
    return (
      m.includes("cannot access") ||
      m.includes("permission") ||
      m.includes("no permission") ||
      m.includes("matches pattern") ||
      m.includes("host permissions") ||
      m.includes("origin")
    );
  }

  /**
   * Инъектим `dist/content.js` в конкретную вкладку.
   * Возвращает промис, чтобы удобнее обработать ошибку доступа.
   */
  function executeContentScript(tabId) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
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

  /**
   * В MVP мы используем `optional_host_permissions`, чтобы не запрашивать доступ ко всем сайтам.
   * Этот метод запрашивает host-permission только для origin текущей вкладки (и только если её ещё нет).
   */
  async function ensureHostAccessForTab(tabUrl) {
    if (!tabUrl) return;
    try {
      const url = new URL(tabUrl);
      const origin = url.origin;
      const pattern = `${origin}/*`;

      const has = await new Promise((resolve) => {
        chrome.permissions.contains({ origins: [pattern] }, (result) => resolve(Boolean(result)));
      });
      if (has) return;

      await chrome.permissions.request({ origins: [pattern] });
    } catch (err) {
      console.error("[FormFox] ensureHostAccessForTab error:", err);
    }
  }

  /**
   * Принимаем команду из popup:
   * { type: "FILL_FORM", tabId, profile }
   *
   * Далее:
   * 1) сохраняем профиль во временное хранилище `chrome.storage.local`
   * 2) инъектим content-script
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        if (!message || message.type !== "FILL_FORM") return;

        const tabId = message.tabId;
        const profile = message.profile;

        if (!tabId || !profile) {
          sendResponse({ ok: false, error: "Bad request" });
          return;
        }

        console.info(
          `[FormFox] Background: fill request for tabId=${tabId}, profile="${profile.name}"`
        );

        const tab = await chrome.tabs.get(tabId);
        const tabUrl = tab?.url;

        await chrome.storage.local.set({ [ACTIVE_KEY]: profile });

        try {
          await executeContentScript(tabId);
        } catch (err) {
          console.error("[FormFox] executeContentScript failed:", err?.message || err);
          if (isPermissionError(err?.message)) {
            await ensureHostAccessForTab(tabUrl);
            await executeContentScript(tabId);
          } else {
            throw err;
          }
        }

        sendResponse({ ok: true });
      } catch (err) {
        console.error("[FormFox] Background error:", err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();

    // Важно: возвращаем true, чтобы sendResponse отработал асинхронно.
    return true;
  });

  console.info("[FormFox] Background service worker started.");
})();

