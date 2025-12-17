import express from 'express';
import { authMiddleware } from '../middlewares/authMiddlewares';
import {
  createMeet,
  getMyMeets,
  joinMeet,
  getMeetDetail,
  updateMeet,
  deleteMeet,
  exitMeetOrKick,
} from '../controllers/meetsControllers';

const router = express.Router();

// POST /meets
router.post('/', authMiddleware, createMeet);

// GET /meets
router.get('/', authMiddleware, getMyMeets);

// POST /meets/join/:meetId
router.post('/join/:meetId', authMiddleware, joinMeet);

// GET /meets/:meetId
router.get('/:meetId', authMiddleware, getMeetDetail);

// PATCH /meets/:meetId
router.patch('/:meetId', authMiddleware, updateMeet);

// DELETE /meets/:meetId
router.delete('/:meetId', authMiddleware, deleteMeet);

// DELETE /meets/:meetId/exit/:userId
router.delete('/:meetId/exit/:userId', authMiddleware, exitMeetOrKick);

export default router;