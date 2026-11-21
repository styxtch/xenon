import { create } from "zustand";
import { tauriClient } from "../lib/tauriClient";
import type { AppSettings } from "../types/xenon";

export type SettingsCategoryTab = "all" | "engines" | "hardware" | "security" | "presets";

interface SettingsState {
  settings: AppSettings;
  savedSettings: AppSettings;
  hasUnsavedChanges: boolean;
  activeCategoryTab: SettingsCategoryTab;
  isSaving: boolean;
  saveSuccess: boolean;
  isLoading: boolean;
  setActiveCategoryTab: (tab: SettingsCategoryTab) => void;
  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  saveSettings: () => Promise<void>;
  restoreDefaults: () => Promise<void>;
  clearCache: () => Promise<number>;
  appendNamingToken: (token: string) => void;
}

const initialSettings: AppSettings = {
  sandboxWorkerThreads: true,
  workerThreads: 8,
  memoryCacheLimitMb: 2048,
  tempCacheDir: "",
  hardwareAccelerationGpu: true,
  defaultEncryptionLevel: "AES-256 bit (Acrobat 9.0+)",
  p12KeystorePath: "",
  p12KeystoreSubject: "No certificate loaded",
  autoFlattenOnSave: true,
  sanitizeMetadataXmp: true,
  outputNamingPattern: "{filename}_xenon_{date}",
  primaryDestinationFolder: "",
  preserveModificationTimestamp: true,
  desktopNotificationOnComplete: true,
};

function areSettingsEqual(a: AppSettings, b: AppSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: initialSettings,
  savedSettings: initialSettings,
  hasUnsavedChanges: false,
  activeCategoryTab: "all",
  isSaving: false,
  saveSuccess: false,
  isLoading: false,

  setActiveCategoryTab: (activeCategoryTab) => set({ activeCategoryTab }),

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const settings = await tauriClient.getAppSettings();
      set({ settings, savedSettings: settings, hasUnsavedChanges: false });
    } finally {
      set({ isLoading: false });
    }
  },

  updateSetting: (key, value) =>
    set((state) => {
      const next = {
        ...state.settings,
        [key]: value,
      };
      return {
        settings: next,
        hasUnsavedChanges: !areSettingsEqual(next, state.savedSettings),
        saveSuccess: false,
      };
    }),

  saveSettings: async () => {
    set({ isSaving: true, saveSuccess: false });
    try {
      const saved = await tauriClient.saveAppSettings(get().settings);
      set({
        settings: saved,
        savedSettings: saved,
        hasUnsavedChanges: false,
        saveSuccess: true,
      });
      setTimeout(() => {
        set({ saveSuccess: false });
      }, 2200);
    } finally {
      set({ isSaving: false });
    }
  },

  restoreDefaults: async () => {
    const defaults = await tauriClient.restoreDefaultSettings();
    set({
      settings: defaults,
      savedSettings: defaults,
      hasUnsavedChanges: false,
      saveSuccess: true,
    });
    setTimeout(() => set({ saveSuccess: false }), 1800);
  },

  clearCache: async () => {
    return tauriClient.clearTempCache();
  },

  appendNamingToken: (token: string) =>
    set((state) => {
      const next = {
        ...state.settings,
        outputNamingPattern: state.settings.outputNamingPattern.includes(token)
          ? state.settings.outputNamingPattern
          : `${state.settings.outputNamingPattern}_${token}`,
      };
      return {
        settings: next,
        hasUnsavedChanges: !areSettingsEqual(next, state.savedSettings),
        saveSuccess: false,
      };
    }),
}));
