const liveSessionService = require('../services/liveSessionService');
const liveDiagnosticsService = require('../services/liveDiagnosticsService');
class AdminLiveSessionsController {
    /** List all currently active live sessions with course, lesson, and teacher info. */
    async list(req, res) {
        try {
            const sessions = await liveSessionService.listActiveForAdmin();
            res.json({ sessions });
        } catch (error) {
            console.error('Admin live sessions list error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /** Stop (end) an active live session by session id. */
    async stop(req, res) {
        try {
            const sessionId = req.params.id;
            const session = await liveSessionService.getById(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Live session not found' });
            }
            if (session.status !== 'active') {
                return res.status(400).json({ error: 'Live session is not active' });
            }
            await liveSessionService.endDiscarded(session.lesson_id);
            res.json({ message: 'Live class stopped.', sessionId });
        } catch (error) {
            console.error('Admin stop live session error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /** Get global live stream diagnostics (Teacher -> Server -> R2 flow) */
    async getDiagnostics(req, res) {
        try {
            const report = liveDiagnosticsService.getGlobalReport();
            res.json({ diagnostics: report });
        } catch (error) {
            console.error('Admin get live diagnostics error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminLiveSessionsController();
