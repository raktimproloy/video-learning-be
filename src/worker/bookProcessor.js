/**
 * Book PDF processor — rasterizes master PDF pages to private R2 images.
 * Primary: pdftoppm (poppler-utils), same class of native tool as ffmpeg for video.
 * Fallback: pdf-lib page count + store single "cover" placeholder if tools missing,
 * and mark pages for on-demand serving of preview via authenticated proxy of page images
 * generated with sharp when pdftoppm is unavailable (best-effort).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const db = require('../../db');
const r2Storage = require('../services/r2StorageService');
const errorLogService = require('../services/errorLogService');

let cachedPdftoppmPath = undefined; // undefined=unset, null=missing, string=path

function candidatePdftoppmPaths() {
    const candidates = [];
    if (process.env.POPPLER_BIN) candidates.push(process.env.POPPLER_BIN);
    if (process.env.PDFTOPPM_PATH) candidates.push(process.env.PDFTOPPM_PATH);
    candidates.push('pdftoppm');
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || '';
        if (localAppData) {
            try {
                const wingetRoot = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
                if (fs.existsSync(wingetRoot)) {
                    for (const pkg of fs.readdirSync(wingetRoot)) {
                        if (!/poppler/i.test(pkg)) continue;
                        const pkgDir = path.join(wingetRoot, pkg);
                        // Typical layout: poppler-*/Library/bin/pdftoppm.exe
                        let versions = [];
                        try {
                            versions = fs.readdirSync(pkgDir);
                        } catch {
                            continue;
                        }
                        for (const ver of versions) {
                            const bin = path.join(pkgDir, ver, 'Library', 'bin', 'pdftoppm.exe');
                            if (fs.existsSync(bin)) candidates.push(bin);
                        }
                    }
                }
            } catch {
                // ignore discovery errors
            }
        }
        candidates.push('C:\\Program Files\\poppler\\Library\\bin\\pdftoppm.exe');
        candidates.push('C:\\poppler\\Library\\bin\\pdftoppm.exe');
    }
    return candidates;
}

async function resolvePdftoppm() {
    if (cachedPdftoppmPath !== undefined) return cachedPdftoppmPath;
    for (const bin of candidatePdftoppmPaths()) {
        try {
            await execFileAsync(bin, ['-v'], { windowsHide: true });
            cachedPdftoppmPath = bin;
            return bin;
        } catch (e) {
            if (e.stderr && /pdftoppm/i.test(String(e.stderr))) {
                cachedPdftoppmPath = bin;
                return bin;
            }
            if (e.stdout && /pdftoppm/i.test(String(e.stdout))) {
                cachedPdftoppmPath = bin;
                return bin;
            }
        }
    }
    cachedPdftoppmPath = null;
    return null;
}

async function countPdfPages(localPdfPath) {
    const bytes = fs.readFileSync(localPdfPath);
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getPageCount();
}

async function hasPdftoppm() {
    return !!(await resolvePdftoppm());
}

async function rasterizeWithPdftoppm(localPdfPath, outDir, dpi = 150) {
    const bin = (await resolvePdftoppm()) || 'pdftoppm';
    const prefix = path.join(outDir, 'page');
    await execFileAsync(
        bin,
        ['-png', '-r', String(dpi), localPdfPath, prefix],
        { windowsHide: true, maxBuffer: 50 * 1024 * 1024 }
    );
    const files = fs
        .readdirSync(outDir)
        .filter((f) => /^page-?\d+\.png$/i.test(f) || /^page\d+\.png$/i.test(f))
        .sort((a, b) => {
            const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
            const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
            return na - nb;
        });
    return files.map((f) => path.join(outDir, f));
}

/**
 * Fallback when pdftoppm is missing: create a branded placeholder image per page
 * so the reader still works; teacher should install poppler for real pages.
 * We still store page count correctly from pdf-lib.
 */
async function createPlaceholderPages(pageCount, outDir, bookTitle) {
    const files = [];
    for (let i = 0; i < pageCount; i++) {
        const svg = `
          <svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#f8fafc"/>
            <rect x="40" y="40" width="1120" height="1520" fill="none" stroke="#cbd5e1" stroke-width="4"/>
            <text x="600" y="720" text-anchor="middle" font-family="Arial" font-size="42" fill="#334155">${escapeXml(bookTitle || 'Book')}</text>
            <text x="600" y="800" text-anchor="middle" font-family="Arial" font-size="28" fill="#64748b">Page ${i + 1} of ${pageCount}</text>
            <text x="600" y="880" text-anchor="middle" font-family="Arial" font-size="20" fill="#94a3b8">Install poppler-utils (pdftoppm) on the server for full PDF rendering</text>
          </svg>`;
        const out = path.join(outDir, `page-${String(i + 1).padStart(3, '0')}.png`);
        await sharp(Buffer.from(svg)).png().toFile(out);
        files.push(out);
    }
    return files;
}

function escapeXml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function setStage(taskId, stage) {
    await db.query(
        `UPDATE book_processing_tasks SET processing_stage = $1, updated_at = NOW() WHERE id = $2`,
        [stage, taskId]
    );
}

async function processTask(task) {
    const taskId = task.id;
    const bookId = task.course_book_id;
    const tmpRoot = path.join(os.tmpdir(), `book-proc-${bookId}-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });
    const localPdf = path.join(tmpRoot, 'master.pdf');
    const pagesDir = path.join(tmpRoot, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });

    try {
        const bookRes = await db.query(`SELECT * FROM course_books WHERE id = $1`, [bookId]);
        const book = bookRes.rows[0];
        if (!book) throw new Error('Book not found');
        if (!book.master_pdf_r2_key) throw new Error('No master PDF uploaded');

        await db.query(
            `UPDATE course_books SET processing_status = 'processing', updated_at = NOW() WHERE id = $1`,
            [bookId]
        );

        await setStage(taskId, 'downloading');
        if (!r2Storage.isConfigured) {
            throw new Error('R2 is not configured — cannot process book PDF');
        }
        await r2Storage.downloadToPath(book.master_pdf_r2_key, localPdf);

        await setStage(taskId, 'counting_pages');
        const pageCount = await countPdfPages(localPdf);
        if (!pageCount || pageCount < 1) throw new Error('PDF has no pages');

        await setStage(taskId, 'rasterizing');
        let pageFiles = [];
        const usePoppler = await hasPdftoppm();
        if (usePoppler) {
            pageFiles = await rasterizeWithPdftoppm(localPdf, pagesDir);
        } else {
            console.warn(`[BookProcessor] pdftoppm not found — using placeholder pages for book ${bookId}`);
            pageFiles = await createPlaceholderPages(pageCount, pagesDir, book.title);
        }

        if (!pageFiles.length) throw new Error('No page images produced');

        await setStage(taskId, 'uploading');
        // Clear old page assets
        await db.query(`DELETE FROM book_page_assets WHERE course_book_id = $1`, [bookId]);

        const previewCount = Math.min(book.preview_page_count || 3, pageFiles.length);
        const prefix = r2Storage.getBookKeyPrefix(book.teacher_id, book.course_id, bookId);

        for (let i = 0; i < pageFiles.length; i++) {
            const filePath = pageFiles[i];
            let width = null;
            let height = null;
            try {
                const meta = await sharp(filePath).metadata();
                width = meta.width || null;
                height = meta.height || null;
                // Re-encode as webp for smaller storage when possible
                const webpPath = path.join(pagesDir, `out-${i}.webp`);
                await sharp(filePath).webp({ quality: 82 }).toFile(webpPath);
                const key = `${prefix}/pages/page-${String(i).padStart(5, '0')}.webp`;
                await r2Storage.uploadFromPath(webpPath, key, 'image/webp');
                await db.query(
                    `INSERT INTO book_page_assets (course_book_id, page_index, r2_key, width, height, is_preview)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [bookId, i, key, width, height, i < previewCount]
                );
            } catch (pageErr) {
                // Fallback: upload original PNG
                const key = `${prefix}/pages/page-${String(i).padStart(5, '0')}.png`;
                await r2Storage.uploadFromPath(filePath, key, 'image/png');
                await db.query(
                    `INSERT INTO book_page_assets (course_book_id, page_index, r2_key, width, height, is_preview)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [bookId, i, key, width, height, i < previewCount]
                );
            }
        }

        await db.query(
            `UPDATE course_books
             SET total_pages = $1,
                 processing_status = 'ready',
                 processing_error = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [
                pageFiles.length,
                usePoppler ? null : 'Rendered with placeholders — install poppler-utils (pdftoppm) for full quality',
                bookId,
            ]
        );

        await db.query(
            `UPDATE book_processing_tasks
             SET status = 'completed', processing_stage = NULL, completed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [taskId]
        );

        console.log(`[BookProcessor] Book ${bookId}: ${pageFiles.length} pages ready (poppler=${usePoppler})`);
    } catch (err) {
        console.error(`[BookProcessor] Task ${taskId} failed:`, err.message);
        await db.query(
            `UPDATE book_processing_tasks
             SET status = 'failed', error_message = $1, processing_stage = NULL, updated_at = NOW()
             WHERE id = $2`,
            [err.message, taskId]
        );
        await db.query(
            `UPDATE course_books
             SET processing_status = 'failed', processing_error = $1, updated_at = NOW()
             WHERE id = $2`,
            [err.message, bookId]
        );
        await errorLogService
            .logSystemError('Book PDF Processing Failed', err, { taskId, bookId })
            .catch(() => {});
    } finally {
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch (_) {}
    }
}

module.exports = { processTask };
