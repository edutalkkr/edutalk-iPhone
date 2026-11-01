// 학교 공식 양식함 — 만료 없이 영구 보관 (Feature 3)
import { call } from "../lib/tauri";

export type FormItem = {
  id: number;
  title: string;
  category: string;
  file_name: string;
  size: number;
  mime_type: string;
  uploaded_by_name: string;
  created_at: string;
};

export async function listForms(): Promise<FormItem[]> {
  const res = await call<{ ok?: boolean; forms?: FormItem[] } | null>("srv_get", { path: "/api/forms" });
  return res?.forms ?? [];
}

export async function downloadForm(id: number, name?: string): Promise<void> {
  await call("form_download", { id, name: name ?? null });
}