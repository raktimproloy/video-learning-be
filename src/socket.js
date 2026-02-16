const socketIo = require('socket.io');

let io;

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

    // Handle chat messages
    socket.on('chatMessage', ({ roomId, message, user }) => {
      // Broadcast to everyone in the room INCLUDING sender (or exclude if preferred)
      io.to(roomId).emit('chatMessage', {
        user,
        message,
        timestamp: new Date().toISOString()
      });
    });

    // Handle teacher notes
    socket.on('teacherNote', ({ roomId, note }) => {
      io.to(roomId).emit('teacherNote', {
        note,
        timestamp: new Date().toISOString()
      });
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
