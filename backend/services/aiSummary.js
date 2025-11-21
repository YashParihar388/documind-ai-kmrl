import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import xlsx from 'xlsx';

dotenv.config();
console.log(
  'Loading Gemini API key:',
  process.env.GEMINI_API_KEY ? 'Key found (length: ' + process.env.GEMINI_API_KEY.length + ')' : 'No key found'
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fallback model list (priority order)
const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL,          // override via .env if set
  'gemini-2.5-flash',               // recommended production model
  'gemini-2.5-flash-lite'           // cheaper & faster alternative
].filter(Boolean);

/**
 * Extract text from supported file types.
 */
export async function extractTextFromFile(filePath, mimetype) {
  let text = '';
  switch (mimetype) {
    case 'application/pdf': {
      const pdfBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(pdfBuffer);
      text = pdfData.text;
      break;
    }
    case 'application/msword':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const docBuffer = await fs.readFile(filePath);
      const docResult = await mammoth.extractRawText({ buffer: docBuffer });
      text = docResult.value;
      break;
    }
    case 'application/vnd.ms-excel':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
      const workbook = xlsx.readFile(filePath);
      const sheets = workbook.SheetNames;
      text = sheets
        .map((sheet) => {
          const worksheet = workbook.Sheets[sheet];
          return xlsx.utils.sheet_to_txt(worksheet);
        })
        .join('\n\n');
      break;
    }
    case 'text/plain': {
      text = await fs.readFile(filePath, 'utf8');
      break;
    }
    default:
      throw new Error('Unsupported file type');
  }
  return text;
}

/**
 * Try to extract JSON from a text response safely.
 * Returns parsed object or null.
 */
function safeParseJSONFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // 1) Try to find a fenced ```json block
  let match = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch (e) {
      // continue to other methods
    }
  }

  // 2) Try to find the first top-level JSON object/block (greedy)
  match = text.match(/\{[\s\S]*\}/);
  if (match && match[0]) {
    const candidate = match[0];
    try {
      return JSON.parse(candidate);
    } catch (e) {
      // try to recover by replacing trailing commas or common issues
      try {
        const cleaned = candidate
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        return JSON.parse(cleaned);
      } catch (e2) {
        // give up on this attempt
      }
    }
  }

  // 3) Try to JSON.parse the whole text (if it's pure JSON)
  try {
    return JSON.parse(text);
  } catch (e) {
    // not JSON
  }

  return null;
}

/**
 * Generate content using the configured models in FALLBACK_MODELS.
 * Returns { text: string, model: string } on success or throws if none succeed.
 */
async function generateWithFallbackModels(prompt) {
  let lastError;
  const apiKey = process.env.GEMINI_API_KEY || '';
  const useApiKeyMode = apiKey.startsWith('AIza');

  async function restGenerate(modelId, promptText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: { text: promptText } })
    });
    if (!resp.ok) {
      const body = await resp.text();
      const e = new Error(`REST generate failed: ${resp.status} ${resp.statusText} - ${body}`);
      e.status = resp.status;
      e.body = body;
      throw e;
    }
    const json = await resp.json();
    // Extract possible text locations
    if (json?.candidates && Array.isArray(json.candidates) && json.candidates.length > 0) {
      const cand = json.candidates[0];
      return cand?.content?.[0]?.text || cand?.output || cand?.text || JSON.stringify(cand);
    }
    if (json?.output && Array.isArray(json.output) && json.output.length > 0) {
      return json.output[0]?.content?.[0]?.text || JSON.stringify(json.output[0]);
    }
    // Fallback to stringified response
    return JSON.stringify(json);
  }
  for (const modelId of FALLBACK_MODELS) {
    try {
      console.log(`Attempting model: ${modelId}`);
      let text;
      if (useApiKeyMode) {
        // Use REST path with API key
        text = await restGenerate(modelId, prompt);
      } else {
        const model = genAI.getGenerativeModel({ model: modelId });
        const call = await model.generateContent(prompt);
        const resp = call.response;
        text = resp.text();
      }
      console.log(`Model succeeded: ${modelId}`);
      return { text, model: modelId };
    } catch (err) {
      // capture status if available
      const status = err?.response?.status || err?.code || 'unknown';
      console.warn(`Model ${modelId} failed (status: ${status})`, {
        message: err?.message,
        status,
        response: err?.response?.data || err?.response || undefined,
      });
      lastError = err;

      // if 404 -> model not found, try next model
      if (status === 404) continue;

      // For other errors (rate limit, 5xx), we still try next fallback.
      // Optionally you could add backoff/retry for transient statuses.
      continue;
    }
  }

  // If we reach here, all models failed
  const err = new Error('All configured AI models failed');
  err.original = lastError;
  throw err;
}

/**
 * Primary generateSummary function.
 * Returns a parsed summary object (matching your schema).
 * If AI fails or parsing fails, returns a reasonable fallback summary.
 */
export async function generateSummary(text) {
  console.log('Using model priority list:', FALLBACK_MODELS);
  const prompt = `Please analyze the following document and provide a comprehensive summary in JSON format with this structure:
{
  "executiveSummary": "...",
  "keyPoints": ["..."],
  "actionItems": [{"task":"...","priority":"high|medium|low","deadline":"...","department":"...","estimatedHours":"..."}],
  "complianceItems": ["..."],
  "riskFactors": ["..."],
  "recommendations": ["..."],
  "categories": ["..."],
  "confidence": "percentage",
  "language": "English/Malayalam/Mixed",
  "documentType": "...",
  "urgencyLevel": "low|medium|high|critical"
}

Document Text:
${text}`;

  // Try AI models with fallback
  try {
    const { text: aiText, model: usedModel } = await generateWithFallbackModels(prompt);

    // Attempt to parse JSON from AI output
    const parsed = safeParseJSONFromText(aiText);
    if (parsed && typeof parsed === 'object') {
      // attach metadata about model used (non-intrusive)
      parsed._meta = parsed._meta || {};
      parsed._meta.model = usedModel;
      return parsed;
    }

    // If parsing fails, return a structured fallback using the AI text
    const shortSummary = (aiText && aiText.substring(0, 1000)) || '';
    return {
      executiveSummary: shortSummary.substring(0, 300) + '...',
      keyPoints: [],
      actionItems: [],
      complianceItems: [],
      riskFactors: [],
      recommendations: [],
      categories: ['General'],
      confidence: '85',
      language: 'English',
      documentType: 'General Document',
      urgencyLevel: 'medium',
      _meta: { model: usedModel, parseAttempted: true }
    };
  } catch (err) {
    // Log detailed error for diagnostics
    try {
      console.error('Generative AI error (detailed):', {
        message: err?.message,
        code: err?.code || err?.response?.status,
        stack: err?.stack,
        response: err?.response || err?.original || undefined,
      });
    } catch (logErr) {
      console.error('Generative AI error (fallthrough):', err && (err.message || err));
    }

    // Local fallback summarizer (simple heuristic): take first sentences as executive summary
    try {
      const normalized = text.replace(/\s+/g, ' ').trim();
      const sentences = normalized.match(/[^\.\!\?]+[\.\!\?]+/g) || [normalized];
      const executiveSummary = sentences.slice(0, 3).join(' ');
      const keyPoints = sentences.slice(0, Math.min(5, sentences.length)).map((s) => s.trim());

      return {
        executiveSummary: executiveSummary || normalized.substring(0, 300) + '...',
        keyPoints,
        actionItems: [],
        complianceItems: [],
        riskFactors: [],
        recommendations: [],
        categories: ['General'],
        confidence: '50',
        language: 'English',
        documentType: 'General Document',
        urgencyLevel: 'medium',
        _meta: { model: null, fallback: true }
      };
    } catch (fallbackErr) {
      console.error('Fallback summarizer failed:', fallbackErr);
      return {
        executiveSummary: text.substring(0, 300) + '...',
        keyPoints: [],
        actionItems: [],
        complianceItems: [],
        riskFactors: [],
        recommendations: [],
        categories: ['General'],
        confidence: '40',
        language: 'English',
        documentType: 'General Document',
        urgencyLevel: 'medium',
        _meta: { model: null, fallback: true, fallbackError: String(fallbackErr) }
      };
    }
  }
}

/**
 * Helper wrappers kept for compatibility with previous exports
 */
export async function summarizeFile(filePath, mimetype) {
  const text = await extractTextFromFile(filePath, mimetype);
  return generateSummary(text);
}

export async function summarizeText(text) {
  return generateSummary(text);
}
