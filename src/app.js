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
const assignmentRoutes = require('./routes/assignmentRoutes');
const teacherProfileRoutes = require('./routes/teacherProfileRoutes');
const studentProfileRoutes = require('./routes/studentProfileRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const bundleRoutes = require('./routes/bundleRoutes');

const app = express();

// Security Middleware - Configure Helmet to allow cross-origin images
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
}));

// CORS Middleware - Allow all origins for media files
app.use(cors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Logging Middleware
app.use(morgan('combined'));

// Body Parser Middleware
app.use(express.json());

// Local video files (when storage_provider = 'local'). R2 videos are streamed via /v1/video/:id/stream/*
app.use('/videos', express.static(path.join(__dirname, '../public/videos')));

// Static file serving for uploads (course thumbnails, intro videos, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/v1/auth', authRoutes);
app.use('/v1/video', videoRoutes);
app.use('/v1/admin', adminRoutes);
app.use('/v1/courses', courseRoutes);
app.use('/v1/lessons', lessonRoutes);
app.use('/v1/assignments', assignmentRoutes);
app.use('/v1/teacher/profile', teacherProfileRoutes);
app.use('/v1/student/profile', studentProfileRoutes);
app.use('/v1/reviews', reviewRoutes);
app.use('/v1/announcements', announcementRoutes);
app.use('/v1/notifications', notificationRoutes);
app.use('/v1/bundles', bundleRoutes);

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
