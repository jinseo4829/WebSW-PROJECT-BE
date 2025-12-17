import express from 'express';
import { authMiddleware } from '../middlewares/authMiddlewares.js';
import {
    getWeeklyCalendar,
    saveWeeklyCalendar,
} from '../controllers/calendarControllers.js';

const router = express.Router();

// GET /calendar/week
router.get('/week', authMiddleware, getWeeklyCalendar);

// POST /calendar/week
router.post('/week', authMiddleware, saveWeeklyCalendar);

export default router;
