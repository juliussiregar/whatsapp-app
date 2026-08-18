import {
  getSolidPaceApiBaseUrl,
  getSolidPaceApiKey,
  getSolidPaceFetchTimeoutMs,
} from "@/config.js";

export type NutritionCategory = {
  category_id: number;
  name: string;
};

export type SolidPaceUser = {
  user_id: number;
  full_name: string;
  phone: string;
  categories: NutritionCategory[];
};

export type FoodLogPayload = {
  phone: string;
  category_id: number;
  food_name: string;
  serving: number;
  suffix_serving?: string;
  calories: number;
  fat: number;
  protein: number;
  carbo?: number;
};

export type FoodLogResult = {
  user_id: number;
  actual_id: number;
  category_id: number;
  food_name: string;
  serving: number;
  suffix_serving: string;
  calories: number;
  fat: number;
  protein: number;
  carbo?: number;
  total_actual_calories?: number;
  total_actual_fatgrams?: number;
  total_actual_proteingrams?: number;
  total_actual_carbograms?: number;
  sub_actual_id: number;
  food_id: number;
  created_at: string;
};

export type FoodAnalysisTotals = {
  food_name: string;
  serving: number;
  suffix_serving?: string;
  calories: number;
  fat: number;
  protein: number;
  carbo?: number;
};

export type FoodAnalysisItem = {
  food_name: string;
  serving: number;
  suffix_serving?: string;
  calories: number;
  fat: number;
  protein: number;
  carbo?: number;
  confidence?: number;
  notes?: string;
};

export type FoodAnalysisResult = {
  analysis: {
    items?: FoodAnalysisItem[];
    totals: FoodAnalysisTotals;
    analysis_summary?: string;
    disclaimer?: string;
  };
  saved: FoodLogResult | null;
};

export type TrainingSessionPayload = {
  phone: string;
  activity_type: string;
  session_date: string;
  duration: number;
  session_name?: string;
  distance?: number;
  elevation_gain?: number;
  hr_avg?: number;
  hr_max?: number;
  cadence_avg?: number;
  calories?: number;
  notes?: string;
};

export type TrainingSessionOverlap = {
  overlapping?: boolean;
  has_overlap?: boolean;
  message?: string;
  sessions?: Array<{
    id?: number;
    activity_type?: string;
    session_name?: string;
    session_date?: string;
    source?: string;
    source_label?: string;
  }>;
};

export type TrainingSessionResult = {
  id: number;
  activity_type: string;
  session_name?: string | null;
  session_date: string;
  duration: number;
  distance?: number | null;
  tss?: number | null;
  source?: string;
  source_label?: string;
  device_label?: string | null;
  import_channel?: string;
  excluded_from_load?: boolean;
  created_at?: string;
  load_overlap?: TrainingSessionOverlap | null;
};

export function parseFoodAnalysisItems(raw: unknown): FoodAnalysisItem[] {
  if (!Array.isArray(raw)) return [];
  const items: FoodAnalysisItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const food_name = typeof o.food_name === "string" ? o.food_name.trim() : "";
    if (!food_name) continue;
    items.push({
      food_name,
      serving: typeof o.serving === "number" && o.serving > 0 ? o.serving : 0,
      suffix_serving: typeof o.suffix_serving === "string" ? o.suffix_serving : "gr",
      calories: typeof o.calories === "number" ? Math.max(0, o.calories) : 0,
      fat: typeof o.fat === "number" ? Math.max(0, o.fat) : 0,
      protein: typeof o.protein === "number" ? Math.max(0, o.protein) : 0,
      carbo: typeof o.carbo === "number" ? Math.max(0, o.carbo) : undefined,
      confidence: typeof o.confidence === "number" ? o.confidence : undefined,
      notes: typeof o.notes === "string" ? o.notes : undefined,
    });
  }
  return items;
}

export class SolidPaceApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly code?: string;

  constructor(status: number, message: string, body?: unknown, code?: string) {
    super(message);
    this.name = "SolidPaceApiError";
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

function apiKey(): string {
  return getSolidPaceApiKey();
}

function baseUrl(): string {
  return getSolidPaceApiBaseUrl();
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractPydanticDetail(detail: unknown): string | undefined {
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (!Array.isArray(detail)) return undefined;
  const parts: string[] = [];
  for (const entry of detail) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const loc = Array.isArray(o.loc)
      ? o.loc.filter((x) => x !== "body" && x !== "query" && x !== "path").join(".")
      : "";
    const msg = typeof o.msg === "string" ? o.msg : "";
    if (!msg) continue;
    parts.push(loc ? `${loc}: ${msg}` : msg);
  }
  return parts.length ? parts.join("; ") : undefined;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const obj = body as Record<string, unknown>;
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
  const fromDetail = extractPydanticDetail(obj.detail);
  if (fromDetail) return fromDetail;
  return fallback;
}

export function parseSolidPaceErrorDetail(body: unknown): string | undefined {
  const msg = extractErrorMessage(body, "");
  return msg || undefined;
}

function extractErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (typeof obj.code === "string") return obj.code;
  return undefined;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", apiKey());
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const timeoutMs = getSolidPaceFetchTimeoutMs();
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await parseJson(res);

  if (!res.ok) {
    throw new SolidPaceApiError(
      res.status,
      extractErrorMessage(body, `SolidPace API error ${res.status}`),
      body,
      extractErrorCode(body),
    );
  }

  return body as T;
}

export async function resolveUserByPhone(phone: string): Promise<SolidPaceUser> {
  const qs = new URLSearchParams({ phone });
  const body = await requestJson<{ data: SolidPaceUser }>(
    `/integrations/whatsapp/users/by-phone?${qs.toString()}`,
  );
  return body.data;
}

export async function logFood(payload: FoodLogPayload): Promise<FoodLogResult> {
  const body = await requestJson<{ data: FoodLogResult }>(
    `/integrations/whatsapp/nutrition/food`,
    {
      method: "POST",
      body: JSON.stringify({
        suffix_serving: "gr",
        ...payload,
      }),
    },
  );
  return body.data;
}

export async function analyzeFoodImage(params: {
  phone: string;
  file: Buffer;
  filename: string;
  mimeType: string;
  categoryId?: number;
  portionHint?: string;
  save?: boolean;
}): Promise<FoodAnalysisResult> {
  const form = new FormData();
  form.append("phone", params.phone);
  form.append(
    "file",
    new Blob([new Uint8Array(params.file)], {
      type: params.mimeType || "image/jpeg",
    }),
    params.filename || "food.jpg",
  );
  form.append("save", String(params.save ?? false));
  if (params.categoryId != null) {
    form.append("category_id", String(params.categoryId));
  }
  if (params.portionHint?.trim()) {
    form.append("portion_hint", params.portionHint.trim().slice(0, 500));
  }

  const body = await requestJson<{ data: FoodAnalysisResult }>(
    `/integrations/whatsapp/nutrition/analyze-image`,
    { method: "POST", body: form },
  );
  return body.data;
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export function parseLoadOverlap(raw: unknown): TrainingSessionOverlap | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sessions = Array.isArray(o.sessions)
    ? o.sessions.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const s = entry as Record<string, unknown>;
        return [
          {
            id: typeof s.id === "number" ? s.id : undefined,
            activity_type: typeof s.activity_type === "string" ? s.activity_type : undefined,
            session_name: typeof s.session_name === "string" ? s.session_name : undefined,
            session_date: typeof s.session_date === "string" ? s.session_date : undefined,
            source: typeof s.source === "string" ? s.source : undefined,
            source_label: typeof s.source_label === "string" ? s.source_label : undefined,
          },
        ];
      })
    : undefined;
  return {
    overlapping: typeof o.overlapping === "boolean" ? o.overlapping : undefined,
    has_overlap: typeof o.has_overlap === "boolean" ? o.has_overlap : undefined,
    message: typeof o.message === "string" ? o.message : undefined,
    sessions,
  };
}

export async function logTrainingSession(
  payload: TrainingSessionPayload,
): Promise<TrainingSessionResult> {
  const body = await requestJson<{ data: TrainingSessionResult }>(
    `/integrations/whatsapp/training-sessions`,
    {
      method: "POST",
      body: JSON.stringify(
        omitUndefined({
          phone: payload.phone,
          activity_type: payload.activity_type,
          session_date: payload.session_date,
          duration: payload.duration,
          session_name: payload.session_name,
          distance: payload.distance,
          elevation_gain: payload.elevation_gain,
          hr_avg: payload.hr_avg,
          hr_max: payload.hr_max,
          cadence_avg: payload.cadence_avg,
          calories: payload.calories,
          notes: payload.notes?.slice(0, 2000),
        }),
      ),
    },
  );
  const data = body.data;
  return {
    ...data,
    load_overlap: parseLoadOverlap(data?.load_overlap) ?? data?.load_overlap ?? null,
  };
}
