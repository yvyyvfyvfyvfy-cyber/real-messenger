class RealMessenger {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentRoom = null;
        this.users = [];
        
        this.init();
    }
    
    init() {
        // Установка соединения с сервером
        this.socket = io('http://localhost:3001'); // Замените на адрес вашего сервера
        
        this.setupEventListeners();
        this.setupSocketListeners();
    }
    
    setupEventListeners() {
        // Кнопка создания комнаты
        document.getElementById('create-room-btn').addEventListener('click', () => {
            const username = document.getElementById('username').value.trim();
            
            if (!username) {
                this.showNotification('Введите ваше имя', 'error');
                return;
            }
            
            this.currentUser = username;
            this.socket.emit('create-room', username);
        });
        
        // Кнопка присоединения к комнате
        document.getElementById('join-room-btn').addEventListener('click', () => {
            const username = document.getElementById('username').value.trim();
            const roomId = document.getElementById('room-id').value.trim().toUpperCase();
            
            if (!username) {
                this.showNotification('Введите ваше имя', 'error');
                return;
            }
            
            if (!roomId) {
                this.showNotification('Введите код комнаты', 'error');
                return;
            }
            
            this.currentUser = username;
            this.socket.emit('join-room', { roomId, username });
        });
        
        // Кнопка копирования кода комнаты
        document.getElementById('copy-room-id').addEventListener('click', () => {
            navigator.clipboard.writeText(this.currentRoom)
                .then(() => this.showNotification('Код комнаты скопирован!'))
                .catch(() => this.showNotification('Не удалось скопировать код', 'error'));
        });
        
        // Кнопка выхода
        document.getElementById('leave-room').addEventListener('click', () => {
            if (confirm('Вы уверены, что хотите покинуть комнату?')) {
                this.leaveRoom();
            }
        });
        
        // Отправка сообщения по Enter
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Кнопка отправки сообщения
        document.getElementById('send-message').addEventListener('click', () => {
            this.sendMessage();
        });
        
        // Прикрепление файла
        document.getElementById('attach-file').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
        
        document.getElementById('file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.sendFile(file);
            }
        });
    }
    
    setupSocketListeners() {
        // Комната создана
        this.socket.on('room-created', (roomId) => {
            this.currentRoom = roomId;
            this.showRoomScreen();
            this.showNotification(`Комната создана! Код: ${roomId}`);
        });
        
        // Ошибка
        this.socket.on('error', (error) => {
            this.showNotification(error, 'error');
        });
        
        // Пользователь присоединился
        this.socket.on('user-joined', (data) => {
            this.users = data.users;
            this.updateUsersList();
            
            // Добавляем системное сообщение
            this.addSystemMessage(`${data.username} присоединился к чату`);
            
            if (data.username !== this.currentUser) {
                this.showNotification(`${data.username} присоединился к чату`);
            }
        });
        
        // История комнаты
        this.socket.on('room-history', (data) => {
            this.users = data.users;
            this.updateUsersList();
            this.loadMessages(data.messages);
        });
        
        // Новое сообщение
        this.socket.on('new-message', (message) => {
            this.addMessage(message);
            this.scrollToBottom();
        });
        
        // Новый файл
        this.socket.on('new-file', (fileMessage) => {
            this.addFileMessage(fileMessage);
            this.scrollToBottom();
        });
        
        // Пользователь вышел
        this.socket.on('user-left', (data) => {
            this.users = data.users;
            this.updateUsersList();
            this.addSystemMessage(`${data.username} покинул чат`);
        });
        
        // Проверка комнаты
        this.socket.on('room-exists', (data) => {
            if (!data.exists) {
                this.showNotification('Комната не найдена', 'error');
            }
        });
    }
    
    showRoomScreen() {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('room-screen').style.display = 'block';
        
        document.getElementById('current-room-id').textContent = this.currentRoom;
        this.updateUsersList();
    }
    
    updateUsersList() {
        const usersList = document.getElementById('users-list');
        const usersCount = document.getElementById('users-count');
        
        usersList.innerHTML = '';
        usersCount.textContent = this.users.length;
        
        this.users.forEach(user => {
            const li = document.createElement('li');
            li.innerHTML = `
                <i class="fas fa-user-circle"></i>
                <span>${user.username}</span>
                ${user.id === this.socket.id ? '<span class="you-badge">(Вы)</span>' : ''}
            `;
            usersList.appendChild(li);
        });
    }
    
    sendMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        
        if (!text) return;
        
        this.socket.emit('send-message', { text });
        input.value = '';
        input.focus();
    }
    
    sendFile(file) {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const fileData = e.target.result;
            
            this.socket.emit('send-file', {
                fileName: file.name,
                fileType: file.type,
                fileData: fileData
            });
        };
        
        reader.readAsDataURL(file);
        document.getElementById('file-input').value = '';
    }
    
    addMessage(message) {
        const container = document.getElementById('messages-container');
        const isOwnMessage = message.username === this.currentUser;
        
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isOwnMessage ? 'user-message' : 'other-message'}`;
        
        const time = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageElement.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <span class="message-sender">${message.username}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-text">${this.escapeHtml(message.text)}</div>
            </div>
        `;
        
        container.appendChild(messageElement);
    }
    
    addFileMessage(fileMessage) {
        const container = document.getElementById('messages-container');
        const isOwnMessage = fileMessage.username === this.currentUser;
        
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isOwnMessage ? 'user-message' : 'other-message'}`;
        
        const time = new Date(fileMessage.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const fileSize = (fileMessage.fileData.length / 1024).toFixed(1);
        
        messageElement.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <span class="message-sender">${fileMessage.username}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="file-message">
                    <div class="file-info">
                        <div class="file-icon">
                            <i class="fas fa-file"></i>
                        </div>
                        <div class="file-details">
                            <h4>${fileMessage.fileName}</h4>
                            <p>${fileSize} KB</p>
                        </div>
                        <button class="download-btn" onclick="messenger.downloadFile('${fileMessage.fileName}', '${fileMessage.fileData}')">
                            <i class="fas fa-download"></i> Скачать
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(messageElement);
    }
    
    addSystemMessage(text) {
        const container = document.getElementById('messages-container');
        
        const systemElement = document.createElement('div');
        systemElement.className = 'system-message';
        systemElement.textContent = text;
        
        container.appendChild(systemElement);
    }
    
    loadMessages(messages) {
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        
        if (messages.length === 0) {
            container.innerHTML = `
                <div class="welcome-message">
                    <i class="fas fa-comment-dots"></i>
                    <h3>Добро пожаловать в чат!</h3>
                    <p>Отправьте первое сообщение или поделитесь кодом комнаты с другом.</p>
                </div>
            `;
            return;
        }
        
        messages.forEach(message => {
            if (message.isFile) {
                this.addFileMessage(message);
            } else {
                this.addMessage(message);
            }
        });
        
        this.scrollToBottom();
    }
    
    downloadFile(fileName, fileData) {
        const link = document.createElement('a');
        link.href = fileData;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    leaveRoom() {
        this.socket.disconnect();
        
        // Сброс состояния
        this.currentUser = null;
        this.currentRoom = null;
        this.users = [];
        
        // Возврат на экран входа
        document.getElementById('room-screen').style.display = 'none';
        document.getElementById('login-screen').classList.add('active');
        
        // Очистка полей
        document.getElementById('username').value = '';
        document.getElementById('room-id').value = '';
        document.getElementById('message-input').value = '';
        
        // Переподключение
        this.socket.connect();
    }
    
    scrollToBottom() {
        const container = document.getElementById('messages-container');
        container.scrollTop = container.scrollHeight;
    }
    
    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Инициализация приложения
const messenger = new RealMessenger();