import type {
  FillFormMessage,
  FormFoxProfile,
  FormFoxStorageShape,
  InnLookupData,
  LookupInnMessage,
} from "./types";

const ACTIVE_KEY = "__activeProfile";

function getEgrulRoot(payload: any): any | null {
  if (!payload || typeof payload !== "object") return null;
  return payload["СвЮЛ"] ?? payload["СвИП"] ?? null;
}

function buildAddress(root: any): string {
  const adr = root?.["СвАдресЮЛ"]?.["АдресРФ"] ?? root?.["АдрМП"]?.["АдрРФ"] ?? null;
  if (!adr) return "";
  const attrs = adr["@attributes"] ?? {};
  const parts = [
    attrs["Индекс"],
    adr?.["Регион"]?.["@attributes"]?.["НаимРегион"],
    adr?.["Район"]?.["@attributes"]?.["НаимРайон"],
    adr?.["Город"]?.["@attributes"]?.["НаимГород"],
    adr?.["НаселПункт"]?.["@attributes"]?.["НаимНаселПункт"],
    adr?.["Улица"]?.["@attributes"]?.["НаимУлица"],
    attrs["Дом"],
    attrs["Корпус"],
    attrs["Кварт"],
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

async function lookupByInn(inn: string): Promise<InnLookupData> {
  const normalized = inn.replace(/\D+/g, "");
  if (!(normalized.length === 10 || normalized.length === 12)) {
    throw new Error("ИНН должен содержать 10 или 12 цифр.");
  }

  const resp = await fetch(`https://egrul.org/${normalized}.json`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Сервис ЕГРЮЛ недоступен: ${resp.status}`);
  }
  const payload = await resp.json();
  const root = getEgrulRoot(payload);
  if (!root) throw new Error("Не удалось распознать ответ ЕГРЮЛ.");

  const attrs = root["@attributes"] ?? {};
  const shortName = root?.["СвНаимЮЛ"]?.["СвНаимЮЛСокр"]?.["@attributes"]?.["НаимСокр"] ?? "";
  const fullName = root?.["СвНаимЮЛ"]?.["@attributes"]?.["НаимЮЛПолн"] ?? "";
  const data: InnLookupData = {
    shortName: String(shortName || fullName || ""),
    fullName: String(fullName || shortName || ""),
    inn: String(attrs["ИНН"] ?? normalized),
    kpp: String(attrs["КПП"] ?? ""),
    ogrn: String(attrs["ОГРН"] ?? ""),
    legalAddress: buildAddress(root),
  };
  return data;
}

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

chrome.runtime.onMessage.addListener((message: FillFormMessage | LookupInnMessage, sender, sendResponse) => {
  (async () => {
    if (!message) return;

    if (message.type === "LOOKUP_INN") {
      try {
        const data = await lookupByInn(message.inn);
        sendResponse({ ok: true, data });
      } catch (err: any) {
        console.error("[FormFox] INN lookup error:", err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (message.type !== "FILL_FORM") return;

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

