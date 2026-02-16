const socketIo = require('socket.io');

let io;
// Store notes per room (in-memory, consider Redis for production)
const roomNotes = {};

const initSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: "*", // Adjust this in production to match your frontend domain
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Join a specific room (e.g., based on lessonId)
    socket.on('joinRoom', (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId}`);
    });

    // Request existing notes
    socket.on('requestNotes', (roomId) => {
      if (roomNotes[roomId] && roomNotes[roomId].length > 0) {
        socket.emit('teacherNotesList', roomNotes[roomId]);
      } else {
        socket.emit('teacherNotesList', []);
      }
    });

    // Handle chat messages
    socket.on('chatMessage', ({ roomId, message, user, isTeacher }) => {
      // Broadcast to everyone in the room INCLUDING sender (or exclude if preferred)
      io.to(roomId).emit('chatMessage', {
        user,
        message,
        isTeacher: isTeacher || false,
        timestamp: new Date().toISOString()
      });
    });

    // Handle adding teacher notes
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

    // Handle deleting teacher notes
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
