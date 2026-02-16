const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const videoRoutes = require('./routes/videoRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const courseRoutes = require('./routes/courseRoutes');
const lessonRoutes = require('./routes/lessonRoutes');

const app = express();

// Security Middleware
app.use(helmet());

// CORS Middleware
app.use(cors());

// Logging Middleware
app.use(morgan('combined'));

// Body Parser Middleware
app.use(express.json());

// Local video files (when storage_provider = 'local'). R2 videos are streamed via /v1/video/:id/stream/*
app.use('/videos', express.static(path.join(__dirname, '../public/videos')));

// Routes
app.use('/v1/auth', authRoutes);
app.use('/v1/video', videoRoutes);
app.use('/v1/admin', adminRoutes);
app.use('/v1/courses', courseRoutes);
app.use('/v1/lessons', lessonRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

module.exports = app;
