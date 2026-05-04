const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const videoRoutes = require('./routes/videoRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
const adminTeachersRoutes = require('./routes/adminTeachersRoutes');
const adminStudentsRoutes = require('./routes/adminStudentsRoutes');
const adminCoursesRoutes = require('./routes/adminCoursesRoutes');
const adminExternalCourseImportRoutes = require('./routes/adminExternalCourseImportRoutes');
const adminCategoryRoutes = require('./routes/adminCategoryRoutes');
const adminSettingsRoutes = require('./routes/adminSettingsRoutes');
const adminPaymentRequestsRoutes = require('./routes/adminPaymentRequestsRoutes');
const adminLiveRequestsRoutes = require('./routes/adminLiveRequestsRoutes');
const adminLiveSessionsRoutes = require('./routes/adminLiveSessionsRoutes');
const adminTeacherWithdrawRoutes = require('./routes/adminTeacherWithdrawRoutes');
const courseRoutes = require('./routes/courseRoutes');
const lessonRoutes = require('./routes/lessonRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const teacherProfileRoutes = require('./routes/teacherProfileRoutes');
const studentProfileRoutes = require('./routes/studentProfileRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const teacherReviewRoutes = require('./routes/teacherReviewRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const bundleRoutes = require('./routes/bundleRoutes');
const progressRoutes = require('./routes/progressRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const couponRoutes = require('./routes/couponRoutes');
const meRoutes = require('./routes/meRoutes');
const teacherDiscoveryRoutes = require('./routes/teacherDiscoveryRoutes');
const fcmRoutes = require('./routes/fcmRoutes');
const recordingDraftRoutes = require('./routes/recordingDraftRoutes');

const app = express();

// Security Middleware - Configure Helmet to allow cross-origin images
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
}));

// CORS Middleware - Strict allowlist (see config/cors.js); only these origins for all API methods
const { CORS_ALLOWED_ORIGINS } = require('./config/cors');
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true); // same-origin or server requests
        if (CORS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        return cb(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Logging Middleware
app.use(morgan('combined'));

// Body Parser Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Local video files (when storage_provider = 'local'). R2 videos are streamed via /v1/video/:id/stream/*
app.use('/videos', express.static(path.join(__dirname, '../public/videos')));

// Static file serving for uploads (course thumbnails, intro videos, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Static profile images (default avatars for students/teachers)
app.use('/images', express.static(path.join(__dirname, '../public/images')));

// Routes
app.use('/v1/settings', settingsRoutes);
app.use('/v1/auth', authRoutes);
app.use('/v1/video', videoRoutes);
app.use('/v1/admin/auth', adminAuthRoutes);   // Public - must be before /v1/admin
app.use('/v1/admin/dashboard', adminDashboardRoutes);
app.use('/v1/admin/users', adminUserRoutes);
app.use('/v1/admin/teachers', adminTeachersRoutes);
app.use('/v1/admin/students', adminStudentsRoutes);
app.use('/v1/admin/courses', adminCoursesRoutes);
app.use('/v1/admin/external-course-imports', adminExternalCourseImportRoutes);
app.use('/v1/admin/categories', adminCategoryRoutes);
app.use('/v1/admin/settings', adminSettingsRoutes);
app.use('/v1/admin/payment-requests', adminPaymentRequestsRoutes);
app.use('/v1/admin/live-requests', adminLiveRequestsRoutes);
app.use('/v1/admin/live-sessions', adminLiveSessionsRoutes);
app.use('/v1/admin/teacher-withdraw-requests', adminTeacherWithdrawRoutes);
app.use('/v1/admin', adminRoutes);
app.use('/v1/courses', courseRoutes);
app.use('/v1/lessons', lessonRoutes);
app.use('/v1/assignments', assignmentRoutes);
app.use('/v1/teacher/profile', teacherProfileRoutes);
app.use('/v1/student/profile', studentProfileRoutes);
app.use('/v1/reviews', reviewRoutes);
app.use('/v1/teacher-reviews', teacherReviewRoutes);
app.use('/v1/announcements', announcementRoutes);
app.use('/v1/notifications', notificationRoutes);
app.use('/v1/bundles', bundleRoutes);
app.use('/v1/progress', progressRoutes);
app.use('/v1/coupons', couponRoutes);
app.use('/v1/me', meRoutes);
app.use('/v1/teachers', teacherDiscoveryRoutes);
app.use('/v1/fcm', fcmRoutes);
app.use('/v1/recordings', recordingDraftRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Error Handling Middleware (multer, unhandled errors)
app.use((err, req, res, next) => {
    console.error(err.stack || err);
    if (err.code === 'LIMIT_FILE_SIZE') {
        const maxBytes = typeof err?.limit === 'number' ? err.limit : null;
        const maxMb = maxBytes ? Math.round(maxBytes / (1024 * 1024)) : null;
        const message = maxMb
            ? `File too large. Maximum size is ${maxMb} MB per upload.`
            : 'File too large.';
        return res.status(413).json({ error: message });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected file field. Use "video" for the video file.' });
    }
    const message = err.message || 'Something went wrong. Please try again.';
    res.status(err.status || 500).json({ error: message });
});

module.exports = app;
