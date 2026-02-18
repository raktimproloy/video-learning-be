const courseService = require('../services/courseService');
const r2Storage = require('../services/r2StorageService');
const path = require('path');
const fs = require('fs');

function enrichCourseMediaUrls(courses, req) {
    const apiUrl = process.env.BASE_URL || 'http://localhost:5000';
    const v1Url = `${apiUrl}/v1`;
    
    return (Array.isArray(courses) ? courses : [courses]).map((c) => {
        const course = { ...c };
        
        // Handle thumbnail URL
        if (course.thumbnail_path) {
            // Try public URL first (if R2_PUBLIC_URL is configured)
            const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(course.thumbnail_path) : null;
            if (publicUrl) {
                course.thumbnail_url = publicUrl;
            } else if (course.thumbnail_path.startsWith('teachers/')) {
                // R2 key - use media endpoint
                course.thumbnail_url = `${v1Url}/courses/media/${encodeURIComponent(course.thumbnail_path)}`;
            } else if (course.thumbnail_path.startsWith('/uploads/')) {
                // Local storage
                course.thumbnail_url = `${apiUrl}${course.thumbnail_path}`;
            } else {
                // Fallback - assume it's a relative path
                course.thumbnail_url = `${apiUrl}${course.thumbnail_path.startsWith('/') ? '' : '/'}${course.thumbnail_path}`;
            }
        }
        
        // Handle intro video URL
        if (course.intro_video_path) {
            const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(course.intro_video_path) : null;
            if (publicUrl) {
                course.intro_video_url = publicUrl;
            } else if (course.intro_video_path.startsWith('teachers/')) {
                course.intro_video_url = `${v1Url}/courses/media/${encodeURIComponent(course.intro_video_path)}`;
            } else if (course.intro_video_path.startsWith('/uploads/')) {
                course.intro_video_url = `${apiUrl}${course.intro_video_path}`;
            } else {
                course.intro_video_url = `${apiUrl}${course.intro_video_path.startsWith('/') ? '' : '/'}${course.intro_video_path}`;
            }
        }
        
        return course;
    });
}

class CourseController {
    async createCourse(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            // Parse form data
            const {
                title,
                shortDescription,
                fullDescription,
                category,
                subcategory,
                tags,
                language,
                subtitle,
                level,
                courseType,
                price,
                discountPrice,
                currency,
                hasLiveClass,
                hasAssignments
            } = req.body;

            // Validate required fields
            if (!title || !shortDescription || !fullDescription || !category || !level || !courseType || !price || !currency) {
                return res.status(400).json({ 
                    error: 'Missing required fields',
                    required: ['title', 'shortDescription', 'fullDescription', 'category', 'level', 'courseType', 'price', 'currency']
                });
            }

            // Parse tags (should be JSON string from FormData)
            let parsedTags = [];
            try {
                parsedTags = tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [];
            } catch (e) {
                parsedTags = [];
            }

            // Handle file uploads - upload to R2 if configured, otherwise use local storage
            let thumbnailPath = null;
            let introVideoPath = null;

            if (req.files) {
                if (req.files.thumbnail && req.files.thumbnail.length > 0) {
                    const file = req.files.thumbnail[0];
                    if (r2Storage.isConfigured) {
                        // Upload to R2
                        const fileBuffer = fs.readFileSync(file.path);
                        const r2Key = await r2Storage.uploadCourseMedia(
                            req.user.id,
                            null, // courseId will be set after creation
                            fileBuffer,
                            file.originalname,
                            'thumbnail'
                        );
                        thumbnailPath = r2Key;
                        // Delete local temp file
                        fs.unlinkSync(file.path);
                    } else {
                        // Use local storage
                        thumbnailPath = `/uploads/courses/${file.filename}`;
                    }
                }
                if (req.files.introVideo && req.files.introVideo.length > 0) {
                    const file = req.files.introVideo[0];
                    if (r2Storage.isConfigured) {
                        // Upload to R2
                        const fileBuffer = fs.readFileSync(file.path);
                        const r2Key = await r2Storage.uploadCourseMedia(
                            req.user.id,
                            null, // courseId will be set after creation
                            fileBuffer,
                            file.originalname,
                            'introVideo'
                        );
                        introVideoPath = r2Key;
                        // Delete local temp file
                        fs.unlinkSync(file.path);
                    } else {
                        // Use local storage
                        introVideoPath = `/uploads/courses/${file.filename}`;
                    }
                }
            } else if (req.file) {
                // Single file upload (fallback)
                if (req.file.fieldname === 'thumbnail') {
                    if (r2Storage.isConfigured) {
                        const fileBuffer = fs.readFileSync(req.file.path);
                        const r2Key = await r2Storage.uploadCourseMedia(
                            req.user.id,
                            null,
                            fileBuffer,
                            req.file.originalname,
                            'thumbnail'
                        );
                        thumbnailPath = r2Key;
                        fs.unlinkSync(req.file.path);
                    } else {
                        thumbnailPath = `/uploads/courses/${req.file.filename}`;
                    }
                } else if (req.file.fieldname === 'introVideo') {
                    if (r2Storage.isConfigured) {
                        const fileBuffer = fs.readFileSync(req.file.path);
                        const r2Key = await r2Storage.uploadCourseMedia(
                            req.user.id,
                            null,
                            fileBuffer,
                            req.file.originalname,
                            'introVideo'
                        );
                        introVideoPath = r2Key;
                        fs.unlinkSync(req.file.path);
                    } else {
                        introVideoPath = `/uploads/courses/${req.file.filename}`;
                    }
                }
            }

            const courseData = {
                title: title.trim(),
                shortDescription: shortDescription.trim(),
                fullDescription: fullDescription.trim(),
                category: category.trim(),
                subcategory: subcategory ? subcategory.trim() : null,
                tags: parsedTags,
                language: language || 'English',
                subtitle: subtitle ? subtitle.trim() : null,
                level: level.trim(),
                courseType: courseType,
                thumbnailPath,
                introVideoPath,
                price: parseFloat(price),
                discountPrice: discountPrice ? parseFloat(discountPrice) : null,
                currency: currency,
                hasLiveClass: hasLiveClass === 'true' || hasLiveClass === true,
                hasAssignments: hasAssignments === 'true' || hasAssignments === true
            };

            const course = await courseService.createCourse(req.user.id, courseData);
            
            // If R2 was used with temp courseId, update paths with actual courseId
            if (r2Storage.isConfigured && course.id && (thumbnailPath || introVideoPath)) {
                const updates = {};
                
                if (thumbnailPath && thumbnailPath.includes('/temp/')) {
                    // Extract filename from temp path
                    const filename = thumbnailPath.split('/').pop();
                    const newKey = r2Storage.getCourseMediaKeyPrefix(req.user.id, course.id, 'thumbnail') + '/' + filename;
                    
                    try {
                        // Get the object from temp location
                        const stream = await r2Storage.getObjectStream(thumbnailPath);
                        const chunks = [];
                        for await (const chunk of stream) {
                            chunks.push(chunk);
                        }
                        const buffer = Buffer.concat(chunks);
                        
                        // Determine content type from filename
                        const ext = filename.split('.').pop().toLowerCase();
                        let contentType = 'image/jpeg';
                        if (ext === 'png') contentType = 'image/png';
                        else if (ext === 'gif') contentType = 'image/gif';
                        else if (ext === 'webp') contentType = 'image/webp';
                        
                        // Upload to new location
                        await r2Storage.uploadFile(newKey, buffer, contentType);
                        
                        // Delete old temp file
                        await r2Storage.deleteObject(thumbnailPath);
                        updates.thumbnailPath = newKey;
                    } catch (err) {
                        console.error('Error moving thumbnail to course folder:', err);
                    }
                }
                
                if (introVideoPath && introVideoPath.includes('/temp/')) {
                    // Extract filename from temp path
                    const filename = introVideoPath.split('/').pop();
                    const newKey = r2Storage.getCourseMediaKeyPrefix(req.user.id, course.id, 'introVideo') + '/' + filename;
                    
                    try {
                        // Get the object from temp location
                        const stream = await r2Storage.getObjectStream(introVideoPath);
                        const chunks = [];
                        for await (const chunk of stream) {
                            chunks.push(chunk);
                        }
                        const buffer = Buffer.concat(chunks);
                        
                        // Determine content type from filename
                        const ext = filename.split('.').pop().toLowerCase();
                        let contentType = 'video/mp4';
                        if (ext === 'mov') contentType = 'video/quicktime';
                        else if (ext === 'avi') contentType = 'video/x-msvideo';
                        else if (ext === 'webm') contentType = 'video/webm';
                        
                        // Upload to new location
                        await r2Storage.uploadFile(newKey, buffer, contentType);
                        
                        // Delete old temp file
                        await r2Storage.deleteObject(introVideoPath);
                        updates.introVideoPath = newKey;
                    } catch (err) {
                        console.error('Error moving intro video to course folder:', err);
                    }
                }
                
                // Update course with correct paths if moved
                if (Object.keys(updates).length > 0) {
                    await courseService.updateCourse(course.id, updates);
                    // Fetch updated course
                    const updatedCourse = await courseService.getCourseById(course.id);
                    return res.status(201).json(updatedCourse);
                }
            }
            
            res.status(201).json(course);
        } catch (error) {
            console.error('Create course error:', error);
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }

    async getMyCourses(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const courses = await courseService.getCoursesByTeacher(req.user.id);
            const enriched = enrichCourseMediaUrls(courses, req);
            res.json(enriched);
        } catch (error) {
            console.error('Get my courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getMyStudents(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
            const offset = (page - 1) * limit;

            const { students, total } = await courseService.getStudentsEnrolledInTeacherCourses(
                req.user.id,
                limit,
                offset
            );

            const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
            const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
            const v1Url = baseUrl + (baseUrl.endsWith('/') ? 'v1' : '/v1');

            const r2Storage = require('../services/r2StorageService');
            const enriched = students.map((s) => {
                let profile_image_url = null;
                if (s.profile_image_path) {
                    if (r2Storage.getPublicUrl) {
                        profile_image_url = r2Storage.getPublicUrl(s.profile_image_path);
                    }
                    if (!profile_image_url && s.profile_image_path.startsWith('students/')) {
                        profile_image_url = `${v1Url}/student/profile/image/${encodeURIComponent(s.profile_image_path)}`;
                    }
                }
                return {
                    user_id: s.user_id,
                    email: s.email,
                    name: s.name,
                    profile_image_path: s.profile_image_path,
                    profile_image_url: profile_image_url,
                    first_enrolled_at: s.first_enrolled_at,
                    courses: s.courses,
                };
            });

            res.json({
                students: enriched,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1,
            });
        } catch (error) {
            console.error('Get my students error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getTeacherRevenue(req, res) {
        try {
            const teacherId = req.user.id;
            const revenue = await courseService.getTeacherRevenue(teacherId);
            const platformFeePercent = 20;
            const platformFee = (revenue.totalRevenue * platformFeePercent) / 100;
            const withdrawable = revenue.totalRevenue - platformFee;
            res.json({
                total_revenue: revenue.totalRevenue,
                currency: revenue.currency,
                purchase_count: revenue.purchaseCount,
                platform_fee_percent: platformFeePercent,
                platform_fee: platformFee,
                withdrawable,
            });
        } catch (error) {
            console.error('Get teacher revenue error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getTeacherPurchaseHistory(req, res) {
        try {
            const teacherId = req.user.id;
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
            const offset = (page - 1) * limit;
            const { purchases, total } = await courseService.getTeacherPurchaseHistory(teacherId, limit, offset);
            const totalPages = Math.ceil(total / limit) || 1;
            res.json({
                purchases,
                total,
                page,
                limit,
                totalPages,
            });
        } catch (error) {
            console.error('Get teacher purchase history error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async requestWithdraw(req, res) {
        try {
            const teacherId = req.user.id;
            const { amount } = req.body || {};
            const revenue = await courseService.getTeacherRevenue(teacherId);
            const platformFeePercent = 20;
            const withdrawable = revenue.totalRevenue - (revenue.totalRevenue * platformFeePercent) / 100;
            const requestedAmount = parseFloat(amount);
            if (!requestedAmount || requestedAmount <= 0) {
                return res.status(400).json({ error: 'Invalid amount' });
            }
            if (requestedAmount > withdrawable) {
                return res.status(400).json({ error: 'Amount exceeds withdrawable balance' });
            }
            // In production: create withdraw_requests record and notify admin
            res.json({
                message: 'Withdrawal request submitted. You will be notified when processed.',
                requested_amount: requestedAmount,
                currency: revenue.currency,
            });
        } catch (error) {
            console.error('Request withdraw error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getAllCourses(req, res) {
        try {
            // Pass userId if authenticated to check purchase/ownership status
            const userId = req.user?.id || null;
            const courses = await courseService.getAllCourses(userId);
            // Enrich with media URLs
            const enriched = enrichCourseMediaUrls(courses, req);
            res.json(enriched);
        } catch (error) {
            console.error('Get all courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async searchCourses(req, res) {
        try {
            const userId = req.user?.id || null;
            const q = req.query.q || req.query.search || '';
            const category = req.query.category || '';
            const page = req.query.page || 1;
            const limit = req.query.limit || 12;
            const result = await courseService.searchCourses(userId, { q, category, page, limit });
            const enriched = enrichCourseMediaUrls(result.courses, req);
            res.json({
                courses: enriched,
                total: result.total,
                page: result.page,
                limit: result.limit,
                hasMore: result.hasMore,
            });
        } catch (error) {
            console.error('Search courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getCourseDetails(req, res) {
        try {
            // Pass userId if authenticated to check purchase/ownership status
            const userId = req.user?.id || null;
            const details = await courseService.getCourseDetails(req.params.id, userId);
            if (!details) {
                return res.status(404).json({ error: 'Course not found' });
            }
            
            // Enrich course with media URLs
            const enrichedCourse = enrichCourseMediaUrls([details.course], req)[0];
            
            // Enrich other courses with media URLs
            const enrichedOtherCourses = enrichCourseMediaUrls(details.otherCourses || [], req);
            
            res.json({
                course: enrichedCourse,
                teacher: details.teacher,
                lessons: details.lessons || [],
                videos: details.videos || [],
                otherCourses: enrichedOtherCourses,
                reviews: details.reviews || []
            });
        } catch (error) {
            console.error('Get course details error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getCourseById(req, res) {
        try {
            // Pass userId if authenticated to check purchase/ownership status
            const userId = req.user?.id || null;
            const course = await courseService.getCourseById(req.params.id, userId);
            if (!course) {
                return res.status(404).json({ error: 'Course not found' });
            }
            // Enrich with media URLs
            const enriched = enrichCourseMediaUrls([course], req);
            res.json(enriched[0]);
        } catch (error) {
            console.error('Get course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async updateCourse(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            // Check if teacher owns the course
            const existingCourse = await courseService.getCourseById(req.params.id);
            if (!existingCourse) {
                return res.status(404).json({ error: 'Course not found' });
            }
            if (existingCourse.teacher_id !== req.user.id) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            // Parse form data
            const {
                title,
                shortDescription,
                fullDescription,
                category,
                subcategory,
                tags,
                language,
                subtitle,
                level,
                courseType,
                price,
                discountPrice,
                currency,
                hasLiveClass,
                hasAssignments
            } = req.body;

            // Build update data object (only include fields that are provided)
            const courseData = {};

            if (title !== undefined) courseData.title = title.trim();
            if (shortDescription !== undefined) courseData.shortDescription = shortDescription.trim();
            if (fullDescription !== undefined) courseData.fullDescription = fullDescription.trim();
            if (category !== undefined) courseData.category = category.trim();
            if (subcategory !== undefined) courseData.subcategory = subcategory ? subcategory.trim() : null;
            if (tags !== undefined) {
                try {
                    courseData.tags = typeof tags === 'string' ? JSON.parse(tags) : tags;
                } catch (e) {
                    courseData.tags = [];
                }
            }
            if (language !== undefined) courseData.language = language;
            if (subtitle !== undefined) courseData.subtitle = subtitle ? subtitle.trim() : null;
            if (level !== undefined) courseData.level = level.trim();
            if (courseType !== undefined) courseData.courseType = courseType;
            if (price !== undefined) courseData.price = price ? parseFloat(price) : null;
            if (discountPrice !== undefined) courseData.discountPrice = discountPrice ? parseFloat(discountPrice) : null;
            if (currency !== undefined) courseData.currency = currency;
            if (hasLiveClass !== undefined) courseData.hasLiveClass = hasLiveClass === 'true' || hasLiveClass === true;
            if (hasAssignments !== undefined) courseData.hasAssignments = hasAssignments === 'true' || hasAssignments === true;

            // Handle file uploads - upload to R2 if configured, otherwise use local storage
            if (req.files) {
                if (req.files.thumbnail && req.files.thumbnail.length > 0) {
                    const file = req.files.thumbnail[0];
                    // Delete old thumbnail if exists
                    if (existingCourse.thumbnail_path) {
                        if (r2Storage.isConfigured && existingCourse.thumbnail_path.startsWith('teachers/')) {
                            // Delete from R2
                            try {
                                await r2Storage.deleteObject(existingCourse.thumbnail_path);
                            } catch (err) {
                                console.error('Error deleting old thumbnail from R2:', err);
                            }
                        } else {
                            // Delete from local storage
                            const oldPath = path.join(__dirname, '../../uploads', existingCourse.thumbnail_path.replace('/uploads/', ''));
                            if (fs.existsSync(oldPath)) {
                                try {
                                    fs.unlinkSync(oldPath);
                                } catch (err) {
                                    console.error('Error deleting old thumbnail:', err);
                                }
                            }
                        }
                    }
                    
                    if (r2Storage.isConfigured) {
                        // Upload to R2
                        const fileBuffer = fs.readFileSync(file.path);
                        const r2Key = await r2Storage.uploadCourseMedia(
                            req.user.id,
                            req.params.id,
                            fileBuffer,
                            file.originalname,
                            'thumbnail'
                        );
                        courseData.thumbnailPath = r2Key;
                        // Delete local temp file
                        fs.unlinkSync(file.path);
                    } else {
                        // Use local storage
                        courseData.thumbnailPath = `/uploads/courses/${file.filename}`;
                    }
                }
                if (req.files.introVideo && req.files.introVideo.length > 0) {
                    const file = req.files.introVideo[0];
                    // Delete old video if exists
                    if (existingCourse.intro_video_path) {
                        if (r2Storage.isConfigured && existingCourse.intro_video_path.startsWith('teachers/')) {
                            // Delete from R2
                            try {
                                await r2Storage.deleteObject(existingCourse.intro_video_path);
                            } catch (err) {
                                console.error('Error deleting old intro video from R2:', err);
                            }
                        } else {
                            // Delete from local storage
                            const oldPath = path.join(__dirname, '../../uploads', existingCourse.intro_video_path.replace('/uploads/', ''));
                            if (fs.existsSync(oldPath)) {
                                try {
                                    fs.unlinkSync(oldPath);
                                } catch (err) {
                                    console.error('Error deleting old intro video:', err);
                                }
                            }
                        }
                    }
                    
                    if (r2Storage.isConfigured) {
                        // Upload to R2
                        const fileBuffer = fs.readFileSync(file.path);
                        const r2Key = await r2Storage.uploadCourseMedia(
                            req.user.id,
                            req.params.id,
                            fileBuffer,
                            file.originalname,
                            'introVideo'
                        );
                        courseData.introVideoPath = r2Key;
                        // Delete local temp file
                        fs.unlinkSync(file.path);
                    } else {
                        // Use local storage
                        courseData.introVideoPath = `/uploads/courses/${file.filename}`;
                    }
                }
            } else if (req.file) {
                // Single file upload (fallback)
                if (req.file.fieldname === 'thumbnail') {
                    if (existingCourse.thumbnail_path) {
                        if (r2Storage.isConfigured && existingCourse.thumbnail_path.startsWith('teachers/')) {
                            try {
                                await r2Storage.deleteObject(existingCourse.thumbnail_path);
                            } catch (err) {
                                console.error('Error deleting old thumbnail from R2:', err);
                            }
                        } else {
                            const oldPath = path.join(__dirname, '../../uploads', existingCourse.thumbnail_path.replace('/uploads/', ''));
                            if (fs.existsSync(oldPath)) {
                                try {
                                    fs.unlinkSync(oldPath);
                                } catch (err) {
                                    console.error('Error deleting old thumbnail:', err);
                                }
                            }
                        }
                    }
                    
                    if (r2Storage.isConfigured) {
                        const fileBuffer = fs.readFileSync(req.file.path);
                        const r2Key = await r2Storage.uploadCourseMedia(
                            req.user.id,
                            req.params.id,
                            fileBuffer,
                            req.file.originalname,
                            'thumbnail'
                        );
                        courseData.thumbnailPath = r2Key;
                        fs.unlinkSync(req.file.path);
                    } else {
                        courseData.thumbnailPath = `/uploads/courses/${req.file.filename}`;
                    }
                } else if (req.file.fieldname === 'introVideo') {
                    if (existingCourse.intro_video_path) {
                        if (r2Storage.isConfigured && existingCourse.intro_video_path.startsWith('teachers/')) {
                            try {
                                await r2Storage.deleteObject(existingCourse.intro_video_path);
                            } catch (err) {
                                console.error('Error deleting old intro video from R2:', err);
                            }
                        } else {
                            const oldPath = path.join(__dirname, '../../uploads', existingCourse.intro_video_path.replace('/uploads/', ''));
                            if (fs.existsSync(oldPath)) {
                                try {
                                    fs.unlinkSync(oldPath);
                                } catch (err) {
                                    console.error('Error deleting old intro video:', err);
                                }
                            }
                        }
                    }
                    
                    if (r2Storage.isConfigured) {
                        const fileBuffer = fs.readFileSync(req.file.path);
                        const r2Key = await r2Storage.uploadCourseMedia(
                            req.user.id,
                            req.params.id,
                            fileBuffer,
                            req.file.originalname,
                            'introVideo'
                        );
                        courseData.introVideoPath = r2Key;
                        fs.unlinkSync(req.file.path);
                    } else {
                        courseData.introVideoPath = `/uploads/courses/${req.file.filename}`;
                    }
                }
            }
            
            // If no new file uploaded but thumbnailUrl/introVideoUrl provided, keep existing
            // (This handles the case where frontend sends existing URLs)
            if (!courseData.thumbnailPath && req.body.thumbnailUrl) {
                courseData.thumbnailPath = req.body.thumbnailUrl;
            }
            if (!courseData.introVideoPath && req.body.introVideoUrl) {
                courseData.introVideoPath = req.body.introVideoUrl;
            }

            const course = await courseService.updateCourse(req.params.id, courseData);
            res.json(course);
        } catch (error) {
            console.error('Update course error:', error);
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }

    async deleteCourse(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const existingCourse = await courseService.getCourseById(req.params.id);
            if (!existingCourse) {
                return res.status(404).json({ error: 'Course not found' });
            }
            if (existingCourse.teacher_id !== req.user.id) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            // Delete associated files
            if (existingCourse.thumbnail_path) {
                if (r2Storage.isConfigured && existingCourse.thumbnail_path.startsWith('teachers/')) {
                    // Delete from R2
                    try {
                        await r2Storage.deleteObject(existingCourse.thumbnail_path);
                    } catch (err) {
                        console.error('Error deleting thumbnail from R2:', err);
                    }
                } else {
                    // Delete from local storage
                    const thumbnailPath = path.join(__dirname, '../../uploads', existingCourse.thumbnail_path.replace('/uploads/', ''));
                    if (fs.existsSync(thumbnailPath)) {
                        try {
                            fs.unlinkSync(thumbnailPath);
                        } catch (err) {
                            console.error('Error deleting thumbnail:', err);
                        }
                    }
                }
            }
            if (existingCourse.intro_video_path) {
                if (r2Storage.isConfigured && existingCourse.intro_video_path.startsWith('teachers/')) {
                    // Delete from R2
                    try {
                        await r2Storage.deleteObject(existingCourse.intro_video_path);
                    } catch (err) {
                        console.error('Error deleting intro video from R2:', err);
                    }
                } else {
                    // Delete from local storage
                    const videoPath = path.join(__dirname, '../../uploads', existingCourse.intro_video_path.replace('/uploads/', ''));
                    if (fs.existsSync(videoPath)) {
                        try {
                            fs.unlinkSync(videoPath);
                        } catch (err) {
                            console.error('Error deleting intro video:', err);
                        }
                    }
                }
            }

            await courseService.deleteCourse(req.params.id);
            res.json({ message: 'Course deleted successfully' });
        } catch (error) {
            console.error('Delete course error:', error);
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }

    async purchaseCourse(req, res) {
        try {
            const courseId = req.params.id;
            const userId = req.user.id;
            const { payment_method: paymentMethod, payment_reference: paymentReference } = req.body || {};
            // In production: validate payment with gateway using paymentMethod/paymentReference before enrolling
            await courseService.enrollUser(userId, courseId);
            res.json({
                message: 'Course purchased successfully',
                payment_method: paymentMethod || null,
            });
        } catch (error) {
            console.error('Purchase course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getPurchasedCourses(req, res) {
        try {
            const courses = await courseService.getPurchasedCourses(req.user.id);
            res.json(courses);
        } catch (error) {
            console.error('Get purchased courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getAvailableCourses(req, res) {
        try {
            const courses = await courseService.getUnpurchasedCourses(req.user.id);
            res.json(courses);
        } catch (error) {
            console.error('Get available courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async streamCourseMedia(req, res) {
        try {
            const key = req.params.key;
            if (!key || !r2Storage.isConfigured) {
                return res.status(404).send('Media not found');
            }

            // Check if file exists in R2
            const exists = await r2Storage.objectExists(key);
            if (!exists) {
                return res.status(404).send('Media not found');
            }

            // Determine content type from file extension
            const ext = key.split('.').pop().toLowerCase();
            let contentType = 'application/octet-stream';
            if (['jpg', 'jpeg'].includes(ext)) contentType = 'image/jpeg';
            else if (ext === 'png') contentType = 'image/png';
            else if (ext === 'gif') contentType = 'image/gif';
            else if (ext === 'webp') contentType = 'image/webp';
            else if (ext === 'mp4') contentType = 'video/mp4';
            else if (ext === 'mov') contentType = 'video/quicktime';
            else if (ext === 'avi') contentType = 'video/x-msvideo';
            else if (ext === 'webm') contentType = 'video/webm';

            // Set CORS headers for cross-origin image/video requests
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type');
            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
            res.set('Cross-Origin-Resource-Policy', 'cross-origin');

            // Stream the file
            const stream = await r2Storage.getObjectStream(key);
            stream.pipe(res);
        } catch (error) {
            console.error('Stream course media error:', error);
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Media not found');
            }
            res.status(500).send('Internal server error');
        }
    }
}

module.exports = new CourseController();
