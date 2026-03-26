export type FormFoxField = {
  /**
   * Ключ, по которому матчится DOM-поле.
   * Сравнивается с: `name/id/placeholder/aria-label` и текстом рядом (label).
   */
  key: string;
  /**
   * Что нужно подставить в найденное поле.
   */
  value: string;
};

export type FormFoxProfile = {
  id: string;
  name: string;
  fields: FormFoxField[];

  /**
   * Если true — при заполнении без подтверждения (MVP: просто всегда заполняем).
   * Если false — будет показан `confirm()` в popup до запуска заполнения.
   */
  autoConfirm: boolean;

  updatedAt: number;
};

export type FormFoxStorageShape = {
  profiles: FormFoxProfile[];
  /**
   * Временное хранилище для передачи данных в content-script.
   * Заполняется background-ом непосредственно перед инъекцией.
   */
  __activeProfile?: FormFoxProfile;
};

export type FillFormMessage = {
  type: "FILL_FORM";
  tabId: number;
  profile: FormFoxProfile;
};

