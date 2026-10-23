import * as SecureStore from 'expo-secure-store';
import { FlashcardDraft, GradeDraft, SpokenTaskDraft, Subject, TaskType, TimetableDraft } from './types';

export type AIProvider = 'gemini';
export type AIResult<T = string> = { data: T; provider: AIProvider };

const GEMINI_KEY = 'studyhub_gemini_api_key';

// Prioritized verified Gemini models:
// 1. gemini-3.8-flash (Primary workhorse for new keys, Google AI Studio default)
// 2. gemini-3.5-flash-lite (High-throughput, budget-friendly fallback)
// 3. gemini-2.5-flash (Retained fallback for accounts with existing access)
// 4-6. Legacy fallback models for older credentials
export const PRIORITIZED_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
] as const;

// Retain GEMINI_CANDIDATES alias for full backward compatibility
export const GEMINI_CANDIDATES = PRIORITIZED_GEMINI_MODELS;
export const DEFAULT_GEMINI_MODEL = PRIORITIZED_GEMINI_MODELS[0];

let cachedGeminiModel: string | null = null;

export function resetModelCache() {
  cachedGeminiModel = null;
}

export function getCachedModel(): string | null {
  return cachedGeminiModel;
}

export function maskKey(key?: string | null): string {
  if (!key) return '(not set)';
  const clean = key.trim();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

export type GeminiErrorCategory =
  | 'AUTH_INVALID_KEY'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXHAUSTED'
  | 'MODEL_UNAVAILABLE'
  | 'TRANSIENT_NETWORK'
  | 'BAD_REQUEST'
  | 'UNKNOWN';

export function categorizeGeminiError(
  status: number | undefined,
  message: string
): GeminiErrorCategory {
  const lower = message.toLowerCase();

  // 1. Invalid or missing key (permanent auth error - DO NOT switch models)
  if (
    status === 401 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthenticated') ||
    lower.includes('key has expired')
  ) {
    return 'AUTH_INVALID_KEY';
  }

  // 2. Permission / billing issues (permanent authorization error - DO NOT switch models)
  if (
    status === 403 &&
    (lower.includes('permission_denied') ||
      lower.includes('billing') ||
      lower.includes('forbidden') ||
      lower.includes('restricted') ||
      lower.includes('not enabled'))
  ) {
    return 'PERMISSION_DENIED';
  }

  // 3. Quota / Rate limit (resource error - DO NOT switch models)
  if (
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return 'QUOTA_EXHAUSTED';
  }

  // 4. Model unavailability / deprecation / not found / not available for new users
  // (e.g. "models/gemini-2.5-flash is no longer available to new users. Use models/gemini-3.8-flash.")
  if (
    status === 404 ||
    lower.includes('is no longer available') ||
    lower.includes('not found') ||
    lower.includes('not supported for generatecontent') ||
    lower.includes('is not supported') ||
    lower.includes('is not available') ||
    lower.includes('use models/') ||
    lower.includes('unsupported model') ||
    (lower.includes('model') && lower.includes('deprecated')) ||
    (status === 400 && (lower.includes('models/') || lower.includes('model not found') || lower.includes('invalid model')))
  ) {
    return 'MODEL_UNAVAILABLE';
  }

  // 5. Transient network / server
  if (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    status === 500 ||
    lower.includes('timed out') ||
    lower.includes('network request failed') ||
    lower.includes('aborted')
  ) {
    return 'TRANSIENT_NETWORK';
  }

  if (status === 400) {
    return 'BAD_REQUEST';
  }

  return 'UNKNOWN';
}

export function sanitizeErrorMessage(error: unknown, attemptedModels?: string[]): string {
  if (error instanceof ProviderError) {
    const category = categorizeGeminiError(error.status, error.message);
    switch (category) {
      case 'AUTH_INVALID_KEY':
        return 'Invalid Gemini API key. Please check your key in Settings (get a free key at https://aistudio.google.com/).';
      case 'PERMISSION_DENIED':
        return 'Gemini API permission denied. Please verify that Generative Language API is enabled for your project in Google AI Studio.';
      case 'QUOTA_EXHAUSTED':
        return 'Gemini rate limit or quota exceeded. Please wait a moment before trying again or check your quota in Google AI Studio.';
      case 'MODEL_UNAVAILABLE':
        return `Requested model unavailable (${error.message}). Attempted models: ${attemptedModels?.join(', ') || 'none'}.`;
      case 'TRANSIENT_NETWORK':
        return `Network timeout or connection error: ${error.message}`;
      case 'BAD_REQUEST':
        return `Gemini request error: ${error.message}`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred while communicating with Google Gemini.';
}

export async function discoverGeminiModel(key: string): Promise<string> {
  if (cachedGeminiModel) return cachedGeminiModel;
  try {
    const res = await timedFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
      },
      8000
    );
    if (res.ok) {
      const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      const available = (data.models || [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''));

      console.log(`[Gemini] Discovered ${available.length} models for configured key`);

      // Match against prioritized list in order
      for (const cand of PRIORITIZED_GEMINI_MODELS) {
        if (available.includes(cand)) {
          console.log(`[Gemini] Selected prioritized model from discovery: ${cand}`);
          cachedGeminiModel = cand;
          return cand;
        }
      }

      // If no exact match from prioritized list, pick any available flash model or first available
      const flash = available.find((m) => m.toLowerCase().includes('flash')) || available[0];
      if (flash) {
        console.log(`[Gemini] Selected available model: ${flash}`);
        cachedGeminiModel = flash;
        return flash;
      }
    }
  } catch (error) {
    console.warn('[Gemini] Model discovery query failed or restricted, using default:', error);
  }
  return DEFAULT_GEMINI_MODEL;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
type AIOptions<T> = {
  system?: string;
  json?: boolean;
  fast?: boolean;
  image?: { base64: string; mimeType: string };
  validate?: (value: unknown) => T;
  timeoutMs?: number;
};

export class ProviderError extends Error {
  constructor(public provider: AIProvider, message: string, public status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

async function storeKey(key: string, value: string) {
  const clean = value.trim();
  if (clean) {
    await SecureStore.setItemAsync(key, clean);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
  cachedGeminiModel = null;
  const check = await SecureStore.getItemAsync(key);
  console.log(`[SecureStore] Key "${key}" updated -> stored length: ${check?.length ?? 0}`);
}

export const getApiKey = async () => {
  const key = await SecureStore.getItemAsync(GEMINI_KEY);
  if (key?.trim()) return key.trim();
  // Optional environment variable fallback for development / test environments
  const envKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (envKey?.trim()) return envKey.trim();
  return null;
};

export const setApiKey = async (key: string) => {
  await storeKey(GEMINI_KEY, key);
  const verify = await getApiKey();
  console.log(`[AI Key] Gemini key saved. Verified retrievable: ${!!verify}, masked: ${maskKey(verify)}`);
};

export async function getAIKeyStatus() {
  const gemini = await getApiKey();
  return { gemini: !!gemini };
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError('gemini', `Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    const msg = error instanceof Error ? error.message : 'Network request failed';
    throw new ProviderError('gemini', `Network error (${msg}). Check your internet connection.`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries = 2
): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await timedFetch(url, init, timeoutMs);
      // Bounded retry on 500/502/503/504 transient server errors
      if (res.status >= 500 && res.status <= 504 && attempt < maxRetries) {
        console.log(`[Gemini] Server returned ${res.status}, retrying attempt ${attempt + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        console.log(`[Gemini] Network attempt ${attempt} failed, retrying attempt ${attempt + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastErr;
}

async function executeGeminiRequest(
  modelName: string,
  prompt: string,
  key: string,
  options: AIOptions<unknown>
): Promise<string> {
  const parts: GeminiPart[] = [{ text: prompt }];
  if (options.image) {
    parts.push({
      inlineData: {
        mimeType: options.image.mimeType,
        data: options.image.base64,
      },
    });
  }

  // Dual authentication: query parameter + x-goog-api-key header
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(key)}`;
  const systemText = options.system ?? 'You are StudyHub, a clear and practical study assistant.';

  const response = await fetchWithRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemText }],
        },
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
        generationConfig: {
          temperature: options.json ? 0 : 0.35,
          ...(options.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
    options.timeoutMs ?? 30000,
    2
  );

  const rawText = await response.text();
  let body: {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    error?: { code?: number; message?: string; status?: string };
  } = {};

  try {
    body = JSON.parse(rawText);
  } catch {
    // Body is not JSON
  }

  if (!response.ok || body.error) {
    const errorMsg = body.error?.message || `HTTP ${response.status}: ${rawText.slice(0, 200) || response.statusText}`;
    throw new ProviderError('gemini', errorMsg, body.error?.code ?? response.status);
  }

  const rawParts = body.candidates?.[0]?.content?.parts || [];
  // Filter out thought parts if returned by reasoning models so JSON and answers remain clean
  const contentParts = rawParts.filter((p) => !p.thought && typeof p.text === 'string');
  const finalParts = contentParts.length > 0 ? contentParts : rawParts;
  const text = finalParts.map((p) => p.text ?? '').join('').trim();

  if (!text) throw new ProviderError('gemini', 'Empty response returned by Gemini model');
  return text;
}

async function requestGemini(prompt: string, key: string, options: AIOptions<unknown>): Promise<string> {
  let primaryModel = cachedGeminiModel;
  if (!primaryModel) {
    primaryModel = await discoverGeminiModel(key);
  }

  // Build candidate sequence starting with primaryModel, followed by other prioritized models
  const candidateQueue = [
    primaryModel,
    ...PRIORITIZED_GEMINI_MODELS.filter((m) => m !== primaryModel),
  ];

  const attemptedModels: string[] = [];
  let lastError: unknown = null;

  for (const model of candidateQueue) {
    attemptedModels.push(model);
    try {
      console.log(`[Gemini] Executing request using model: ${model}`);
      const result = await executeGeminiRequest(model, prompt, key, options);
      cachedGeminiModel = model;
      return result;
    } catch (error) {
      lastError = error;
      const status = error instanceof ProviderError ? error.status : undefined;
      const message = error instanceof Error ? error.message : String(error);
      const category = categorizeGeminiError(status, message);

      if (category === 'MODEL_UNAVAILABLE') {
        console.warn(`[Gemini] Model "${model}" unavailable (${message}). Trying next eligible model...`);
        cachedGeminiModel = null;
        continue;
      }

      // Permanent non-model errors (AUTH, PERMISSION, QUOTA, BAD_REQUEST):
      // DO NOT switch models. Stop immediately.
      console.error(`[Gemini] Permanent request failure [${category}] on model ${model}:`, sanitizeErrorMessage(error));
      throw error;
    }
  }

  const lastErrMsg = lastError instanceof Error ? ` (Details: ${lastError.message})` : '';
  const summary = `All eligible Gemini models were unavailable for your API key. (Attempted models: ${attemptedModels.join(', ')}).${lastErrMsg}`;
  console.error(`[Gemini] ${summary}`);
  throw new ProviderError('gemini', summary, 404);
}

function extractJson(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.search(/[\[{]/);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (start < 0 || end < start) throw new Error('Model did not return valid JSON');
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

export async function askAI<T = string>(prompt: string, options: AIOptions<T> = {}): Promise<AIResult<T>> {
  const key = await getApiKey();
  if (!key) {
    throw new Error('No Gemini API key configured. Please add your Google Gemini API key in Settings.');
  }

  const attempts = options.json ? 2 : 1;
  const errors: string[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const strictPrompt =
        attempt === 0
          ? prompt
          : `${prompt}\nSTRICT RETRY: Return one valid JSON object only, without markdown fences or commentary.`;

      console.log(`[Gemini] Requesting AI (attempt ${attempt + 1}/${attempts})...`);
      const raw = await requestGemini(strictPrompt, key, options);

      const value = options.json
        ? options.validate
          ? options.validate(extractJson(raw))
          : extractJson(raw)
        : raw;

      return { data: value as T, provider: 'gemini' };
    } catch (error) {
      const errorMsg = sanitizeErrorMessage(error);
      console.warn('[Gemini] Request failed:', errorMsg);
      errors.push(errorMsg);

      if (error instanceof ProviderError && error.status && [400, 401, 403, 429].includes(error.status)) {
        break;
      }
      if (!options.json || error instanceof ProviderError) {
        break;
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors[errors.length - 1]);
  }

  throw new Error('AI request could not be completed. Please check your Gemini API key and internet connection.');
}

// Test Gemini provider with a simple prompt
export async function testGeminiConnection(customKey?: string): Promise<{ success: boolean; message: string }> {
  const key = customKey?.trim() || (await getApiKey());
  if (!key) return { success: false, message: 'No Gemini API key provided.' };

  if (customKey) {
    cachedGeminiModel = null;
  }

  try {
    const text = await requestGemini(
      'Hello! Please reply with exactly: "StudyHub Gemini is connected."',
      key,
      { system: 'Be extremely concise.', timeoutMs: 15000 }
    );
    const activeModel = cachedGeminiModel || DEFAULT_GEMINI_MODEL;
    return { success: true, message: `${text} (Model: ${activeModel})` };
  } catch (error) {
    const msg = sanitizeErrorMessage(error);
    return { success: false, message: msg };
  }
}

const scalar = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const rows = (v: unknown, key: string) =>
  Array.isArray(v)
    ? v
    : v && typeof v === 'object' && Array.isArray((v as Record<string, unknown>)[key])
      ? ((v as Record<string, unknown>)[key] as unknown[])
      : [];

export async function askStudyAssistant(message: string, source?: string) {
  return askAI(message, {
    system: source
      ? `Answer only from this source and end with a concise Source note.\nSOURCE:\n${source.slice(0, 28000)}`
      : 'You are StudyHub, a practical and encouraging study assistant. Use clear, structured explanations.',
  });
}

export async function answerSourceQuestion(question: string, source: string) {
  return askStudyAssistant(question, source);
}

export async function generateQuizFromNotes(notes: string) {
  return askAI(`Create 5 varied revision questions and a separate answer key.\nNOTES:\n${notes.slice(0, 28000)}`, {
    system: 'You are StudyHub, an accurate study assistant.',
  });
}

export async function parseTimetableImage(base64: string, mimeType: string) {
  const result = await askAI<TimetableDraft[]>(
    'Read this university timetable. Return {"classes":[{"subject":"Course","day":"Monday","start_time":"09:00","end_time":"10:30","room":"CS-201","teacher":"Name"}]}. Use full English weekdays (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday) and 24-hour HH:MM. Expand multi-day cells. Ignore break intervals.',
    {
      image: { base64, mimeType },
      json: true,
      system: 'Extract university timetables accurately. Return JSON only.',
      validate: (v) => {
        const raw = rows(v, 'classes');
        const out = raw.map((x) => {
          const r = x as Record<string, unknown>;
          return {
            subject: scalar(r.subject),
            day: scalar(r.day),
            start_time: scalar(r.start_time ?? r.start),
            end_time: scalar(r.end_time ?? r.end),
            room: scalar(r.room),
            teacher: scalar(r.teacher),
          };
        });
        if (!out.length || out.some((r) => !r.subject || !r.day || !r.start_time || !r.end_time)) {
          throw new Error('Could not identify valid timetable classes. Please ensure day and time are legible.');
        }
        return out;
      },
    }
  );
  return result.data;
}

export async function parseTranscriptImage(base64: string, mimeType: string) {
  const result = await askAI<GradeDraft[]>(
    'Read this transcript or result card. Return {"courses":[{"subject":"Course","credit_hours":"3","grade":"B+","marks":"78"}]}. Use displayed grades; otherwise leave grade empty and include marks.',
    {
      image: { base64, mimeType },
      json: true,
      system: 'Extract transcript rows accurately. Return JSON only.',
      validate: (v) => {
        const raw = rows(v, 'courses');
        const out = raw.map((x) => {
          const r = x as Record<string, unknown>;
          return {
            subject: scalar(r.subject ?? r.course),
            credit_hours: scalar(r.credit_hours ?? r.credits),
            grade: scalar(r.grade).toUpperCase(),
            marks: scalar(r.marks),
          };
        });
        if (!out.length || out.some((r) => !r.subject || !r.credit_hours)) {
          throw new Error('Could not identify valid course rows with credit hours.');
        }
        return out;
      },
    }
  );
  return result.data;
}

export async function generateFlashcardsFromText(content: string) {
  if (!content.trim()) throw new Error('Add some note content first.');
  const result = await askAI<FlashcardDraft[]>(
    `Create 6 to 12 flashcards from this material. Return {"cards":[{"front":"Question","back":"Answer"}]}.\nMATERIAL:\n${content.slice(0, 28000)}`,
    {
      json: true,
      fast: true,
      system: 'Create concise, accurate study flashcards. Return JSON only.',
      validate: (v) => {
        const raw = rows(v, 'cards');
        const out = raw.map((x) => {
          const r = x as Record<string, unknown>;
          return {
            front: scalar(r.front ?? r.question),
            back: scalar(r.back ?? r.answer),
          };
        });
        if (!out.length || out.some((c) => !c.front || !c.back)) {
          throw new Error('Could not generate valid question/answer flashcards.');
        }
        return out;
      },
    }
  );
  return result.data;
}

export type MockQuestion = { question: string; options: string[]; correct_index: number };

export async function generateMockQuiz(topic: string) {
  return askAI<MockQuestion[]>(
    `Create exactly 10 multiple-choice questions about: ${topic}. Return {"questions":[{"question":"...","options":["A","B","C","D"],"correct_index":0}]}. Each question must have exactly four options and correct_index must be 0-3.`,
    {
      json: true,
      system: 'Create accurate university-level mock quizzes. Return JSON only.',
      validate: (v) => {
        const raw = rows(v, 'questions');
        const out = raw.map((x) => {
          const r = x as Record<string, unknown>;
          return {
            question: scalar(r.question),
            options: Array.isArray(r.options) ? r.options.map(scalar) : [],
            correct_index: Number(r.correct_index),
          };
        });
        if (
          out.length !== 10 ||
          out.some(
            (q) =>
              !q.question ||
              q.options.length !== 4 ||
              !Number.isInteger(q.correct_index) ||
              q.correct_index < 0 ||
              q.correct_index > 3
          )
        ) {
          throw new Error('Generated quiz did not have exactly 10 questions with 4 options each.');
        }
        return out;
      },
    }
  );
}

// -------------------------------------------------------------
// Voice Note -> Auto Task Extraction
// -------------------------------------------------------------
export async function extractTaskFromSpokenNote(
  transcript: string,
  existingSubjects: Subject[]
): Promise<SpokenTaskDraft> {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const nowIso = now.toISOString();
  const subjectsList = existingSubjects.map((s) => s.name).join(', ') || 'None';

  const prompt = `Extract a task from this spoken voice note.
Today's date and time is: ${todayStr} (Current ISO: ${nowIso}).
Existing student subjects: ${subjectsList}.

Spoken voice note:
"${transcript}"

Extract the following information and return valid JSON only:
{
  "title": "Clear and concise task title (string)",
  "type": "assignment" | "quiz" | "exam" | "todo",
  "subject": "Name of the matching existing subject if mentioned, or null if not mentioned",
  "due_at": "ISO-8601 string (e.g. 2026-09-26T17:00:00.000Z) if a deadline is mentioned, or null if no deadline is specified",
  "priority": "low" | "medium" | "high",
  "notes": "Any extra details, requirements, or instructions mentioned (string or null)"
}

Rules:
1. Resolve relative dates like 'tomorrow', 'next Monday', 'by Friday 4pm', 'in 3 days' based on today's actual date: ${todayStr}.
2. If no due date or time is explicitly stated or strongly implied, leave due_at as null. DO NOT guess a date.
3. Match subject to one of the provided existing student subjects if possible. If not mentioned or unsure, leave subject as null.
4. Default type to "todo" if it's general work, or "assignment" / "quiz" / "exam" if mentioned.
5. Return JSON only without any markdown code fences.`;

  const result = await askAI<{
    title: string;
    type?: string;
    subject?: string | null;
    due_at?: string | null;
    priority?: string;
    notes?: string | null;
  }>(prompt, {
    json: true,
    fast: true,
    system: 'You are an intelligent task parser for students. Return structured JSON only.',
    validate: (v) => {
      const obj = v as Record<string, unknown>;
      if (!obj || typeof obj !== 'object') throw new Error('Invalid AI task response');
      return {
        title: scalar(obj.title),
        type: scalar(obj.type),
        subject: obj.subject ? scalar(obj.subject) : null,
        due_at: obj.due_at ? scalar(obj.due_at) : null,
        priority: scalar(obj.priority),
        notes: obj.notes ? scalar(obj.notes) : null,
      };
    },
  });

  const parsed = result.data;
  const validTypes: TaskType[] = ['assignment', 'quiz', 'exam', 'todo'];
  const taskType: TaskType = validTypes.includes(parsed.type as TaskType)
    ? (parsed.type as TaskType)
    : 'todo';

  let matchedSubject: Subject | undefined;
  if (parsed.subject) {
    const cleanSub = parsed.subject.toLowerCase();
    matchedSubject = existingSubjects.find(
      (s) =>
        s.name.toLowerCase() === cleanSub ||
        s.name.toLowerCase().includes(cleanSub) ||
        cleanSub.includes(s.name.toLowerCase())
    );
  }

  let validDueAt: string | null = null;
  if (parsed.due_at) {
    const timestamp = Date.parse(parsed.due_at);
    if (!Number.isNaN(timestamp)) {
      validDueAt = new Date(timestamp).toISOString();
    }
  }

  const priority = ['low', 'medium', 'high'].includes(parsed.priority || '')
    ? (parsed.priority as 'low' | 'medium' | 'high')
    : 'medium';

  return {
    title: parsed.title || transcript.slice(0, 50),
    type: taskType,
    subject_name: matchedSubject?.name ?? null,
    subject_id: matchedSubject?.id ?? null,
    due_at: validDueAt,
    priority,
    notes: parsed.notes ?? null,
    raw_transcript: transcript,
  };
}

// -------------------------------------------------------------
// Document / Image Text Extraction (Gemini Vision OCR / Reader)
// -------------------------------------------------------------
export async function extractTextFromFile(params: {
  base64?: string;
  mimeType: string;
  textContent?: string;
  fileName?: string;
}): Promise<string> {
  if (params.textContent) {
    return params.textContent.trim();
  }

  if (!params.base64) {
    throw new Error('No file data provided to extract text from.');
  }

  const prompt = `Please accurately extract and transcribe all readable text, notes, equations, diagrams, and headings from this document/image. Present it as structured, clean markdown suitable for a student's study notes. If handwriting is present, transcribe it accurately.`;

  const result = await askAI<string>(prompt, {
    image: {
      base64: params.base64,
      mimeType: params.mimeType,
    },
    system:
      'You are a high-accuracy document and notes OCR transcription assistant. Transcribe and extract all textual information into clean, readable markdown notes.',
  });

  return result.data;
}
