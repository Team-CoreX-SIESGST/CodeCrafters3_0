import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from "./userRoutes.js";

const router = express.Router();

// Health check route
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'API is healthy' });
});

// Authentication routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
// Add your resource routes here

export default router;
