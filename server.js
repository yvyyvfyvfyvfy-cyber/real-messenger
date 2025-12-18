// ============================================
// Real Messenger - Backend Server
// Версия 1.0.0
// ============================================

// Импорт необходимых модулей
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

// Создание Express приложения
const app = express();

// Настройка CORS для всех доменов (в разработке)
app.use(cors({
    origin: "*", // Оставьте так для начала, потом ограничим
    credentials: true
}));
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
}));

// Middleware для парсинга JSON
app.use(express.json());

// Логирование запросов
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Статическая папка для фронтенда (опционально)
app.use(express.static(path.join(__dirname, '../frontend')));

// Создание HTTP сервера
const server = http.createServer(app);

// Настройка Socket.IO
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// ============================================
// ХРАНИЛИЩА ДАННЫХ
// ============================================

// Хранилище активных пользователей
// Формат: { socketId: { username, roomId, joinedAt, avatarColor } }
const activeUsers = new Map();

// Хранилище комнат
// Формат: { roomId: { id, name, messages: [], users: [], createdAt, isPublic } }
const activeRooms = new Map();

// Хранилище сообщений (ограниченная история для каждой комнаты)
const MAX_MESSAGES_PER_ROOM = 200;

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

// Генерация случайного цвета для аватара
function generateAvatarColor() {
    const colors = [
        '#667eea', '#764ba2', '#f093fb', '#f5576c',
        '#4facfe', '#00f2fe', '#43e97b', '#38f9d7',
        '#fa709a', '#fee140', '#a8edea', '#fed6e3'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Генерация ID комнаты
function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Без 0,1,O,I для избежания путаницы
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Валидация имени пользователя
function isValidUsername(username) {
    if (!username || typeof username !== 'string') return false;
    const trimmed = username.trim();
    return trimmed.length >= 2 && trimmed.length <= 20 && /^[a-zA-Zа-яА-ЯёЁ0-9_\-\s]+$/.test(trimmed);
}

// Валидация ID комнаты
function isValidRoomId(roomId) {
    return roomId && typeof roomId === 'string' && /^[A-Z0-9]{6}$/.test(roomId);
}

// Очистка старых комнат
function cleanupEmptyRooms() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [roomId, room] of activeRooms.entries()) {
        if (room.users.length === 0 && (now - room.lastActivity) > oneHour) {
            activeRooms.delete(roomId);
            console.log(`🗑️  Удалена пустая комната: ${roomId}`);
        }
    }
}

// Запуск периодической очистки каждые 30 минут
setInterval(cleanupEmptyRooms, 30 * 60 * 1000);

// ============================================
// SOCKET.IO ОБРАБОТЧИКИ
// ============================================

io.on('connection', (socket) => {
    console.log(`🔗 Новое подключение: ${socket.id}`);
    
    // ============================
    // 1. СОЗДАНИЕ КОМНАТЫ
    // ============================
    socket.on('create-room', (data) => {
        try {
            const { username, roomName = 'Новая комната' } = data;
            
            // Валидация имени
            if (!isValidUsername(username)) {
                socket.emit('error', { 
                    code: 'INVALID_USERNAME', 
                    message: 'Имя должно быть от 2 до 20 символов и содержать только буквы, цифры и пробелы' 
                });
                return;
            }
            
            // Генерация уникального ID комнаты
            let roomId;
            let attempts = 0;
            do {
                roomId = generateRoomId();
                attempts++;
                if (attempts > 10) {
                    socket.emit('error', { 
                        code: 'ROOM_GENERATION_FAILED', 
                        message: 'Не удалось создать комнату. Попробуйте еще раз.' 
                    });
                    return;
                }
            } while (activeRooms.has(roomId));
            
            // Создание комнаты
            const room = {
                id: roomId,
                name: roomName.substring(0, 50),
                messages: [],
                users: [],
                createdAt: new Date(),
                lastActivity: Date.now(),
                isPublic: false,
                settings: {
                    maxUsers: 10,
                    allowFiles: true,
                    allowVoice: false
                }
            };
            
            activeRooms.set(roomId, room);
            
            // Присоединение пользователя к комнате
            joinUserToRoom(socket, username, roomId);
            
            console.log(`✅ Комната создана: ${roomId} пользователем ${username}`);
            
        } catch (error) {
            console.error('❌ Ошибка при создании комнаты:', error);
            socket.emit('error', { 
                code: 'SERVER_ERROR', 
                message: 'Внутренняя ошибка сервера' 
            });
        }
    });
    
    // ============================
    // 2. ПРИСОЕДИНЕНИЕ К КОМНАТЕ
    // ============================
    socket.on('join-room', (data) => {
        try {
            const { username, roomId } = data;
            
            // Валидация данных
            if (!isValidUsername(username)) {
                socket.emit('error', { 
                    code: 'INVALID_USERNAME', 
                    message: 'Неверное имя пользователя' 
                });
                return;
            }
            
            if (!isValidRoomId(roomId)) {
                socket.emit('error', { 
                    code: 'INVALID_ROOM_ID', 
                    message: 'Неверный код комнаты' 
                });
                return;
            }
            
            // Проверка существования комнаты
            const room = activeRooms.get(roomId);
            if (!room) {
                socket.emit('error', { 
                    code: 'ROOM_NOT_FOUND', 
                    message: 'Комната не найдена. Проверьте код.' 
                });
                return;
            }
            
            // Проверка лимита пользователей
            if (room.users.length >= room.settings.maxUsers) {
                socket.emit('error', { 
                    code: 'ROOM_FULL', 
                    message: 'Комната заполнена. Максимум пользователей: ' + room.settings.maxUsers 
                });
                return;
            }
            
            // Проверка на дублирование имени в комнате
            const usernameExists = room.users.some(user => 
                user.username.toLowerCase() === username.toLowerCase()
            );
            
            if (usernameExists) {
                socket.emit('error', { 
                    code: 'USERNAME_EXISTS', 
                    message: 'Имя пользователя уже занято в этой комнате' 
                });
                return;
            }
            
            // Присоединение пользователя
            joinUserToRoom(socket, username, roomId);
            
            console.log(`✅ ${username} присоединился к комнате ${roomId}`);
            
        } catch (error) {
            console.error('❌ Ошибка при присоединении к комнате:', error);
            socket.emit('error', { 
                code: 'SERVER_ERROR', 
                message: 'Внутренняя ошибка сервера' 
            });
        }
    });
    
    // ============================
    // 3. ОТПРАВКА СООБЩЕНИЯ
    // ============================
    socket.on('send-message', (data) => {
        try {
            const { text, type = 'text' } = data;
            const user = activeUsers.get(socket.id);
            
            if (!user) {
                socket.emit('error', { 
                    code: 'USER_NOT_FOUND', 
                    message: 'Пользователь не найден' 
                });
                return;
            }
            
            const room = activeRooms.get(user.roomId);
            if (!room) {
                socket.emit('error', { 
                    code: 'ROOM_NOT_FOUND', 
                    message: 'Комната не найдена' 
                });
                return;
            }
            
            // Валидация сообщения
            const trimmedText = text ? text.toString().trim() : '';
            if (!trimmedText && type === 'text') {
                socket.emit('error', { 
                    code: 'EMPTY_MESSAGE', 
                    message: 'Сообщение не может быть пустым' 
                });
                return;
            }
            
            if (trimmedText.length > 1000) {
                socket.emit('error', { 
                    code: 'MESSAGE_TOO_LONG', 
                    message: 'Сообщение слишком длинное (макс. 1000 символов)' 
                });
                return;
            }
            
            // Создание объекта сообщения
            const message = {
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                userId: socket.id,
                username: user.username,
                text: trimmedText,
                type: type, // 'text', 'image', 'file', 'system'
                timestamp: new Date().toISOString(),
                avatarColor: user.avatarColor,
                metadata: {}
            };
            
            // Добавление в историю (с ограничением размера)
            room.messages.push(message);
            if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
                room.messages = room.messages.slice(-MAX_MESSAGES_PER_ROOM);
            }
            
            room.lastActivity = Date.now();
            
            // Отправка сообщения всем в комнате
            io.to(user.roomId).emit('new-message', message);
            
            console.log(`💬 ${user.username} отправил сообщение в ${user.roomId}`);
            
        } catch (error) {
            console.error('❌ Ошибка при отправке сообщения:', error);
            socket.emit('error', { 
                code: 'SERVER_ERROR', 
                message: 'Ошибка при отправке сообщения' 
            });
        }
    });
    
    // ============================
    // 4. ОТПРАВКА ФАЙЛА
    // ============================
    socket.on('send-file', (data) => {
        try {
            const { fileName, fileType, fileSize, fileData } = data;
            const user = activeUsers.get(socket.id);
            
            if (!user) return;
            
            const room = activeRooms.get(user.roomId);
            if (!room) return;
            
            // Проверка размера файла (макс. 5MB)
            if (fileSize > 5 * 1024 * 1024) {
                socket.emit('error', { 
                    code: 'FILE_TOO_LARGE', 
                    message: 'Файл слишком большой (макс. 5MB)' 
                });
                return;
            }
            
            // Создание сообщения с файлом
            const message = {
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                userId: socket.id,
                username: user.username,
                text: `Файл: ${fileName}`,
                type: 'file',
                timestamp: new Date().toISOString(),
                avatarColor: user.avatarColor,
                metadata: {
                    fileName: fileName.substring(0, 100),
                    fileType: fileType,
                    fileSize: fileSize,
                    fileData: fileData.substring(0, 10 * 1024 * 1024) // Ограничение 10MB в памяти
                }
            };
            
            room.messages.push(message);
            room.lastActivity = Date.now();
            
            io.to(user.roomId).emit('new-file', message);
            console.log(`📎 ${user.username} отправил файл ${fileName} в ${user.roomId}`);
            
        } catch (error) {
            console.error('❌ Ошибка при отправке файла:', error);
            socket.emit('error', { 
                code: 'SERVER_ERROR', 
                message: 'Ошибка при отправке файла' 
            });
        }
    });
    
    // ============================
    // 5. ИЗМЕНЕНИЕ НАСТРОЕК
    // ============================
    socket.on('change-settings', (data) => {
        try {
            const { settings } = data;
            const user = activeUsers.get(socket.id);
            
            if (!user) return;
            
            const room = activeRooms.get(user.roomId);
            if (!room) return;
            
            // Обновление настроек комнаты
            room.settings = { ...room.settings, ...settings };
            room.lastActivity = Date.now();
            
            // Уведомление всех пользователей
            io.to(user.roomId).emit('settings-updated', room.settings);
            
        } catch (error) {
            console.error('❌ Ошибка при изменении настроек:', error);
        }
    });
    
    // ============================
    // 6. ПРОВЕРКА СВЯЗИ
    // ============================
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            callback({ pong: Date.now() });
        }
    });
    
    // ============================
    // 7. ОТКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ
    // ============================
    socket.on('disconnect', () => {
        try {
            const user = activeUsers.get(socket.id);
            
            if (user) {
                const room = activeRooms.get(user.roomId);
                
                if (room) {
                    // Удаление пользователя из комнаты
                    room.users = room.users.filter(u => u.socketId !== socket.id);
                    
                    // Обновление активности комнаты
                    room.lastActivity = Date.now();
                    
                    // Системное сообщение о выходе
                    const systemMessage = {
                        id: Date.now() + '_system',
                        userId: 'system',
                        username: 'Система',
                        text: `${user.username} покинул(а) чат`,
                        type: 'system',
                        timestamp: new Date().toISOString(),
                        avatarColor: '#666'
                    };
                    
                    room.messages.push(systemMessage);
                    
                    // Уведомление остальных пользователей
                    socket.to(user.roomId).emit('user-left', {
                        username: user.username,
                        users: room.users,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Отправка системного сообщения
                    io.to(user.roomId).emit('new-message', systemMessage);
                    
                    console.log(`👋 ${user.username} отключился от комнаты ${user.roomId}`);
                    
                    // Если комната пустая, планируем удаление
                    if (room.users.length === 0) {
                        console.log(`🕒 Комната ${room.id} пуста, будет удалена через 1 час`);
                    }
                }
                
                // Удаление пользователя из активных
                activeUsers.delete(socket.id);
            }
            
            console.log(`❌ Отключение: ${socket.id}. Активных пользователей: ${activeUsers.size}`);
            
        } catch (error) {
            console.error('❌ Ошибка при отключении пользователя:', error);
        }
    });
    
    // ============================
    // 8. ЗАПРОС ИНФОРМАЦИИ О КОМНАТЕ
    // ============================
    socket.on('get-room-info', (roomId, callback) => {
        try {
            if (!isValidRoomId(roomId)) {
                if (typeof callback === 'function') {
                    callback({ error: 'Неверный код комнаты' });
                }
                return;
            }
            
            const room = activeRooms.get(roomId);
            if (!room) {
                if (typeof callback === 'function') {
                    callback({ error: 'Комната не найдена' });
                }
                return;
            }
            
            // Безопасная информация о комнате (без приватных данных)
            const roomInfo = {
                id: room.id,
                name: room.name,
                userCount: room.users.length,
                maxUsers: room.settings.maxUsers,
                createdAt: room.createdAt,
                isPublic: room.isPublic
            };
            
            if (typeof callback === 'function') {
                callback(roomInfo);
            }
            
        } catch (error) {
            console.error('❌ Ошибка при получении информации о комнате:', error);
            if (typeof callback === 'function') {
                callback({ error: 'Внутренняя ошибка сервера' });
            }
        }
    });
});

// ============================================
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПРИСОЕДИНЕНИЯ
// ============================================

function joinUserToRoom(socket, username, roomId) {
    const room = activeRooms.get(roomId);
    
    // Генерация цвета для аватара
    const avatarColor = generateAvatarColor();
    
    // Создание объекта пользователя
    const user = {
        socketId: socket.id,
        username: username.trim(),
        roomId: roomId,
        joinedAt: new Date().toISOString(),
        avatarColor: avatarColor,
        isOnline: true
    };
    
    // Добавление пользователя в комнату
    room.users.push({
        socketId: socket.id,
        username: username.trim(),
        avatarColor: avatarColor,
        joinedAt: user.joinedAt
    });
    
    // Сохранение пользователя в активных
    activeUsers.set(socket.id, user);
    
    // Присоединение сокета к комнате
    socket.join(roomId);
    
    // Обновление активности комнаты
    room.lastActivity = Date.now();
    
    // Системное сообщение о входе
    const systemMessage = {
        id: Date.now() + '_system',
        userId: 'system',
        username: 'Система',
        text: `${username} присоединился(ась) к чату`,
        type: 'system',
        timestamp: new Date().toISOString(),
        avatarColor: '#666'
    };
    
    room.messages.push(systemMessage);
    
    // Отправка истории комнаты новому пользователю
    socket.emit('room-joined', {
        roomId: room.id,
        roomName: room.name,
        messages: room.messages.slice(-50), // Последние 50 сообщений
        users: room.users.map(u => ({
            username: u.username,
            avatarColor: u.avatarColor,
            joinedAt: u.joinedAt
        })),
        settings: room.settings
    });
    
    // Уведомление других пользователей
    socket.to(roomId).emit('user-joined', {
        username: username,
        users: room.users.map(u => ({
            username: u.username,
            avatarColor: u.avatarColor
        })),
        timestamp: new Date().toISOString()
    });
    
    // Отправка системного сообщения всем
    io.to(roomId).emit('new-message', systemMessage);
}

// ============================================
// REST API МАРШРУТЫ
// ============================================

// Корневой маршрут
app.get('/', (req, res) => {
    res.json({
        name: 'Real Messenger API',
        version: '1.0.0',
        status: 'online',
        activeUsers: activeUsers.size,
        activeRooms: activeRooms.size,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Получение статистики
app.get('/api/stats', (req, res) => {
    res.json({
        totalUsers: activeUsers.size,
        totalRooms: activeRooms.size,
        activeRooms: Array.from(activeRooms.values()).map(room => ({
            id: room.id,
            name: room.name,
            userCount: room.users.length,
            createdAt: room.createdAt
        }))
    });
});

// Проверка существования комнаты
app.get('/api/room/:roomId/exists', (req, res) => {
    const { roomId } = req.params;
    
    if (!isValidRoomId(roomId)) {
        return res.status(400).json({ error: 'Неверный формат кода комнаты' });
    }
    
    const room = activeRooms.get(roomId);
    
    res.json({
        exists: !!room,
        roomId: roomId,
        userCount: room ? room.users.length : 0,
        maxUsers: room ? room.settings.maxUsers : 10
    });
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`
    ============================================
    🚀 Real Messenger Server запущен!
    ============================================
    📡 API доступен по адресу: http://localhost:${PORT}
    📡 WebSocket: ws://localhost:${PORT}
    📊 Статистика: http://localhost:${PORT}/api/stats
    ⏰ Время запуска: ${new Date().toLocaleString()}
    ============================================
    `);
});

// Обработка ошибок сервера
server.on('error', (error) => {
    console.error('❌ Ошибка сервера:', error);
    
    if (error.code === 'EADDRINUSE') {
        console.log(`⚠️  Порт ${PORT} занят. Попробуйте другой порт.`);
        process.exit(1);
    }
});

// Обработка graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Получен сигнал SIGTERM. Завершение работы...');
    server.close(() => {
        console.log('✅ Сервер остановлен.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Получен сигнал SIGINT. Завершение работы...');
    server.close(() => {
        console.log('✅ Сервер остановлен.');
        process.exit(0);
    });
});

// Экспорт для тестирования
module.exports = { app, server, io, activeUsers, activeRooms };