import * as SecureStore from 'expo-secure-store';
import { FlashcardDraft, GradeDraft, SpokenTaskDraft, Subject, TaskType, TimetableDraft } from './types';

export type AIProvider = 'gemini';
export type AIResult<T = string> = { data: T; provider: AIProvider };

const GEMINI_KEY = 'studyhub_gemini_api_key';
const GEMINI_CACHED_MODEL_KEY = 'studyhub_gemini_cached_model';
const GEMINI_MODEL_PREF_KEY = 'studyhub_gemini_model_preference';

// Default and comprehensive prioritized candidates for Google Gemini
// Covers Gemini 2.5, 2.0, 1.5, 3.x preview, flash-lite, flash-8b, and pro models
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

export const GEMINI_CANDIDATES = [
  // High-speed Flash models (optimal for mobile & OCR)
  'gemini-2.5-flash',
  'gemini-2.5-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-preview-02-05',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash-8b-latest',
  // Preview / Next-Gen models (Gemini 3 / Experimental)
  'gemini-3.0-flash',
  'gemini-3-flash',
  'gemini-3.0-pro',
  'gemini-3-pro',
  'gemini-2.0-flash-exp',
  'gemini-2.0-pro-exp-02-05',
  'gemini-exp-1206',
  // Pro models (higher capability fallback)
  'gemini-2.5-pro',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
  'gemini-1.0-pro',
];

let cachedGeminiModel: string | null = null;

async function setCachedModel(model: string) {
  cachedGeminiModel = model;
  try {
    await SecureStore.setItemAsync(GEMINI_CACHED_MODEL_KEY, model);
  } catch {
    // ignore secure store write failure
  }
}

export async function getActiveGeminiModel(): Promise<string> {
  if (cachedGeminiModel) return cachedGeminiModel;
  try {
    const saved = await SecureStore.getItemAsync(GEMINI_CACHED_MODEL_KEY);
    if (saved && saved.trim()) {
      cachedGeminiModel = saved.trim();
      return cachedGeminiModel;
    }
  } catch {
    // continue
  }
  return DEFAULT_GEMINI_MODEL;
}

export async function getModelPreference(): Promise<string | null> {
  try {
    const pref = await SecureStore.getItemAsync(GEMINI_MODEL_PREF_KEY);
    return pref?.trim() || null;
  } catch {
    return null;
  }
}

export async function setModelPreference(preference: string | null): Promise<void> {
  try {
    if (preference && preference.trim() && preference !== 'auto') {
      await SecureStore.setItemAsync(GEMINI_MODEL_PREF_KEY, preference.trim());
      await setCachedModel(preference.trim());
    } else {
      await SecureStore.deleteItemAsync(GEMINI_MODEL_PREF_KEY);
      cachedGeminiModel = null;
    }
  } catch (e) {
    console.warn('[Gemini] Could not save model preference:', e);
  }
}

export async function discoverGeminiModel(key: string, forceRefresh = false): Promise<string> {
  // 1. Honor explicit user preference if configured
  const userPref = await getModelPreference();
  if (userPref && userPref !== 'auto') {
    cachedGeminiModel = userPref;
    return userPref;
  }

  // 2. Use in-memory or persisted cache to avoid 1-2s network discovery latency
  if (!forceRefresh) {
    if (cachedGeminiModel) return cachedGeminiModel;
    try {
      const persisted = await SecureStore.getItemAsync(GEMINI_CACHED_MODEL_KEY);
      if (persisted && persisted.trim()) {
        cachedGeminiModel = persisted.trim();
        return cachedGeminiModel;
      }
    } catch {
      // continue to dynamic discovery
    }
  }

  // 3. Dynamic discovery via Google Generative Language v1beta ListModels
  try {
    const res = await timedFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { method: 'GET' },
      6000 // fast 6s timeout
    );

    if (res.ok) {
      const data = (await res.json()) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[];
      };
      const available = (data.models || [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''));

      console.log(`[Gemini] Discovered ${available.length} models for key`);

      // Match against prioritized candidate list
      for (const cand of GEMINI_CANDIDATES) {
        const match = available.find((m) => m === cand || m.startsWith(`${cand}-`));
        if (match) {
          console.log(`[Gemini] Matched priority model: ${match}`);
          await setCachedModel(match);
          return match;
        }
      }

      // If no exact candidate matched, pick any available flash model
      const flash = available.find((m) => m.toLowerCase().includes('flash'));
      if (flash) {
        console.log(`[Gemini] Matched available flash model: ${flash}`);
        await setCachedModel(flash);
        return flash;
      }

      // Or any available model that supports generation
      const anyModel = available[0];
      if (anyModel) {
        console.log(`[Gemini] Fallback to available model: ${anyModel}`);
        await setCachedModel(anyModel);
        return anyModel;
      }
    }
  } catch (error) {
    console.warn('[Gemini] Model discovery query failed or restricted, falling back to candidate hierarchy:', error);
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
  maxTokens?: number;
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
  try {
    await SecureStore.deleteItemAsync(GEMINI_CACHED_MODEL_KEY);
  } catch {
    // ignore
  }
  const check = await SecureStore.getItemAsync(key);
  console.log(`[SecureStore] Key "${key}" updated -> stored length: ${check?.length ?? 0}`);
}

export const getApiKey = async () => {
  const key = await SecureStore.getItemAsync(GEMINI_KEY);
  return key?.trim() || null;
};

export const setApiKey = async (key: string) => {
  await storeKey(GEMINI_KEY, key);
  const verify = await getApiKey();
  console.log(`[AI Key] Gemini key saved. Verified retrievable: ${!!verify}, length: ${verify?.length ?? 0}`);
};

export async function getAIKeyStatus() {
  const gemini = await getApiKey();
  return { gemini: !!gemini };
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number) {
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

async function executeGeminiRequest(modelName: string, prompt: string, key: string, options: AIOptions<unknown>) {
  const parts: GeminiPart[] = [{ text: prompt }];
  if (options.image) {
    parts.push({
      inlineData: {
        mimeType: options.image.mimeType,
        data: options.image.base64,
      },
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(key)}`;
  const systemText = options.system ?? 'You are StudyHub, a clear and practical study assistant.';
  const maxOutputTokens = options.maxTokens ?? (options.fast ? 800 : 2500);

  const response = await timedFetch(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
          maxOutputTokens,
          ...(options.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
    options.timeoutMs ?? (options.fast ? 15000 : 35000)
  );

  const rawText = await response.text();
  let body: {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { code?: number; message?: string; status?: string };
  } = {};

  try {
    body = JSON.parse(rawText);
  } catch {
    // Body is not JSON
  }

  if (!response.ok || body.error) {
    const errorMsg = body.error?.message || `HTTP ${response.status}: ${rawText.slice(0, 200) || response.statusText}`;
    throw new ProviderError('gemini', errorMsg, response.status);
  }

  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new ProviderError('gemini', 'Empty response returned by Gemini model');
  return text;
}

async function requestGemini(prompt: string, key: string, options: AIOptions<unknown>) {
  const primaryModel = await discoverGeminiModel(key);
  try {
    return await executeGeminiRequest(primaryModel, prompt, key, options);
  } catch (error) {
    const isModelError =
      error instanceof ProviderError &&
      (error.status === 404 ||
        error.status === 400 ||
        error.status === 429 ||
        error.status === 503 ||
        error.message.includes('not found') ||
        error.message.includes('no longer available') ||
        error.message.includes('not supported for generateContent') ||
        error.message.includes('RESOURCE_EXHAUSTED') ||
        error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('INVALID_ARGUMENT'));

    if (isModelError) {
      console.warn(`[Gemini] Model "${primaryModel}" encountered issue (${(error as Error).message}). Retrying candidate models...`);
      for (const cand of GEMINI_CANDIDATES) {
        if (cand !== primaryModel) {
          try {
            console.log(`[Gemini] Retrying with candidate model: ${cand}`);
            const result = await executeGeminiRequest(cand, prompt, key, options);
            await setCachedModel(cand);
            return result;
          } catch {
            // continue next candidate
          }
        }
      }
    }
    throw error;
  }
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
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn('[Gemini] Request failed:', errorMsg);
      errors.push(errorMsg);

      if (error instanceof ProviderError && error.status && [401, 403].includes(error.status) && !error.message.includes('PERMISSION_DENIED: Model')) {
        break;
      }
      if (!options.json || error instanceof ProviderError) {
        break;
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Gemini AI request failed:\n${errors.join('\n')}`);
  }

  throw new Error('AI request could not be completed. Please check your Gemini API key and internet connection.');
}

// Test Gemini provider with comprehensive multi-model resilience
export async function testGeminiConnection(customKey?: string): Promise<{ success: boolean; message: string; model?: string }> {
  const key = customKey?.trim() || (await getApiKey());
  if (!key) return { success: false, message: 'No Gemini API key provided.' };

  try {
    let modelToTest = await discoverGeminiModel(key, true);
    let replyText = '';
    let successModel = '';

    const testPrompt = 'Hello! Please reply with exactly: "StudyHub Gemini is connected."';
    const testOptions = { system: 'Be extremely concise.', timeoutMs: 12000, fast: true, maxTokens: 40 };

    try {
      replyText = await executeGeminiRequest(modelToTest, testPrompt, key, testOptions);
      successModel = modelToTest;
    } catch {
      // Primary model failed or restricted; cascade through candidates
      for (const cand of GEMINI_CANDIDATES) {
        if (cand !== modelToTest) {
          try {
            replyText = await executeGeminiRequest(cand, testPrompt, key, testOptions);
            successModel = cand;
            break;
          } catch {
            // try next candidate
          }
        }
      }
    }

    if (successModel && replyText) {
      await setCachedModel(successModel);
      return {
        success: true,
        message: `${replyText}\n(Model: ${successModel})`,
        model: successModel,
      };
    }

    throw new Error('None of the supported Gemini models responded with this key. Please verify your API key at ai.google.dev.');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Connection failed';
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
