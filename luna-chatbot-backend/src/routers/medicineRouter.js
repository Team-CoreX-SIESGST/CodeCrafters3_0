import express from 'express';
import { getMedicineInfo } from '../controllers/medicineInfoController.js';

const router = express.Router();

// GET /api/medicine/info?name=X&generic=Y
router.get('/info', getMedicineInfo);

export default router;
