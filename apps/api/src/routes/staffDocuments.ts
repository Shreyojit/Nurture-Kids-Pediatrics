import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fail, ok } from '../lib/response.js';
import { assertCan } from '../lib/rbac.js';
import {
  insertPatientDocument,
  listDocumentsForStaff,
  getPatientDocumentById,
  resolveDocumentPath,
  documentStorageKeyPrefix,
} from '../db/patientDocumentQueries.js';
import { isPatientDocumentType } from '../lib/patientDocumentTypes.js';
import { db } from '../db/database.js';
import { putObject, deleteObject, streamObjectToResponse } from '../lib/s3Storage.js';

export const staffDocumentsRouter = Router();

const docMemStorage = multer.memoryStorage();
const docUpload = multer({
  storage: docMemStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      '.pdf',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.tiff',
      '.webp',
      '.doc',
      '.docx',
      '.txt',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Allowed file types: PDF, images, Word documents, and text files'));
  },
});

/** GET /api/staff/documents?patient_id=... */
staffDocumentsRouter.get('/', (req, res) => {
  try {
    assertCan(req.user!.role, 'documents:read');
  } catch {
    fail(res, 'FORBIDDEN', 'Insufficient permissions', 403);
    return;
  }
  const patientId = typeof req.query.patient_id === 'string' ? req.query.patient_id : undefined;
  const docs = listDocumentsForStaff(req.user!.practiceId, patientId);
  ok(res, { documents: docs });
});

/** POST /api/staff/documents/patients/:patientId/upload */
staffDocumentsRouter.post(
  '/patients/:patientId/upload',
  (req, res, next) => {
    docUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        fail(res, 'VALIDATION_ERROR', err instanceof Error ? err.message : 'Upload failed', 422);
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      assertCan(req.user!.role, 'documents:upload');
    } catch {
      fail(res, 'FORBIDDEN', 'Insufficient permissions', 403);
      return;
    }

    if (!req.file) {
      fail(res, 'VALIDATION_ERROR', 'Document file is required', 422);
      return;
    }

    const { patientId } = req.params;
    // Verify patient belongs to this practice
    const patient = db
      .prepare('select id from patients where id = ? and practice_id = ?')
      .get(patientId, req.user!.practiceId);
    if (!patient) {
      fail(res, 'NOT_FOUND', 'Patient not found', 404);
      return;
    }

    const rawType = typeof req.body?.document_type === 'string' ? req.body.document_type : 'other';
    const documentType = isPatientDocumentType(rawType) ? rawType : 'other';

    const ext = path.extname(req.file.originalname) || '.pdf';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const storedKey = `${documentStorageKeyPrefix(req.user!.practiceId, patientId)}/${filename}`;
    await putObject(storedKey, req.file.buffer, req.file.mimetype);

    const doc = insertPatientDocument({
      practiceId: req.user!.practiceId,
      patientId,
      documentType,
      originalFilename: req.file.originalname,
      storedKey,
      uploadedBy: req.user!.id,
    });

    ok(res, { document: doc });
  },
);

/** GET /api/staff/documents/:id/download */
staffDocumentsRouter.get('/:id/download', async (req, res) => {
  try {
    assertCan(req.user!.role, 'documents:read');
  } catch {
    fail(res, 'FORBIDDEN', 'Insufficient permissions', 403);
    return;
  }

  const doc = getPatientDocumentById(req.params.id, req.user!.practiceId);
  if (!doc) {
    fail(res, 'NOT_FOUND', 'Document not found', 404);
    return;
  }

  await streamObjectToResponse(resolveDocumentPath(doc), res, { download: true, filename: doc.original_filename });
});

/** DELETE /api/staff/documents/:id */
staffDocumentsRouter.delete('/:id', async (req, res) => {
  try {
    assertCan(req.user!.role, 'documents:delete');
  } catch {
    fail(res, 'FORBIDDEN', 'Insufficient permissions', 403);
    return;
  }

  const doc = getPatientDocumentById(req.params.id, req.user!.practiceId);
  if (!doc) {
    fail(res, 'NOT_FOUND', 'Document not found', 404);
    return;
  }

  try {
    await deleteObject(resolveDocumentPath(doc));
  } catch {
    // file already gone
  }

  db.prepare('delete from patient_documents where id = ? and practice_id = ?').run(req.params.id, req.user!.practiceId);
  ok(res, { deleted: true });
});
