import express from 'express';
import { generateSummary as svcGenerateSummary } from '../services/aiSummary.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { extractTextFromFile } from '../services/aiSummary.js';

const router = express.Router();

// Use model from env or fallback list (delegated to aiSummary service)
const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
console.log('AI route using model:', modelName);

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'), false);
    }
  }
});

// Use the centralized AI summary service which handles API-key vs ADC modes
// (`svcGenerateSummary`) instead of duplicating client logic here.

// POST /api/ai/summarize - Summarize document content
router.post('/summarize', upload.single('document'), async (req, res) => {
  try {
    let text = '';
    
    if (req.file) {
      // Extract text from uploaded file
      text = await extractTextFromFile(req.file.path, req.file.mimetype);
      
      // Clean up uploaded file
      await fs.unlink(req.file.path);
    } else if (req.body.text) {
      // Use provided text
      text = req.body.text;
    } else {
      return res.status(400).json({
        error: 'No document file or text provided'
      });
    }
    
    if (!text.trim()) {
      return res.status(400).json({
        error: 'No readable text found in the document'
      });
    }
    
    // Generate AI summary
    const summary = await svcGenerateSummary(text, req.body.options);
    
    // Add metadata
    const result = {
      id: uuidv4(),
      summary,
      metadata: {
        originalLength: text.length,
        generatedAt: new Date().toISOString(),
        model: modelName,
        processingTime: Date.now() - req.startTime
      }
    };
    
    res.json(result);
  } catch (error) {
    console.error('Error in summarize endpoint:', error);
    res.status(500).json({
      error: error.message || 'Failed to process document'
    });
  }
});

// POST /api/ai/analyze-text - Analyze raw text
router.post('/analyze-text', async (req, res) => {
  try {
    const { text, options = {} } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({
        error: 'Text content is required'
      });
    }
    
    const summary = await svcGenerateSummary(text, options);
    
    const result = {
      id: uuidv4(),
      summary,
      metadata: {
        originalLength: text.length,
        generatedAt: new Date().toISOString(),
        model: modelName,
        processingTime: Date.now() - req.startTime
      }
    };
    
    res.json(result);
  } catch (error) {
    console.error('Error in analyze-text endpoint:', error);
    res.status(500).json({
      error: error.message || 'Failed to analyze text'
    });
  }
});

// GET /api/ai/health - Check AI service health
router.get('/health', async (req, res) => {
  try {
    // Use the shared generateSummary to validate AI connectivity.
    await svcGenerateSummary('Say "OK" if you can receive this message.');
    res.json({
      status: 'healthy',
      geminiConnected: true,
      message: 'AI services are operational',
      model: modelName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('AI health check failed:', error && (error.stack || error.message || error));
    res.status(503).json({
      status: 'unhealthy',
      geminiConnected: false,
      error: error.message || String(error),
      timestamp: new Date().toISOString()
    });
  }
});

// Middleware to track request time
router.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});

export default router;
