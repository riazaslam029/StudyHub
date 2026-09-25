import * as SecureStore from 'expo-secure-store';
import { getSetting, setSetting } from './db';
import { FlashcardDraft, GradeDraft, SpokenTaskDraft, Subject, TaskType, TimetableDraft } from './types';

export type AIProvider = 'gemini' | 'groq';
export type AIResult<T = string> = { data: T; provider: AIProvider };

const GEMINI_KEY = 'studyhub_gemini_api_key';
const GROQ_KEY = 'studyhub_groq_api_key';

// Standard official model names
const PRIMARY_GEMINI_MODEL = 'gemini-2.0-flash';
const FALLBACK_GEMINI_MODEL = 'gemini-1.5-flash';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

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

export const getGroqApiKey = async () => {
  const key = await SecureStore.getItemAsync(GROQ_KEY);
  return key?.trim() || null;
};

export const setGroqApiKey = async (key: string) => {
  await storeKey(GROQ_KEY, key);
  const verify = await getGroqApiKey();
  console.log(`[AI Key] Groq key saved. Verified retrievable: ${!!verify}, length: ${verify?.length ?? 0}`);
};

export async function getPrimaryProvider(): Promise<AIProvider> {
  const setting = await getSetting('primary_ai_provider');
  return setting === 'groq' ? 'groq' : 'gemini';
}

export async function setPrimaryProvider(provider: AIProvider) {
  await setSetting('primary_ai_provider', provider);
  console.log(`[AI Settings] Primary provider set to: ${provider}`);
}

export async function getAIKeyStatus() {
  const [gemini, groq] = await Promise.all([getApiKey(), getGroqApiKey()]);
  return { gemini: !!gemini, groq: !!groq };
}

async function timedFetch(url: string, init: RequestInit, provider: AIProvider, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError(provider, `Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    const msg = error instanceof Error ? error.message : 'Network request failed';
    throw new ProviderError(provider, `Network error (${msg}). Check your internet connection.`);
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
          ...(options.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
    'gemini',
    options.timeoutMs ?? 30000
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
  try {
    return await executeGeminiRequest(PRIMARY_GEMINI_MODEL, prompt, key, options);
  } catch (error) {
    if (error instanceof ProviderError && (error.status === 404 || error.message.includes('not found'))) {
      console.warn(`[Gemini] ${PRIMARY_GEMINI_MODEL} not found, falling back to ${FALLBACK_GEMINI_MODEL}`);
      return await executeGeminiRequest(FALLBACK_GEMINI_MODEL, prompt, key, options);
    }
    throw error;
  }
}

async function requestGroq(prompt: string, key: string, options: AIOptions<unknown>) {
  if (options.image) {
    throw new ProviderError('groq', 'Groq models do not support image processing. Please configure Gemini for images.');
  }

  const model = options.fast ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile';
  let systemMessage = options.system ?? 'You are StudyHub, a clear and practical study assistant.';

  // Groq json_object mode requires that the prompt or system message contains the word "json"
  if (options.json && !systemMessage.toLowerCase().includes('json') && !prompt.toLowerCase().includes('json')) {
    systemMessage += ' Respond in valid JSON format.';
  }

  const response = await timedFetch(
    GROQ_ENDPOINT,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt },
        ],
        temperature: options.json ? 0 : 0.35,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    },
    'groq',
    options.timeoutMs ?? 30000
  );

  const rawText = await response.text();
  let body: {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string; code?: string; type?: string };
  } = {};

  try {
    body = JSON.parse(rawText);
  } catch {
    // Body is not JSON
  }

  if (!response.ok || body.error) {
    const errorMsg = body.error?.message || `HTTP ${response.status}: ${rawText.slice(0, 200) || response.statusText}`;
    throw new ProviderError('groq', errorMsg, response.status);
  }

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ProviderError('groq', 'Empty response returned by Groq model');
  return text;
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
  const primary = await getPrimaryProvider();
  const status = await getAIKeyStatus();

  // Execution order: respect user toggle, with Groq falling back to Gemini or vice-versa
  const order: AIProvider[] = options.image
    ? ['gemini']
    : [primary, primary === 'gemini' ? 'groq' : 'gemini'];

  const errors: string[] = [];

  for (const provider of order) {
    const key = provider === 'gemini' ? await getApiKey() : await getGroqApiKey();
    if (!key) {
      continue;
    }

    const attempts = options.json ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const strictPrompt =
          attempt === 0
            ? prompt
            : `${prompt}\nSTRICT RETRY: Return one valid JSON object only, without markdown fences or commentary.`;

        console.log(`[AI] Attempting ${provider} (attempt ${attempt + 1}/${attempts})...`);
        const raw =
          provider === 'gemini'
            ? await requestGemini(strictPrompt, key, options)
            : await requestGroq(strictPrompt, key, options);

        const value = options.json
          ? options.validate
            ? options.validate(extractJson(raw))
            : extractJson(raw)
          : raw;

        console.log(`[AI] Success with provider: ${provider}`);
        return { data: value as T, provider };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[AI] Error with ${provider}:`, errorMsg);
        errors.push(`[${provider.toUpperCase()}] ${errorMsg}`);

        // If client error (e.g. 400 Invalid key, 401 Unauthorized, 403 Forbidden), don't retry same provider
        if (error instanceof ProviderError && error.status && [400, 401, 403].includes(error.status)) {
          break;
        }
        if (!options.json || error instanceof ProviderError) {
          break;
        }
      }
    }
  }

  // Clear, detailed error messages
  if (!status.gemini && !status.groq) {
    throw new Error('No AI API keys configured. Please add your Gemini or Groq key in Settings first.');
  }

  if (options.image && !status.gemini) {
    throw new Error('Image and document AI requires a Gemini API key. Please add a Gemini key in Settings.');
  }

  if (errors.length > 0) {
    throw new Error(`AI request failed:\n${errors.join('\n')}`);
  }

  throw new Error('AI request could not be completed. Please check your API keys and internet connection.');
}

// Test providers independently with a simple prompt
export async function testGeminiConnection(customKey?: string): Promise<{ success: boolean; message: string }> {
  const key = customKey?.trim() || (await getApiKey());
  if (!key) return { success: false, message: 'No Gemini API key provided.' };

  try {
    const text = await executeGeminiRequest(
      PRIMARY_GEMINI_MODEL,
      'Hello! Please reply with exactly: "StudyHub Gemini is connected."',
      key,
      { system: 'Be extremely concise.', timeoutMs: 15000 }
    );
    return { success: true, message: text };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Connection failed';
    return { success: false, message: msg };
  }
}

export async function testGroqConnection(customKey?: string): Promise<{ success: boolean; message: string }> {
  const key = customKey?.trim() || (await getGroqApiKey());
  if (!key) return { success: false, message: 'No Groq API key provided.' };

  try {
    const text = await requestGroq(
      'Hello! Please reply with exactly: "StudyHub Groq is connected."',
      key,
      { system: 'Be extremely concise.', timeoutMs: 15000 }
    );
    return { success: true, message: text };
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

  // Match subject to existing subjects
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

  // Validate due_at date format
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
  // If plain text content is already available
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
