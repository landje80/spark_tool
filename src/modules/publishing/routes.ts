import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '../auth/middleware.js';
import { parseInput } from '../../shared/validation/parse.js';
import type { Actor } from '../prospects/service.js';
import { advanceSubmission, markDraftPublished, setDraftStatus, updateDraft } from './review.js';
import {
  draftEditSchema,
  draftStatusSchema,
  submissionAdvanceSchema,
  submissionListQuerySchema,
} from './schemas.js';
import {
  generateConcept,
  getSubmissionDetail,
  listSubmissions,
  type PublishingDeps,
} from './service.js';

const idParam = z.string().min(1).max(40);
const actorOf = (req: Request): Actor => ({ id: req.user!.id, ip: req.ip });
// Submissions bevatten klantmateriaal en AI-conceptteksten; alleen wie content mag beoordelen of
// klanten beheert leest mee — niet elke medewerker die alleen uploadlinks mag aanmaken.
const READ = ['customer.manage', 'content.review'] as const;

export function publishingRouter(deps: PublishingDeps): Router {
  const r = Router();
  const { db } = deps;
  const read = requireAnyPermission(READ);
  const review = requirePermission('content.review');

  r.get('/submissions', read, async (req, res) => {
    res.json(await listSubmissions(db, parseInput(submissionListQuerySchema, req.query)));
  });

  r.get('/submissions/:id', read, async (req, res) => {
    res.json(await getSubmissionDetail(db, parseInput(idParam, req.params.id)));
  });

  r.post('/submissions/:id/generate-concept', review, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    res.status(201).json(await generateConcept(deps, actorOf(req), id));
  });

  r.post('/submissions/:id/advance', review, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const { to } = parseInput(submissionAdvanceSchema, req.body);
    res.json(await advanceSubmission(db, actorOf(req), id, to));
  });

  r.patch('/drafts/:id', review, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const input = parseInput(draftEditSchema, req.body);
    res.json(
      await updateDraft(db, actorOf(req), id, {
        text: input.text,
        hashtags: input.hashtags,
        cta: input.cta ?? null,
        altText: input.altText ?? null,
      }),
    );
  });

  r.post('/drafts/:id/status', review, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const { to, feedback } = parseInput(draftStatusSchema, req.body);
    res.json(await setDraftStatus(db, actorOf(req), id, to, feedback ?? null));
  });

  r.post('/drafts/:id/mark-published', review, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    res.json(await markDraftPublished(db, actorOf(req), id));
  });

  return r;
}
