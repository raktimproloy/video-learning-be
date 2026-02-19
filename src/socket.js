const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const liveChatService = require('./services/liveChatService');

let io;
const roomNotes = {}; // legacy in-memory notes (LiveNote)

const initSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.use((socket, next) => {
    const token = socket.handshake?.auth?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        socket.user = { id: decoded.id, email: decoded.email, role: decoded.role || 'student' };
      } catch (_) {
        socket.user = null;
      }
    } else {
      socket.user = null;
    }
    next();
  });

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id, socket.user?.id ? `user=${socket.user.id}` : 'anon');

    socket.on('joinRoom', (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId}`);
    });

    socket.on('requestNotes', (roomId) => {
      if (roomNotes[roomId] && roomNotes[roomId].length > 0) {
        socket.emit('teacherNotesList', roomNotes[roomId]);
      } else {
        socket.emit('teacherNotesList', []);
      }
    });

    socket.on('chatMessage', async ({ roomId, message, user, isTeacher }) => {
      const userId = socket.user?.id;
      const userType = (socket.user?.role === 'teacher' ? 'teacher' : 'student');
      const displayName = (user || socket.user?.email?.split('@')[0] || 'User');
      const effectiveTeacher = isTeacher === true || userType === 'teacher';

      if (!userId || !message || typeof message !== 'string' || message.trim().length === 0) {
        return;
      }
      try {
        const saved = await liveChatService.addMessage(roomId, userId, userType, displayName, message.trim());
        if (saved) {
          io.to(roomId).emit('chatMessage', {
            id: saved.id,
            user: saved.user_display_name || displayName,
            message: saved.message,
            isTeacher: effectiveTeacher,
            timestamp: saved.created_at
          });
        }
      } catch (err) {
        console.error('Chat persist error:', err);
      }
    });

    socket.on('addTeacherNote', ({ roomId, note, noteId }) => {
      if (!roomNotes[roomId]) {
        roomNotes[roomId] = [];
      }
      const newNote = {
        id: noteId,
        note,
        timestamp: new Date().toISOString()
      };
      roomNotes[roomId].push(newNote);
      io.to(roomId).emit('teacherNoteAdded', newNote);
    });

    socket.on('deleteTeacherNote', ({ roomId, noteId }) => {
      if (roomNotes[roomId]) {
        roomNotes[roomId] = roomNotes[roomId].filter(n => n.id !== noteId);
        io.to(roomId).emit('teacherNoteDeleted', noteId);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
};

const getIo = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

module.exports = { initSocket, getIo };
