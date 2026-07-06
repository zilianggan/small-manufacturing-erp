import { supabase } from "./supabase";
import { getStorageItem, removeStorageItem, setStorageItem } from "../helper"
import { CompanyProfile } from "../types";

export const getCompanyProfile = async () => {
    const cached = getStorageItem("erp_company_profile", null);
    if (cached) return cached;
    const { data, error } = await supabase
        .from("company_profile")
        .select("*")
        .maybeSingle();

    if (error) {
        console.error(error);
        throw error;
    }
    if (data) setStorageItem("erp_company_profile", data);
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

    removeStorageItem("erp_company_profile");

    return result.data;
};