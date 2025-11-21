import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { summarizeFile } from '../services/aiSummary.js';
import { summarizeText, extractTextFromFile } from '../services/aiSummary.js';

const router = express.Router();

// Configure multer for document uploads
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

// In-memory storage for documents (in production, use a database)
let documents = [
  {
    id: 'DOC001',
    title: 'Safety Protocol Review - Q4 2024',
    filename: 'safety_protocol_q4_2024.pdf',
    originalName: 'Safety Protocol Review - Q4 2024.pdf',
    source: 'Email - operations@kochimetro.org',
    uploadDate: '2024-01-15T10:00:00.000Z',
    type: 'Safety Documentation',
    language: 'English',
    priority: 'high',
    department: 'Operations',
    author: 'Rajesh Kumar',
    fileSize: 2457600, // 2.4 MB in bytes
    pages: 8,
    status: 'processed',
    summary: {
      executiveSummary: 'Quarterly safety protocol review highlighting key improvements in passenger safety measures and emergency response procedures.',
      keyPoints: [
        'Implementation of new emergency evacuation protocols across all stations',
        'Updated safety training requirements for all operational staff',
        'Installation of additional safety equipment in tunnel sections',
        'Compliance with latest Metro Railway Safety Standards (MRSS) 2024'
      ],
      actionItems: [
        {
          task: 'Complete staff training on new protocols',
          priority: 'high',
          deadline: '2024-01-28',
          department: 'HR Department'
        },
        {
          task: 'Install additional safety equipment',
          priority: 'medium',
          deadline: '2024-02-15',
          department: 'Maintenance Team'
        }
      ],
      complianceItems: [
        'MRSS 2024 - Fully Compliant',
        'Fire Safety Regulations - Review Required',
        'Emergency Response Standards - Updated'
      ],
      confidence: '94',
      documentType: 'Safety Report'
    },
    tags: ['safety', 'protocol', 'quarterly-review', 'operations'],
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z'
  }
];

// Sanitize any existing in-memory documents that contain raw AI error messages
// This prevents previously stored error text from being shown in the UI.
(function sanitizeExistingSummaries() {
  const errorIndicator = 'GoogleGenerativeAI Error';
  const genericMessage = 'Document processed. AI summary temporarily unavailable. Check server logs for details.';
  documents = documents.map(d => {
    try {
      if (d && d.summary && typeof d.summary.executiveSummary === 'string') {
        const exec = d.summary.executiveSummary;
        if (exec.includes(errorIndicator) || exec.includes('AI summary temporarily unavailable:')) {
          d.summary.executiveSummary = genericMessage;
        }
      }
    } catch (e) {
      // ignore
    }
    return d;
  });
})();

// GET /api/documents - Get all documents with filtering
router.get('/', (req, res) => {
  try {
    const {
      search,
      type,
      priority,
      department,
      status,
      language,
      sortBy = 'uploadDate',
      order = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    let filteredDocs = [...documents];

    // Apply filters
    if (search) {
      const searchLower = search.toLowerCase();
      filteredDocs = filteredDocs.filter(doc => 
        doc.title.toLowerCase().includes(searchLower) ||
        doc.type.toLowerCase().includes(searchLower) ||
        doc.tags.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }

    if (type) {
      filteredDocs = filteredDocs.filter(doc => doc.type === type);
    }

    if (priority) {
      filteredDocs = filteredDocs.filter(doc => doc.priority === priority);
    }

    if (department) {
      filteredDocs = filteredDocs.filter(doc => doc.department === department);
    }

    if (status) {
      filteredDocs = filteredDocs.filter(doc => doc.status === status);
    }

    if (language) {
      filteredDocs = filteredDocs.filter(doc => doc.language === language);
    }

    // Apply sorting
    filteredDocs.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      if (sortBy === 'priority') {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        aValue = priorityOrder[a.priority];
        bValue = priorityOrder[b.priority];
      }

      if (order === 'desc') {
        return aValue > bValue ? -1 : 1;
      }
      return aValue < bValue ? -1 : 1;
    });

    // Apply pagination
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedDocs = filteredDocs.slice(startIndex, endIndex);

    res.json({
      documents: paginatedDocs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredDocs.length,
        totalPages: Math.ceil(filteredDocs.length / parseInt(limit))
      },
      filters: { search, type, priority, department, status, language }
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      error: 'Failed to fetch documents'
    });
  }
});

// GET /api/documents/:id - Get specific document
router.get('/:id', (req, res) => {
  try {
    const document = documents.find(d => d.id === req.params.id);
    
    if (!document) {
      return res.status(404).json({
        error: 'Document not found'
      });
    }

    res.json(document);
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({
      error: 'Failed to fetch document'
    });
  }
});

// POST /api/documents/upload - Upload and process new document
router.post('/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const {
      title,
      type,
      department,
      priority = 'medium',
      author,
      tags = ''
    } = req.body;

    // Generate AI summary from file
    let summary = null;
    try {
      summary = await summarizeFile(req.file.path, req.file.mimetype);
    } catch (err) {
      // Log full error details on the server for debugging
      console.error('AI summarization failed (details):', err && (err.stack || err));

      // Provide a safe, generic message to the UI so internal errors aren't exposed.
      const isApiKeyInvalid = err && err.message && err.message.includes('API_KEY_INVALID');
      summary = {
        executiveSummary: isApiKeyInvalid
          ? 'Document uploaded successfully. To enable AI summarization, please update your Gemini API key in the backend .env file.'
          : 'Document processed. AI summary temporarily unavailable. Check server logs for details.',
        keyPoints: ['Document uploaded successfully'],
        actionItems: [],
        complianceItems: [],
        riskFactors: [],
        recommendations: ['Update Gemini API key to enable AI features'],
        categories: ['Manual Upload'],
        confidence: '0',
        language: 'English',
        documentType: type || 'General Document',
        urgencyLevel: 'medium'
      };
    } finally {
      // optional: keep file for later; if not needed, uncomment cleanup
      // await fs.unlink(req.file.path).catch(() => {});
    }

    // Create document record
    const newDocument = {
      id: uuidv4(),
      title: title || req.file.originalname,
      filename: req.file.filename,
      originalName: req.file.originalname,
      source: 'Manual Upload',
      uploadDate: new Date().toISOString(),
      type: type || 'General Document',
      language: 'English',
      priority,
      department: department || 'General',
      author: author || 'Unknown',
      fileSize: req.file.size,
      pages: 0,
  status: 'processed',
      summary,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      filePath: req.file.path
    };

    documents.push(newDocument);

    res.status(201).json({
      message: 'Document uploaded and summarized successfully',
      document: newDocument
    });
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// POST /api/documents/:id/process - Process document with AI
router.post('/:id/process', async (req, res) => {
  try {
    const docIndex = documents.findIndex(d => d.id === req.params.id);
    
    if (docIndex === -1) {
      return res.status(404).json({
        error: 'Document not found'
      });
    }

    const document = documents[docIndex];

    if (document.status === 'processing') {
      return res.status(409).json({
        error: 'Document is already being processed'
      });
    }

    // Update status to processing
    documents[docIndex].status = 'processing';
    documents[docIndex].updatedAt = new Date().toISOString();

    // Send immediate response
    res.json({
      message: 'Document processing started',
      documentId: document.id,
      status: 'processing'
    });

    // Process document asynchronously (in real implementation)
    // This would call the AI service to analyze the document
  setTimeout(() => {
      // Simulate AI processing completion
      documents[docIndex].status = 'processed';
      documents[docIndex].updatedAt = new Date().toISOString();
      
      // In real implementation, this would be the actual AI summary
      documents[docIndex].summary = {
        executiveSummary: 'AI-generated summary for the document',
        keyPoints: ['Key point 1', 'Key point 2'],
        actionItems: [],
        complianceItems: [],
        confidence: '85',
        documentType: document.type
      };
  }, 2000);

  return; // ensure function scope ends after scheduling

  } catch (error) {
    console.error('Error processing document:', error);
    res.status(500).json({
      error: 'Failed to process document'
    });
  }
});

// PUT /api/documents/:id - Update document metadata
router.put('/:id', (req, res) => {
  try {
    const docIndex = documents.findIndex(d => d.id === req.params.id);
    
    if (docIndex === -1) {
      return res.status(404).json({
        error: 'Document not found'
      });
    }

    const updatedDocument = {
      ...documents[docIndex],
      ...req.body,
      id: req.params.id, // Ensure ID doesn't change
      updatedAt: new Date().toISOString()
    };

    documents[docIndex] = updatedDocument;

    res.json(updatedDocument);
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({
      error: 'Failed to update document'
    });
  }
});

// DELETE /api/documents/:id - Delete document
router.delete('/:id', (req, res) => {
  try {
    const docIndex = documents.findIndex(d => d.id === req.params.id);
    
    if (docIndex === -1) {
      return res.status(404).json({
        error: 'Document not found'
      });
    }

    const deletedDocument = documents.splice(docIndex, 1)[0];

    res.json({
      message: 'Document deleted successfully',
      document: deletedDocument
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      error: 'Failed to delete document'
    });
  }
});

// GET /api/documents/stats/summary - Get document statistics
router.get('/stats/summary', (req, res) => {
  try {
    const stats = {
      total: documents.length,
      byStatus: {
        uploaded: documents.filter(d => d.status === 'uploaded').length,
        processing: documents.filter(d => d.status === 'processing').length,
        processed: documents.filter(d => d.status === 'processed').length,
        error: documents.filter(d => d.status === 'error').length
      },
      byType: {},
      byDepartment: {},
      byPriority: {
        critical: documents.filter(d => d.priority === 'critical').length,
        high: documents.filter(d => d.priority === 'high').length,
        medium: documents.filter(d => d.priority === 'medium').length,
        low: documents.filter(d => d.priority === 'low').length
      }
    };

    // Calculate type and department statistics
    documents.forEach(doc => {
      // Type statistics
      if (!stats.byType[doc.type]) {
        stats.byType[doc.type] = 0;
      }
      stats.byType[doc.type]++;

      // Department statistics
      if (!stats.byDepartment[doc.department]) {
        stats.byDepartment[doc.department] = 0;
      }
      stats.byDepartment[doc.department]++;
    });

    res.json(stats);
  } catch (error) {
    console.error('Error fetching document statistics:', error);
    res.status(500).json({
      error: 'Failed to fetch document statistics'
    });
  }
});

// Helper: guess mimetype from filename
function guessMimeType(filename) {
  const ext = (filename && filename.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'doc': return 'application/msword';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls': return 'application/vnd.ms-excel';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'txt': return 'text/plain';
    default: return null;
  }
}

// POST /api/documents/reprocess/:id - Re-run AI summarization for a single document
router.post('/reprocess/:id', async (req, res) => {
  try {
    const docIndex = documents.findIndex(d => d.id === req.params.id);
    if (docIndex === -1) return res.status(404).json({ error: 'Document not found' });

    const doc = documents[docIndex];
    if (!doc.filePath) return res.status(400).json({ error: 'No filePath available to reprocess' });

    const mimetype = guessMimeType(doc.originalName || doc.filename) || 'text/plain';
    try {
      const summary = await summarizeFile(doc.filePath, mimetype);
      documents[docIndex].summary = summary;
      documents[docIndex].updatedAt = new Date().toISOString();
      return res.json({ message: 'Reprocessed', document: documents[docIndex] });
    } catch (e) {
      console.error('Reprocess failed for', doc.id, e);
      return res.status(500).json({ error: 'Reprocess failed', details: String(e) });
    }
  } catch (error) {
    console.error('Error in reprocess/:id', error);
    res.status(500).json({ error: 'Failed to reprocess document' });
  }
});

// POST /api/documents/reprocess-all - Re-run AI summarization for all documents
router.post('/reprocess-all', async (req, res) => {
  try {
    const results = [];
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      if (!doc.filePath) {
        results.push({ id: doc.id, status: 'skipped', reason: 'no filePath' });
        continue;
      }
      const mimetype = guessMimeType(doc.originalName || doc.filename) || 'text/plain';
      try {
        const summary = await summarizeFile(doc.filePath, mimetype);
        documents[i].summary = summary;
        documents[i].updatedAt = new Date().toISOString();
        results.push({ id: doc.id, status: 'ok' });
      } catch (e) {
        console.error('Reprocess failed for', doc.id, e);
        results.push({ id: doc.id, status: 'error', error: String(e) });
      }
    }
    res.json({ message: 'Reprocess completed', results });
  } catch (error) {
    console.error('Error in reprocess-all', error);
    res.status(500).json({ error: 'Failed to reprocess all documents' });
  }
});

export default router;
