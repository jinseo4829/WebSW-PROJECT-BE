import express from 'express';
import { authMiddleware } from '../middlewares/authMiddlewares.js';
import { getMyInfo } from '../controllers/userControllers.js';

const router = express.Router();

// GET /me
router.get('/', authMiddleware, getMyInfo);

export default router;
