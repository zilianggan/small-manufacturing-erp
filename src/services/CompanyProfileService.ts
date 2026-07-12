import { supabase } from "./supabase";
import { getStorageItem, removeStorageItem, setStorageItem } from "../helper"
import { CompanyProfile } from "../types";

const CACHE_KEY = "erp_company_profile";
const CACHE_TTL_MS = 5 * 60 * 1000; // was cached forever until this device saved a profile edit itself — a device that never edits (e.g. a second install) could show a stale logo indefinitely

export const getCompanyProfile = async () => {
    const cachedAt = getStorageItem(`${CACHE_KEY}_cached_at`, 0);
    const cached = getStorageItem(CACHE_KEY, null);
    if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;

    const { data, error } = await supabase
        .from("company_profile")
        .select("*")
        .maybeSingle();

    if (error) {
        console.error(error);
        throw error;
    }
    if (data) {
        setStorageItem(CACHE_KEY, data);
        setStorageItem(`${CACHE_KEY}_cached_at`, Date.now());
    }
    return data;
};

export const saveCompanyProfile = async (profile: CompanyProfile) => {
    let result;

    if (profile.id) {
        result = await supabase
            .from("company_profile")
            .update(profile)
            .eq("id", profile.id)
            .select()
            .single();
    } else {
        result = await supabase
            .from("company_profile")
            .insert(profile)
            .select()
            .single();
    }

    if (result.error) {
        throw result.error;
    }

    removeStorageItem(CACHE_KEY);
    removeStorageItem(`${CACHE_KEY}_cached_at`);

    return result.data;
};