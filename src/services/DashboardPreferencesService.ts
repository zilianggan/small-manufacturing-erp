import { supabase } from "./supabase";
import { getStorageItem, removeStorageItem, setStorageItem } from "../helper";
import { DashboardPreferences } from "../types";

const CACHE_KEY = "erp_dashboard_preferences";
const DEFAULT_PREFERENCES: DashboardPreferences = { visible_sections: {} };
const SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

export const getDashboardPreferences = async (): Promise<DashboardPreferences> => {
  const cached = getStorageItem<DashboardPreferences | null>(CACHE_KEY, null);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("dashboard_preferences")
    .select("*")
    .maybeSingle();

  if (error) {
    console.error(error);
    return DEFAULT_PREFERENCES;
  }
  const prefs = data ?? DEFAULT_PREFERENCES;
  setStorageItem(CACHE_KEY, prefs);
  return prefs;
};

export const saveDashboardPreferences = async (prefs: DashboardPreferences): Promise<DashboardPreferences> => {
  const { data, error } = await supabase
    .from("dashboard_preferences")
    .upsert({ id: SINGLETON_ID, visible_sections: prefs.visible_sections, section_order: prefs.section_order, updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error) {
    throw error;
  }

  removeStorageItem(CACHE_KEY);
  setStorageItem(CACHE_KEY, data);
  return data;
};
