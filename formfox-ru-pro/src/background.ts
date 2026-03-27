import type { InnLookupData, LookupInnMessage } from "./types";

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

function asString(value: any): string {
  return String(value ?? "").trim();
}

function formatDate(value: any): string {
  const raw = asString(value);
  if (!raw) return "";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  return `${m[3]}.${m[2]}.${m[1]}`;
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
  const obr = root?.["СвОбрЮЛ"]?.["@attributes"] ?? {};
  const tax = root?.["СвРегОрг"]?.["@attributes"] ?? {};
  const tax2 = root?.["СвУчетНО"]?.["СвНО"]?.["@attributes"] ?? {};
  const sf = root?.["СвРегСФР"]?.["@attributes"] ?? {};
  const cap = root?.["СвУстКап"]?.["@attributes"] ?? {};
  const directorFl = root?.["СведДолжнФЛ"]?.["СвФЛ"]?.["@attributes"] ?? {};
  const directorPos = root?.["СведДолжнФЛ"]?.["СвДолжн"]?.["@attributes"] ?? {};
  const okved = root?.["СвОКВЭД"]?.["СвОКВЭДОсн"]?.["@attributes"] ?? {};
  const holder = root?.["СвДержРеестрАО"]?.["ДержРеестрАО"]?.["@attributes"] ?? {};
  const directorName = [directorFl["Фамилия"], directorFl["Имя"], directorFl["Отчество"]]
    .map((x) => asString(x))
    .filter(Boolean)
    .join(" ");

  const data: InnLookupData = {
    shortName: asString(shortName || fullName),
    fullName: asString(fullName || shortName),
    opfShort: asString(attrs["СпрОПФ"]),
    opfFull: asString(attrs["ПолнНаимОПФ"]),
    inn: asString(attrs["ИНН"] ?? normalized),
    kpp: asString(attrs["КПП"]),
    ogrn: asString(attrs["ОГРН"]),
    registrationDate: formatDate(attrs["ДатаОГРН"] || obr["ДатаРег"]),
    taxAuthorityCode: asString(tax["КодНО"] || tax2["КодНО"]),
    taxAuthorityName: asString(tax["НаимНО"] || tax2["НаимНО"]),
    registrationAuthorityName: asString(obr["НаимРО"]),
    registrationNumber: asString(obr["РегНом"]),
    sfRegistrationNumber: asString(sf["РегНомСФР"]),
    sfRegistrationDate: formatDate(sf["ДатаРег"]),
    authorizedCapital: asString(cap["СумКап"]),
    directorFullName: directorName,
    directorPosition: asString(directorPos["НаимДолжн"] || directorPos["НаимВидДолжн"]),
    mainOkvedCode: asString(okved["КодОКВЭД"]),
    mainOkvedName: asString(okved["НаимОКВЭД"]),
    registryHolderName: asString(holder["НаимЮЛПолн"]),
    registryHolderInn: asString(holder["ИНН"]),
    registryHolderOgrn: asString(holder["ОГРН"]),
    legalAddress: buildAddress(root),
  };
  return data;
}

chrome.runtime.onMessage.addListener((message: LookupInnMessage, sender, sendResponse) => {
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
  })();

  // Важно: возвращаем true, чтобы sendResponse мог выполниться асинхронно.
  return true;
});

console.info("[FormFox] Background service worker started.");

