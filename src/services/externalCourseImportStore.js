const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const STORE_DIR = path.resolve(__dirname, '../../storage/external-course-imports');

function draftFilePath(draftId) {
    return path.join(STORE_DIR, `${draftId}.json`);
}

function sanitizeFileName(fileName) {
    return String(fileName || 'import.json').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

async function ensureStoreDir() {
    await fs.mkdir(STORE_DIR, { recursive: true });
}

async function readDraft(draftId) {
    await ensureStoreDir();
    const raw = await fs.readFile(draftFilePath(draftId), 'utf8');
    return JSON.parse(raw);
}

async function writeDraft(draft) {
    await ensureStoreDir();
    await fs.writeFile(draftFilePath(draft.id), JSON.stringify(draft, null, 2), 'utf8');
}

async function createDraft({ fileName, rawData, sourceCandidates, sourcePath, createdBy }) {
    const now = new Date().toISOString();
    const draft = {
        id: crypto.randomUUID(),
        fileName: sanitizeFileName(fileName),
        status: 'uploaded',
        rawData,
        sourceCandidates: Array.isArray(sourceCandidates) ? sourceCandidates : [],
        sourcePath: sourcePath || sourceCandidates?.[0]?.path || '$',
        mapping: {},
        items: [],
        createdAt: now,
        updatedAt: now,
        createdBy: createdBy || { id: null, email: null },
        updatedBy: createdBy || { id: null, email: null },
        importedCourseIds: [],
    };
    await writeDraft(draft);
    return draft;
}

async function updateDraft(draftId, patch = {}) {
    const current = await readDraft(draftId);
    const next = {
        ...current,
        status: patch.status ?? current.status,
        sourcePath: patch.sourcePath ?? current.sourcePath,
        mapping: patch.mapping ?? current.mapping,
        items: patch.items ?? current.items,
        importedCourseIds: patch.importedCourseIds ?? current.importedCourseIds,
        updatedBy: patch.updatedBy ?? current.updatedBy,
        updatedAt: new Date().toISOString(),
    };
    await writeDraft(next);
    return next;
}

function getSourceCount(draft) {
    const active = Array.isArray(draft.sourceCandidates)
        ? draft.sourceCandidates.find((candidate) => candidate.path === draft.sourcePath)
        : null;
    return active?.count || draft.sourceCandidates?.[0]?.count || 0;
}

async function listDraftSummaries() {
    await ensureStoreDir();
    const entries = await fs.readdir(STORE_DIR, { withFileTypes: true });
    const drafts = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
            const raw = await fs.readFile(path.join(STORE_DIR, entry.name), 'utf8');
            const draft = JSON.parse(raw);
            drafts.push({
                id: draft.id,
                fileName: draft.fileName,
                status: draft.status,
                createdAt: draft.createdAt,
                updatedAt: draft.updatedAt,
                createdBy: draft.createdBy,
                updatedBy: draft.updatedBy,
                sourceCount: getSourceCount(draft),
                itemCount: Array.isArray(draft.items) ? draft.items.length : 0,
                importedCourseIds: Array.isArray(draft.importedCourseIds) ? draft.importedCourseIds : [],
            });
        } catch (error) {
            continue;
        }
    }

    drafts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return drafts;
}

async function deleteDraft(draftId) {
    try {
        await fs.unlink(draftFilePath(draftId));
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
    }
}

module.exports = {
    createDraft,
    readDraft,
    updateDraft,
    listDraftSummaries,
    deleteDraft,
};
