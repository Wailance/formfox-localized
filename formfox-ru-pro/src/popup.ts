import type { FormFoxField, FormFoxProfile } from "./types";
import { deleteProfile, getProfiles, setProfiles, upsertProfile } from "./utils/storage";
import type { InnLookupData, LookupInnMessage } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const elProfiles = $("profiles");
const elProfilesEmpty = $("profilesEmpty");
const elStatus = $("status");

const elProfileName = $("profileName") as HTMLInputElement;
const elFields = $("fields") as HTMLDivElement;

const btnRefresh = $("btnRefresh") as HTMLButtonElement;
const btnAddTemplates = $("btnAddTemplates") as HTMLButtonElement;
const btnAddField = $("btnAddField") as HTMLButtonElement;
const btnSaveProfile = $("btnSaveProfile") as HTMLButtonElement;
const btnClearForm = $("btnClearForm") as HTMLButtonElement;
const elInnLookup = $("innLookup") as HTMLInputElement;
const btnLookupInn = $("btnLookupInn") as HTMLButtonElement;

const btnExport = $("btnExport") as HTMLButtonElement;
const btnImport = $("btnImport") as HTMLButtonElement;
const importFile = $("importFile") as HTMLInputElement;

let profiles: FormFoxProfile[] = [];
let editingProfileId: string | null = null;

let draftFields: FormFoxField[] = [];

const BASE_FIELDS: FormFoxField[] = [
  { key: "Название организации", value: "" },
  { key: "Краткое наименование", value: "" },
  { key: "Полное наименование ОПФ", value: "" },
  { key: "Организационно-правовая форма", value: "" },
  { key: "ИНН", value: "" },
  { key: "КПП", value: "" },
  { key: "ОГРН", value: "" },
  { key: "Дата регистрации", value: "" },
  { key: "Юридический адрес", value: "" },
  { key: "Код налогового органа", value: "" },
  { key: "Наименование налогового органа", value: "" },
  { key: "Регистрирующий орган", value: "" },
  { key: "Регистрационный номер", value: "" },
  { key: "Регистрационный номер СФР", value: "" },
  { key: "Дата регистрации в СФР", value: "" },
  { key: "Уставный капитал", value: "" },
  { key: "Руководитель (ФИО)", value: "" },
  { key: "Должность руководителя", value: "" },
  { key: "ОКВЭД основной (код)", value: "" },
  { key: "ОКВЭД основной (наименование)", value: "" },
  { key: "Расчетный счет", value: "" },
  { key: "Банк", value: "" },
  { key: "БИК", value: "" },
  { key: "Корр. счет", value: "" },
];

const PRESET_PROFILES: Array<{ name: string; fields: FormFoxField[] }> = [
  {
    name: "Шаблон: Бухгалтерия",
    fields: [
      ...BASE_FIELDS,
      { key: "ОКПО", value: "" },
      { key: "Режим налогообложения", value: "" },
      { key: "НДС", value: "" },
      { key: "КБК", value: "" },
      { key: "ОКТМО", value: "" },
      { key: "ФИО главного бухгалтера", value: "" },
      { key: "Телефон бухгалтерии", value: "" },
      { key: "Email бухгалтерии", value: "" },
    ],
  },
  {
    name: "Шаблон: Юрист",
    fields: [
      ...BASE_FIELDS,
      { key: "Основание полномочий подписанта", value: "Устав" },
      { key: "Статус организации", value: "" },
      { key: "Лицензии (кратко)", value: "" },
      { key: "Реестродержатель", value: "" },
      { key: "ИНН реестродержателя", value: "" },
      { key: "ОГРН реестродержателя", value: "" },
      { key: "Должность подписанта", value: "Генеральный директор" },
      { key: "ФИО подписанта", value: "" },
      { key: "Основание полномочий", value: "Устав" },
      { key: "Email юриста", value: "" },
    ],
  },
  {
    name: "Шаблон: ИП",
    fields: [
      { key: "ФИО ИП", value: "" },
      { key: "ИНН", value: "" },
      { key: "ОГРНИП", value: "" },
      { key: "Адрес", value: "" },
      { key: "Расчетный счет", value: "" },
      { key: "Банк", value: "" },
      { key: "БИК", value: "" },
      { key: "Корр. счет", value: "" },
      { key: "Телефон", value: "" },
      { key: "Email", value: "" },
    ],
  },
];

function setStatus(msg: string, isError = false) {
  elStatus.textContent = msg;
  elStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function uid(): string {
  // @ts-ignore
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `ff_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function upsertDraftField(key: string, value: string) {
  const normalizedKey = key.trim().toLowerCase();
  const idx = draftFields.findIndex((f) => f.key.trim().toLowerCase() === normalizedKey);
  if (idx >= 0) {
    draftFields[idx].value = value;
    return;
  }
  draftFields.push({ key, value });
}

function applyInnDataToDraft(data: InnLookupData) {
  if (data.fullName) upsertDraftField("Название организации", data.fullName);
  if (data.shortName) upsertDraftField("Краткое наименование", data.shortName);
  if (data.opfFull) upsertDraftField("Полное наименование ОПФ", data.opfFull);
  if (data.opfShort) upsertDraftField("Организационно-правовая форма", data.opfShort);
  if (data.inn) upsertDraftField("ИНН", data.inn);
  if (data.kpp) upsertDraftField("КПП", data.kpp);
  if (data.ogrn) upsertDraftField("ОГРН", data.ogrn);
  if (data.registrationDate) upsertDraftField("Дата регистрации", data.registrationDate);
  if (data.legalAddress) upsertDraftField("Юридический адрес", data.legalAddress);
  if (data.taxAuthorityCode) upsertDraftField("Код налогового органа", data.taxAuthorityCode);
  if (data.taxAuthorityName) upsertDraftField("Наименование налогового органа", data.taxAuthorityName);
  if (data.registrationAuthorityName) upsertDraftField("Регистрирующий орган", data.registrationAuthorityName);
  if (data.registrationNumber) upsertDraftField("Регистрационный номер", data.registrationNumber);
  if (data.sfRegistrationNumber) upsertDraftField("Регистрационный номер СФР", data.sfRegistrationNumber);
  if (data.sfRegistrationDate) upsertDraftField("Дата регистрации в СФР", data.sfRegistrationDate);
  if (data.authorizedCapital) upsertDraftField("Уставный капитал", data.authorizedCapital);
  if (data.directorFullName) {
    upsertDraftField("Руководитель (ФИО)", data.directorFullName);
    upsertDraftField("ФИО подписанта", data.directorFullName);
  }
  if (data.directorPosition) {
    upsertDraftField("Должность руководителя", data.directorPosition);
    upsertDraftField("Должность подписанта", data.directorPosition);
  }
  if (data.mainOkvedCode) upsertDraftField("ОКВЭД основной (код)", data.mainOkvedCode);
  if (data.mainOkvedName) upsertDraftField("ОКВЭД основной (наименование)", data.mainOkvedName);
  if (data.registryHolderName) upsertDraftField("Реестродержатель", data.registryHolderName);
  if (data.registryHolderInn) upsertDraftField("ИНН реестродержателя", data.registryHolderInn);
  if (data.registryHolderOgrn) upsertDraftField("ОГРН реестродержателя", data.registryHolderOgrn);
}

function renderFieldRow(index: number, field: FormFoxField) {
  const row = document.createElement("div");
  row.className = "field";
  row.dataset.index = String(index);

  const colKey = document.createElement("div");
  const colVal = document.createElement("div");

  const keyLabel = document.createElement("label");
  keyLabel.textContent = "Ключ";
  keyLabel.htmlFor = `field_key_${index}`;

  const keyInput = document.createElement("input");
  keyInput.id = `field_key_${index}`;
  keyInput.type = "text";
  keyInput.value = field.key ?? "";
  keyInput.placeholder = "Например: ИНН";
  keyInput.addEventListener("input", () => {
    draftFields[index].key = keyInput.value;
  });

  colKey.appendChild(keyLabel);
  colKey.appendChild(keyInput);

  const valLabel = document.createElement("label");
  valLabel.textContent = "Значение";
  valLabel.htmlFor = `field_value_${index}`;

  const valInput = document.createElement("input");
  valInput.id = `field_value_${index}`;
  valInput.type = "text";
  valInput.value = field.value ?? "";
  valInput.placeholder = "Например: 7707083893";
  valInput.addEventListener("input", () => {
    draftFields[index].value = valInput.value;
  });

  colVal.appendChild(valLabel);
  colVal.appendChild(valInput);

  const actions = document.createElement("div");
  actions.className = "field-actions";

  const btnDel = document.createElement("button");
  btnDel.type = "button";
  btnDel.className = "danger";
  btnDel.textContent = "Удалить поле";
  btnDel.addEventListener("click", () => {
    draftFields.splice(index, 1);
    renderDraft();
  });

  actions.appendChild(btnDel);

  row.appendChild(colKey);
  row.appendChild(colVal);
  row.appendChild(actions);

  return row;
}

function renderDraft() {
  elFields.innerHTML = "";
  if (draftFields.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "Пока нет полей. Добавьте хотя бы одно.";
    elFields.appendChild(empty);
    return;
  }

  draftFields.forEach((f, idx) => {
    elFields.appendChild(renderFieldRow(idx, f));
  });
}

function loadDraftFromProfile(profile: FormFoxProfile | null) {
  if (!profile) {
    editingProfileId = null;
    elProfileName.value = "";
    draftFields = [];
    renderDraft();
    return;
  }

  editingProfileId = profile.id;
  elProfileName.value = profile.name;
  draftFields = profile.fields.map((f) => ({ key: f.key, value: f.value }));
  renderDraft();
}

function renderProfilesList() {
  elProfiles.innerHTML = "";

  if (profiles.length === 0) {
    elProfilesEmpty.style.display = "block";
    return;
  }
  elProfilesEmpty.style.display = "none";

  for (const p of profiles) {
    const card = document.createElement("div");
    card.className = "profile-card";

    const title = document.createElement("div");
    title.className = "profile-title";
    title.textContent = p.name;

    const meta = document.createElement("p");
    meta.className = "profile-meta";
    meta.textContent = `${p.fields.length} поля`;

    const actions = document.createElement("div");
    actions.className = "profile-actions";

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.textContent = "Редактировать";
    btnEdit.addEventListener("click", () => loadDraftFromProfile(p));

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "danger";
    btnDelete.textContent = "Удалить";
    btnDelete.addEventListener("click", async () => {
      if (!confirm(`Удалить профиль "${p.name}"?`)) return;
      await deleteProfile(p.id);
      profiles = await getProfiles();
      renderProfilesList();
      setStatus("Профиль удалён.");
    });

    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(actions);

    elProfiles.appendChild(card);
  }
}

async function refreshProfiles() {
  try {
    profiles = await getProfiles();
    renderProfilesList();
    setStatus("");
  } catch (err) {
    console.error("[FormFox] refreshProfiles error:", err);
    setStatus("Не удалось загрузить профили.", true);
  }
}

async function addPresetProfiles() {
  try {
    const existing = await getProfiles();
    let added = 0;
    for (const preset of PRESET_PROFILES) {
      const exists = existing.some((p) => p.name.trim().toLowerCase() === preset.name.trim().toLowerCase());
      if (exists) continue;
      const profile: FormFoxProfile = {
        id: uid(),
        name: preset.name,
        fields: preset.fields.map((f) => ({ key: f.key, value: f.value })),
        autoConfirm: true,
        updatedAt: Date.now(),
      };
      existing.push(profile);
      added += 1;
    }
    await setProfiles(existing);
    profiles = existing;
    renderProfilesList();
    setStatus(added > 0 ? `Добавлено шаблонов: ${added}.` : "Шаблоны уже добавлены.");
  } catch (err) {
    console.error("[FormFox] addPresetProfiles error:", err);
    setStatus("Не удалось добавить шаблоны.", true);
  }
}

async function lookupByInn() {
  try {
    const inn = elInnLookup.value.trim();
    if (!inn) {
      setStatus("Введите ИНН для поиска.", true);
      return;
    }
    setStatus("Запрашиваю данные по ИНН...");

    const message: LookupInnMessage = { type: "LOOKUP_INN", inn };
    const result = await new Promise<{ ok: boolean; data?: InnLookupData; error?: string }>((resolve) => {
      chrome.runtime.sendMessage(message, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message });
          return;
        }
        resolve(res);
      });
    });

    if (!result.ok || !result.data) {
      setStatus(result.error || "Не удалось получить данные по ИНН.", true);
      return;
    }

    if (!elProfileName.value.trim() && result.data.shortName) {
      elProfileName.value = result.data.shortName;
    }
    applyInnDataToDraft(result.data);
    renderDraft();
    setStatus("Реквизиты по ИНН подставлены в шаблон.");
  } catch (err: any) {
    console.error("[FormFox] lookupByInn error:", err);
    setStatus(err?.message || String(err), true);
  }
}

async function onSaveProfile() {
  try {
    const name = elProfileName.value.trim();
    if (!name) {
      setStatus("Введите название профиля.", true);
      return;
    }

    const fields = draftFields
      .map((f) => ({ key: f.key?.trim() || "", value: f.value ?? "" }))
      .filter((f) => f.key.length > 0);

    if (fields.length === 0) {
      setStatus("Добавьте хотя бы одно поле.", true);
      return;
    }

    const profile: FormFoxProfile = {
      id: editingProfileId ?? uid(),
      name,
      fields,
      autoConfirm: true,
      updatedAt: Date.now(),
    };

    await upsertProfile(profile);
    profiles = await getProfiles();
    renderProfilesList();
    setStatus("Профиль сохранён.");
  } catch (err) {
    console.error("[FormFox] onSaveProfile error:", err);
    setStatus("Ошибка сохранения профиля.", true);
  }
}

function clearDraft() {
  loadDraftFromProfile(null);
  setStatus("");
}

async function exportJson() {
  try {
    const data = { version: 1, exportedAt: Date.now(), profiles };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `formfox-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    setStatus("Экспорт готов.");
  } catch (err) {
    console.error("[FormFox] exportJson error:", err);
    setStatus("Ошибка экспорта.", true);
  }
}

async function importJson(file: File) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const incoming = parsed?.profiles ?? parsed;
    if (!Array.isArray(incoming)) throw new Error("Неверный формат JSON.");

    const normalized: FormFoxProfile[] = incoming
      .map((p: any) => {
        const fields: FormFoxField[] = Array.isArray(p.fields)
          ? p.fields
              .map((f: any) => ({
                key: String(f.key ?? "").trim(),
                value: String(f.value ?? ""),
              }))
              .filter((f: FormFoxField) => f.key.length > 0)
          : [];

        return {
          id: String(p.id ?? uid()),
          name: String(p.name ?? "").trim(),
          fields,
          autoConfirm: Boolean(p.autoConfirm ?? true),
          updatedAt: Number(p.updatedAt ?? Date.now()),
        } as FormFoxProfile;
      })
      .filter((p: FormFoxProfile) => p.name.length > 0 && p.fields.length > 0);

    if (normalized.length === 0) {
      setStatus("Импорт: профили не найдены.", true);
      return;
    }

    if (!confirm(`Импортировать ${normalized.length} профилей? Текущий список будет заменён.`)) return;
    await setProfiles(normalized);

    profiles = await getProfiles();
    renderProfilesList();
    clearDraft();
    setStatus("Импорт завершён.");
  } catch (err: any) {
    console.error("[FormFox] importJson error:", err);
    setStatus(err?.message || String(err), true);
  }
}

btnRefresh.addEventListener("click", refreshProfiles);
btnAddTemplates.addEventListener("click", addPresetProfiles);
btnAddField.addEventListener("click", () => {
  draftFields.push({ key: "", value: "" });
  renderDraft();
});
btnSaveProfile.addEventListener("click", onSaveProfile);
btnClearForm.addEventListener("click", clearDraft);
btnLookupInn.addEventListener("click", lookupByInn);

btnExport.addEventListener("click", exportJson);
btnImport.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const f = importFile.files?.[0];
  if (!f) return;
  await importJson(f);
  importFile.value = "";
});

// Инициализация
refreshProfiles();
loadDraftFromProfile(null);

