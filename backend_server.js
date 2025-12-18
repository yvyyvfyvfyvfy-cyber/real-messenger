const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Хранилище пользователей и сообщений
const users = new Map(); // socket.id -> {username, room}
const rooms = new Map(); // roomId -> {messages: [], users: []}

// Генерация ID комнаты
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('Новое соединение:', socket.id);

  // Создание новой комнаты
  socket.on('create-room', (username) => {
    const roomId = generateRoomId();
    const room = {
      id: roomId,
      messages: [],
      users: []
    };
    
    rooms.set(roomId, room);
    
    socket.join(roomId);
    users.set(socket.id, { username, roomId });
    
    room.users.push({ id: socket.id, username });
    
    socket.emit('room-created', roomId);
    console.log(`Комната создана: ${roomId} пользователем ${username}`);
  });

  // Присоединение к комнате
  socket.on('join-room', ({ roomId, username }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', 'Комната не найдена');
      return;
    }
    
    if (room.users.length >= 10) { // Ограничение на количество пользователей
      socket.emit('error', 'Комната заполнена');
      return;
    }
    
    socket.join(roomId);
    users.set(socket.id, { username, roomId });
    
    room.users.push({ id: socket.id, username });
    
    // Уведомляем всех в комнате о новом пользователе
    io.to(roomId).emit('user-joined', {
      username,
      users: room.users,
      timestamp: new Date()
    });
    
    // Отправляем историю сообщений новому пользователю
    socket.emit('room-history', {
      messages: room.messages,
      users: room.users
    });
    
    console.log(`${username} присоединился к комнате ${roomId}`);
  });

  // Отправка сообщения
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    
    if (!user) return;
    
    const room = rooms.get(user.roomId);
    if (!room) return;
    
    const message = {
      id: Date.now().toString(),
      username: user.username,
      text: data.text,
      timestamp: new Date(),
      isSystem: false
    };
    
    room.messages.push(message);
    
    // Отправляем сообщение всем в комнате
    io.to(user.roomId).emit('new-message', message);
  });

  // Отправка файла/изображения
  socket.on('send-file', (data) => {
    const user = users.get(socket.id);
    
    if (!user) return;
    
    const room = rooms.get(user.roomId);
    if (!room) return;
    
    const message = {
      id: Date.now().toString(),
      username: user.username,
      fileName: data.fileName,
      fileType: data.fileType,
      fileData: data.fileData,
      timestamp: new Date(),
      isFile: true
    };
    
    room.messages.push(message);
    io.to(user.roomId).emit('new-file', message);
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    
    if (user) {
      const room = rooms.get(user.roomId);
      
      if (room) {
        // Удаляем пользователя из комнаты
        room.users = room.users.filter(u => u.id !== socket.id);
        
        // Уведомляем остальных
        io.to(user.roomId).emit('user-left', {
          username: user.username,
          users: room.users,
          timestamp: new Date()
        });
        
        // Если комната пустая, удаляем её через 5 минут
        if (room.users.length === 0) {
          setTimeout(() => {
            if (rooms.get(user.roomId)?.users.length === 0) {
              rooms.delete(user.roomId);
              console.log(`Комната ${user.roomId} удалена`);
            }
          }, 5 * 60 * 1000);
        }
      }
      
      users.delete(socket.id);
    }
    
    console.log('Пользователь отключился:', socket.id);
  });

  // Проверка существования комнаты
  socket.on('check-room', (roomId) => {
    const exists = rooms.has(roomId);
    socket.emit('room-exists', { roomId, exists });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});