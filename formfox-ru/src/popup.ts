import type { FormFoxField, FormFoxProfile } from "./types";
import { deleteProfile, getProfiles, setProfiles, upsertProfile } from "./utils/storage";
import type { FillFormMessage } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const elProfiles = $("profiles");
const elProfilesEmpty = $("profilesEmpty");
const elStatus = $("status");

const elProfileName = $("profileName") as HTMLInputElement;
const elAutoConfirm = $("autoConfirm") as HTMLInputElement;
const elFields = $("fields") as HTMLDivElement;

const btnRefresh = $("btnRefresh") as HTMLButtonElement;
const btnAddField = $("btnAddField") as HTMLButtonElement;
const btnSaveProfile = $("btnSaveProfile") as HTMLButtonElement;
const btnClearForm = $("btnClearForm") as HTMLButtonElement;

const btnExport = $("btnExport") as HTMLButtonElement;
const btnImport = $("btnImport") as HTMLButtonElement;
const importFile = $("importFile") as HTMLInputElement;

let profiles: FormFoxProfile[] = [];
let editingProfileId: string | null = null;

let draftFields: FormFoxField[] = [];

function setStatus(msg: string, isError = false) {
  elStatus.textContent = msg;
  elStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function uid(): string {
  // @ts-ignore
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `ff_${Math.random().toString(16).slice(2)}_${Date.now()}`;
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
    elAutoConfirm.checked = true;
    draftFields = [];
    renderDraft();
    return;
  }

  editingProfileId = profile.id;
  elProfileName.value = profile.name;
  elAutoConfirm.checked = Boolean(profile.autoConfirm);
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

    const btnFill = document.createElement("button");
    btnFill.type = "button";
    btnFill.className = "primary";
    btnFill.textContent = "Заполнить";
    btnFill.addEventListener("click", () => onFillProfile(p));

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

    actions.appendChild(btnFill);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(actions);

    elProfiles.appendChild(card);
  }
}

async function onFillProfile(profile: FormFoxProfile) {
  try {
    setStatus("Подготавливаю заполнение...");

    if (!profile.autoConfirm) {
      const keys = profile.fields.map((f) => f.key).filter(Boolean);
      const preview = keys.slice(0, 6).join(", ") + (keys.length > 6 ? "..." : "");
      const ok = confirm(`Заполнить профиль "${profile.name}"?\nПоля: ${preview}`);
      if (!ok) return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== "number" || !tab.url) {
      setStatus("Не удалось определить активную вкладку.", true);
      return;
    }

    const msg: FillFormMessage = { type: "FILL_FORM", tabId: tab.id, profile };
    await new Promise<void>((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        if (!res?.ok) {
          reject(new Error(res?.error || "Unknown error"));
          return;
        }
        resolve();
      });
    });

    setStatus("Заполнение запущено. Если форма динамическая, иногда требуется немного подождать.");
  } catch (err: any) {
    console.error("[FormFox] onFillProfile error:", err);
    setStatus(err?.message || String(err), true);
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
      autoConfirm: Boolean(elAutoConfirm.checked),
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
btnAddField.addEventListener("click", () => {
  draftFields.push({ key: "", value: "" });
  renderDraft();
});
btnSaveProfile.addEventListener("click", onSaveProfile);
btnClearForm.addEventListener("click", clearDraft);

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

