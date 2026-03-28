import express from "express";
import { getCognitiveDashboard } from "../controllers/cognitiveController.js";

const router = express.Router();

router.get("/dashboard", getCognitiveDashboard);

export default router;
