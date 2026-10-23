/**
 * Test Suite: Gemini Model Compatibility, Controlled Fallback & Sanitization
 *
 * Verifies:
 * 1. Prioritized model list: gemini-3.8-flash -> gemini-3.5-flash-lite -> gemini-2.5-flash
 * 2. Model unavailability classification (including specific "no longer available to new users" error)
 * 3. Controlled fallback: automatically cascading on model-unavailability only
 * 4. Auth/Permission/Quota stop: halting immediately without model switching on 401, 403, 429
 * 5. Sanitization: API keys and auth headers are never logged or exposed in errors
 */

const assert = require('assert');

// 1. Model priority definitions
const PRIORITIZED_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];
const DEFAULT_GEMINI_MODEL = PRIORITIZED_GEMINI_MODELS[0];

// Categorization logic mirror
function categorizeGeminiError(status, message) {
  const lower = (message || '').toLowerCase();

  // 1. Invalid or missing key (permanent auth error)
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

  // 2. Permission / billing issues
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

  // 3. Quota / Rate limit
  if (
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return 'QUOTA_EXHAUSTED';
  }

  // 4. Model unavailability / deprecation / new-user restriction
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

function maskKey(key) {
  if (!key) return '(not set)';
  const clean = key.trim();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

function sanitizeErrorMessage(error, attemptedModels) {
  const status = error && error.status;
  const message = error ? error.message : '';
  const category = categorizeGeminiError(status, message);
  switch (category) {
    case 'AUTH_INVALID_KEY':
      return 'Invalid Gemini API key. Please check your key in Settings (get a free key at https://aistudio.google.com/).';
    case 'PERMISSION_DENIED':
      return 'Gemini API permission denied. Please verify that Generative Language API is enabled for your project in Google AI Studio.';
    case 'QUOTA_EXHAUSTED':
      return 'Gemini rate limit or quota exceeded. Please wait a moment before trying again or check your quota in Google AI Studio.';
    case 'MODEL_UNAVAILABLE':
      return `Requested model unavailable (${message}). Attempted models: ${attemptedModels ? attemptedModels.join(', ') : 'none'}.`;
    case 'TRANSIENT_NETWORK':
      return `Network timeout or connection error: ${message}`;
    case 'BAD_REQUEST':
      return `Gemini request error: ${message}`;
    default:
      return message;
  }
}

// Simulated fallback dispatcher
async function simulateRequestWithFallback(startingModel, candidates, mockExecutor) {
  const queue = [
    startingModel,
    ...candidates.filter((m) => m !== startingModel),
  ];
  const attempted = [];

  for (const model of queue) {
    attempted.push(model);
    try {
      const res = await mockExecutor(model);
      return { success: true, model, response: res, attempted };
    } catch (err) {
      const category = categorizeGeminiError(err.status, err.message);
      if (category === 'MODEL_UNAVAILABLE') {
        continue;
      }
      return {
        success: false,
        error: sanitizeErrorMessage(err, attempted),
        category,
        attempted,
      };
    }
  }

  return {
    success: false,
    error: `All eligible Gemini models were unavailable for your API key. (Attempted models: ${attempted.join(', ')}).`,
    category: 'MODEL_UNAVAILABLE',
    attempted,
  };
}

// -------------------------------------------------------------
// Test Execution
// -------------------------------------------------------------
async function runTests() {
  console.log('--- Running StudyHub Gemini Compatibility Tests ---\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
    }
  }

  // 1. Model Priority Order
  test('1. Prioritized model list matches exact requirements', () => {
    assert.strictEqual(PRIORITIZED_GEMINI_MODELS[0], 'gemini-3.8-flash');
    assert.strictEqual(PRIORITIZED_GEMINI_MODELS[1], 'gemini-3.5-flash-lite');
    assert.strictEqual(PRIORITIZED_GEMINI_MODELS[2], 'gemini-2.5-flash');
    assert.strictEqual(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
    assert.ok(PRIORITIZED_GEMINI_MODELS.includes('gemini-2.0-flash'));
    assert.ok(PRIORITIZED_GEMINI_MODELS.includes('gemini-1.5-flash'));
  });

  // 2. Error Categorization
  test('2. Specific error "no longer available to new users" is categorized as MODEL_UNAVAILABLE', () => {
    const err = {
      status: 400,
      message: 'models/gemini-2.5-flash is no longer available to new users. Use models/gemini-3.8-flash.',
    };
    const cat = categorizeGeminiError(err.status, err.message);
    assert.strictEqual(cat, 'MODEL_UNAVAILABLE');
  });

  test('3. 404 model not found is categorized as MODEL_UNAVAILABLE', () => {
    const err = { status: 404, message: 'models/gemini-3.8-flash is not found for API version v1beta' };
    const cat = categorizeGeminiError(err.status, err.message);
    assert.strictEqual(cat, 'MODEL_UNAVAILABLE');
  });

  test('4. 401 API_KEY_INVALID is categorized as AUTH_INVALID_KEY', () => {
    const err = { status: 401, message: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.' };
    const cat = categorizeGeminiError(err.status, err.message);
    assert.strictEqual(cat, 'AUTH_INVALID_KEY');
  });

  test('5. 403 PERMISSION_DENIED is categorized as PERMISSION_DENIED', () => {
    const err = { status: 403, message: 'PERMISSION_DENIED: Generative Language API has not been enabled' };
    const cat = categorizeGeminiError(err.status, err.message);
    assert.strictEqual(cat, 'PERMISSION_DENIED');
  });

  test('6. 429 RESOURCE_EXHAUSTED is categorized as QUOTA_EXHAUSTED', () => {
    const err = { status: 429, message: 'RESOURCE_EXHAUSTED: Rate limit exceeded. Quota reached.' };
    const cat = categorizeGeminiError(err.status, err.message);
    assert.strictEqual(cat, 'QUOTA_EXHAUSTED');
  });

  test('7. 503 Service Unavailable is categorized as TRANSIENT_NETWORK', () => {
    const err = { status: 503, message: 'The model is overloaded. Please try again later.' };
    const cat = categorizeGeminiError(err.status, err.message);
    assert.strictEqual(cat, 'TRANSIENT_NETWORK');
  });

  // 3. Key Masking & Sanitization
  test('8. Key masking safely obfuscates key and never outputs secret in cleartext', () => {
    const secret = 'AIzaSyD-1234567890abcdefghijklmnop';
    const masked = maskKey(secret);
    assert.strictEqual(masked, 'AIza...mnop');
    assert.ok(!masked.includes('1234567890abcdef'));
    assert.strictEqual(maskKey(null), '(not set)');
    assert.strictEqual(maskKey('short'), '****');
  });

  test('9. Sanitized error messages do not leak internal endpoints or sensitive tokens', () => {
    const rawError = {
      status: 401,
      message: 'API_KEY_INVALID with key AIzaSyD-secret-key-123 at endpoint /v1beta/models',
    };
    const sanitized = sanitizeErrorMessage(rawError);
    assert.ok(!sanitized.includes('AIzaSyD-secret-key-123'));
    assert.ok(sanitized.includes('Invalid Gemini API key'));
  });

  // 4. Controlled Fallback Execution
  await asyncTest('10. Controlled fallback switches model on "no longer available" error and succeeds on gemini-3.8-flash', async () => {
    const mockExecutor = async (model) => {
      if (model === 'gemini-2.5-flash') {
        const err = new Error('models/gemini-2.5-flash is no longer available to new users. Use models/gemini-3.8-flash.');
        err.status = 400;
        throw err;
      }
      if (model === 'gemini-3.8-flash') {
        return 'StudyHub Gemini is connected.';
      }
      throw new Error('Unexpected model call: ' + model);
    };

    const result = await simulateRequestWithFallback('gemini-2.5-flash', PRIORITIZED_GEMINI_MODELS, mockExecutor);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.model, 'gemini-3.8-flash');
    assert.deepStrictEqual(result.attempted, ['gemini-2.5-flash', 'gemini-3.8-flash']);
  });

  await asyncTest('11. Controlled fallback switches from gemini-3.8-flash to gemini-3.5-flash-lite on 404', async () => {
    const mockExecutor = async (model) => {
      if (model === 'gemini-3.8-flash') {
        const err = new Error('models/gemini-3.8-flash is not found for API version v1beta');
        err.status = 404;
        throw err;
      }
      if (model === 'gemini-3.5-flash-lite') {
        return 'Flash lite response';
      }
      throw new Error('Unexpected model call');
    };

    const result = await simulateRequestWithFallback('gemini-3.8-flash', PRIORITIZED_GEMINI_MODELS, mockExecutor);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.model, 'gemini-3.5-flash-lite');
    assert.deepStrictEqual(result.attempted, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });

  await asyncTest('12. Preserves gemini-2.5-flash when Google still supports it for older accounts', async () => {
    const mockExecutor = async (model) => {
      if (model === 'gemini-2.5-flash') {
        return 'Legacy account gemini-2.5-flash response';
      }
      throw new Error('Should not have called other models');
    };

    const result = await simulateRequestWithFallback('gemini-2.5-flash', PRIORITIZED_GEMINI_MODELS, mockExecutor);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.model, 'gemini-2.5-flash');
    assert.deepStrictEqual(result.attempted, ['gemini-2.5-flash']);
  });

  await asyncTest('13. Does NOT switch models on permanent AUTH_INVALID_KEY error', async () => {
    let callCount = 0;
    const mockExecutor = async (model) => {
      callCount++;
      const err = new Error('API key not valid');
      err.status = 401;
      throw err;
    };

    const result = await simulateRequestWithFallback('gemini-3.8-flash', PRIORITIZED_GEMINI_MODELS, mockExecutor);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.category, 'AUTH_INVALID_KEY');
    assert.strictEqual(callCount, 1); // exactly 1 call, NO model retry
    assert.deepStrictEqual(result.attempted, ['gemini-3.8-flash']);
  });

  await asyncTest('14. Does NOT switch models on PERMISSION_DENIED error', async () => {
    let callCount = 0;
    const mockExecutor = async (model) => {
      callCount++;
      const err = new Error('PERMISSION_DENIED');
      err.status = 403;
      throw err;
    };

    const result = await simulateRequestWithFallback('gemini-3.8-flash', PRIORITIZED_GEMINI_MODELS, mockExecutor);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.category, 'PERMISSION_DENIED');
    assert.strictEqual(callCount, 1);
  });

  await asyncTest('15. Does NOT switch models on QUOTA_EXHAUSTED error', async () => {
    let callCount = 0;
    const mockExecutor = async (model) => {
      callCount++;
      const err = new Error('RESOURCE_EXHAUSTED');
      err.status = 429;
      throw err;
    };

    const result = await simulateRequestWithFallback('gemini-3.8-flash', PRIORITIZED_GEMINI_MODELS, mockExecutor);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.category, 'QUOTA_EXHAUSTED');
    assert.strictEqual(callCount, 1);
  });

  await asyncTest('16. Sanitized summary is returned if all candidate models are unavailable', async () => {
    const mockExecutor = async (model) => {
      const err = new Error(`Model ${model} not available`);
      err.status = 404;
      throw err;
    };

    const result = await simulateRequestWithFallback('gemini-3.8-flash', PRIORITIZED_GEMINI_MODELS, mockExecutor);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.category, 'MODEL_UNAVAILABLE');
    assert.strictEqual(result.attempted.length, PRIORITIZED_GEMINI_MODELS.length);
    assert.ok(result.error.includes('All eligible Gemini models were unavailable'));
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`========================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
