// Mock player list for demo
let lobbyPlayers = [];

// Handle avatar upload
let avatarDataUrl = null;
const avatarInput = document.getElementById('avatarInput');
if (avatarInput) {
    avatarInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            avatarDataUrl = evt.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Add player to lobby (for demo, replace with WebSocket logic)
function addPlayerToLobby(name, avatar, isHost = false) {
    lobbyPlayers.push({
        name,
        avatar,
        isHost,
        status: 'Waiting'
    });
    renderLobbyPlayers();
}

// Connect to WebSocket server
let ws = null;
let myPlayerId = null;
let myRoomCode = null;
let amHost = false;
let gameStarted = false;
let lastGameState = null;

function connectWebSocket() {
    const serverUrl = window.location.origin.replace(/^http/, 'ws'); // Use Render-provided domain
    ws = new WebSocket(`${serverUrl}/ws`); // Adjust path if needed

    ws.onopen = () => {
        console.log('WebSocket connection established.');
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Failed to connect to the server. Please ensure the server is running.');
    };

    ws.onclose = () => {
        console.warn('WebSocket connection closed.');
        alert('Disconnected from the server.');
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'lobby_update' || msg.type === 'game_started') {
            lobbyPlayers = msg.players;
            myRoomCode = msg.room;
            amHost = !!lobbyPlayers.find(p => p.id === myPlayerId && p.isHost);
            gameStarted = msg.started || msg.type === 'game_started';
            renderLobbyPlayers();
            renderLobbyControls();
            document.getElementById('chat').style.display = gameStarted ? '' : 'none'; // Show chat only during the game
            if (gameStarted) {
                document.getElementById('lobby').style.display = 'none';
                document.getElementById('game').style.display = '';
            }
        }
        if (msg.type === 'room_joined') {
            myRoomCode = msg.room;
            myPlayerId = msg.id;
            document.getElementById('lobby').style.display = '';
            document.getElementById('game').style.display = 'none';
            document.getElementById('chat').style.display = 'none'; // Hide chat in the lobby
            renderLobbyControls();
            const roomInput = document.getElementById('room');
            if (roomInput && (!roomInput.value || roomInput.value.toUpperCase() !== myRoomCode)) {
                roomInput.value = myRoomCode;
            }
        }
        if (msg.type === 'game_state') {
            document.getElementById('lobby').style.display = 'none';
            document.getElementById('game').style.display = '';
            document.getElementById('chat').style.display = ''; // Show chat during the game
            lastGameState = msg;
            renderHand(msg.hand, msg.discardTop);
            renderDiscard(msg.discardTop);
            renderOtherPlayers(msg.players, myPlayerId, msg.currentPlayer);
            renderTurnIndicator(msg.players, msg.currentPlayer);
        }
        if (msg.type === 'game_over') {
            alert(msg.message);
            gameStarted = false;
            document.getElementById('game').style.display = 'none';
            document.getElementById('lobby').style.display = '';
            document.getElementById('chat').style.display = 'none'; // Hide chat after the game ends
            lobbyPlayers = msg.players;
            renderLobbyPlayers();
            renderLobbyControls();
        }
        if (msg.type === 'chat_message') {
            renderChatMessage(msg.sender, msg.message);
        }
    };
}

// Send join/create to server
function sendJoinOrCreate(type) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        type,
        name: document.getElementById('username').value || 'Player',
        avatar: avatarDataUrl,
        room: document.getElementById('room').value.trim() || undefined
    }));
}

// Send profile update to server
function sendProfileUpdate() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        type: 'update_profile',
        name: document.getElementById('username').value || 'Player',
        avatar: avatarDataUrl
    }));
}

// Send start game to server
function sendStartGame() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'start_game' }));
}

// Send chat message to server
function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    if (!chatInput || !ws || ws.readyState !== WebSocket.OPEN || !myRoomCode) return; // Ensure player is in a room
    const message = chatInput.value.trim();
    if (message) {
        ws.send(JSON.stringify({
            type: 'chat_message',
            message
        }));
        chatInput.value = ''; // Clear input after sending
    }
}

// Render chat message in the chat window
function renderChatMessage(sender, message) {
    const chatContainer = document.getElementById('chatMessages');
    if (!chatContainer) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    messageDiv.style.color = 'black'; // Set text color to black
    messageDiv.innerHTML = `<strong>${sender}:</strong> ${message}`;
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to the bottom
}

// Override join/create button handlers
const joinBtn = document.getElementById('joinBtn');
if (joinBtn) {
    joinBtn.addEventListener('click', function() {
        if (!ws || ws.readyState !== WebSocket.OPEN) connectWebSocket();
        setTimeout(() => sendJoinOrCreate('join'), 100);
    });
}
const createBtn = document.getElementById('createBtn');
if (createBtn) {
    createBtn.addEventListener('click', function() {
        if (!ws || ws.readyState !== WebSocket.OPEN) connectWebSocket();
        setTimeout(() => sendJoinOrCreate('create'), 100);
    });
}

// Update profile on name/avatar change (in lobby)
const usernameInput = document.getElementById('username');
if (usernameInput) {
    usernameInput.addEventListener('input', () => {
        sendProfileUpdate();
    });
}
if (avatarInput) {
    avatarInput.addEventListener('change', () => {
        setTimeout(sendProfileUpdate, 200);
    });
}

// Render lobby player cards
function renderLobbyPlayers() {
    const container = document.getElementById('lobby-players');
    if (!container) return;
    container.innerHTML = '';
    lobbyPlayers.forEach(player => {
        // Wrapper for name above card
        const wrapper = document.createElement('div');
        wrapper.className = 'lobby-player-wrapper';

        // Name above card
        const nameDiv = document.createElement('div');
        nameDiv.className = 'lobby-player-name';
        nameDiv.textContent = player.name;
        wrapper.appendChild(nameDiv);

        // Card
        const card = document.createElement('div');
        card.className = 'lobby-player-card' + (player.isHost ? ' host' : '');

        if (player.isHost) {
            const hostDiv = document.createElement('div');
            hostDiv.className = 'lobby-player-role';
            hostDiv.textContent = 'Host';
            card.appendChild(hostDiv);
        }

        const avatarContainer = document.createElement('div');
        avatarContainer.className = 'lobby-player-avatar-container';
        const avatarImg = document.createElement('img');
        avatarImg.className = 'lobby-player-avatar';
        avatarImg.src = player.avatar || 'https://upload.wikimedia.org/wikipedia/commons/5/5d/UNO_Logo.svg';
        avatarImg.alt = 'avatar';
        avatarContainer.appendChild(avatarImg);
        card.appendChild(avatarContainer);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'lobby-player-status';
        statusDiv.textContent = player.status || '';
        card.appendChild(statusDiv);

        wrapper.appendChild(card);
        container.appendChild(wrapper);
    });
}

// Render lobby controls (show start button only for host)
function renderLobbyControls() {
    let controls = document.getElementById('lobby-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'lobby-controls';
        document.getElementById('lobby').appendChild(controls);
    }
    controls.innerHTML = '';
    if (amHost && !gameStarted) {
        const startBtn = document.createElement('button');
        startBtn.textContent = 'Start Game';
        startBtn.style.marginTop = '24px';
        startBtn.style.fontSize = '1.2em';
        startBtn.style.background = '#ffe94e';
        startBtn.style.color = '#a80000';
        startBtn.style.fontWeight = 'bold';
        startBtn.style.borderRadius = '12px';
        startBtn.style.padding = '12px 32px';
        startBtn.onclick = sendStartGame;
        controls.appendChild(startBtn);
    }
}

// Check if the play is valid
function isValidPlay(card, topCard) {
    if (!topCard) return false;
    // If top card is wild/wild4 with chosenColor, match that color
    if ((topCard.type === 'wild' || topCard.type === 'wild4') && topCard.chosenColor) {
        if (card.color === topCard.chosenColor) return true;
    }
    // Wilds always valid
    if (card.type === 'wild' || card.type === 'wild4') return true;
    // Same color or same number or same special type
    if (card.color === topCard.color) return true;
    if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
    if (card.type !== 'number' && card.type === topCard.type) return true;
    return false;
}

// Render player's hand
function renderHand(hand, discardTop) {
    const handDiv = document.getElementById('hand');
    if (!handDiv) return;
    handDiv.innerHTML = '';
    hand.forEach((card, idx) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card ' + (card.color || '') + ' ' + (card.type !== 'number' ? card.type : '');
        cardDiv.textContent = card.type === 'number' ? card.value : card.type === 'wild' ? 'Wild' : card.type === 'wild4' ? '+4' : (
            card.type === 'reverse' ? '⤾' : card.type === 'skip' ? '⦸' : card.type === 'draw2' ? '+2' : ''
        );
        cardDiv.style.fontSize = '2em';
        cardDiv.style.width = '70px';
        cardDiv.style.height = '110px';
        cardDiv.style.margin = '0 8px';
        cardDiv.style.display = 'inline-flex';
        cardDiv.style.alignItems = 'center';
        cardDiv.style.justifyContent = 'center';
        cardDiv.style.borderRadius = '14px';
        cardDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        // Only allow click if valid move and it's your turn
        let canPlay = false;
        if (lastGameState && lastGameState.currentPlayer !== undefined) {
            const myIdx = lastGameState.players.findIndex(p => p.id === myPlayerId);
            if (myIdx === lastGameState.currentPlayer) {
                canPlay = isValidPlay(card, discardTop);
            }
        }
        if (canPlay) {
            cardDiv.style.cursor = 'pointer';
            cardDiv.addEventListener('click', () => {
                playCard(idx);
            });
        } else {
            cardDiv.style.opacity = '0.5';
        }
        handDiv.appendChild(cardDiv);
    });
    setupDrawCardButton();
}

function playCard(cardIdx) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const card = lastGameState.hand[cardIdx];
    if (card.type === 'wild' || card.type === 'wild4') {
        // Prompt for color selection
        const color = prompt('Choose a color: red, yellow, green, blue').toLowerCase();
        if (!['red', 'yellow', 'green', 'blue'].includes(color)) {
            alert('Invalid color!');
            return;
        }
        ws.send(JSON.stringify({
            type: 'play_card',
            cardIdx,
            chosenColor: color
        }));
    } else {
        ws.send(JSON.stringify({
            type: 'play_card',
            cardIdx
        }));
    }
}

// Render discard pile top card
function renderDiscard(card) {
    const discardDiv = document.getElementById('discard-pile');
    if (!discardDiv) return;
    discardDiv.innerHTML = '';
    if (!card) return;
    // If wild/wild4 with chosenColor, use that color for the card background
    let colorClass = card.color || '';
    if ((card.type === 'wild' || card.type === 'wild4') && card.chosenColor) {
        colorClass = card.chosenColor;
    }
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card ' + colorClass + ' ' + (card.type !== 'number' ? card.type : '');
    cardDiv.textContent = card.type === 'number' ? card.value : card.type === 'wild' ? 'Wild' : card.type === 'wild4' ? '+4' : (
        card.type === 'reverse' ? '⤾' : card.type === 'skip' ? '⦸' : card.type === 'draw2' ? '+2' : ''
    );
    discardDiv.appendChild(cardDiv);
}

// Add after renderHand and before connectWebSocket();
function canDrawCard() {
    if (!lastGameState || lastGameState.currentPlayer === undefined) return false;
    const myIdx = lastGameState.players.findIndex(p => p.id === myPlayerId);
    if (myIdx !== lastGameState.currentPlayer) return false;
    // Check if any card in hand is a valid play
    const hand = lastGameState.hand || [];
    const top = lastGameState.discardTop;
    for (const card of hand) {
        if (isValidPlay(card, top)) return false;
    }
    return true;
}

function setupDrawCardButton() {
    const btn = document.getElementById('drawCardBtn');
    if (!btn) return;
    btn.disabled = !canDrawCard();
    btn.onclick = function() {
        if (canDrawCard()) {
            ws.send(JSON.stringify({ type: 'draw_card' }));
        }
    };
}

// Render other players around the table
function renderOtherPlayers(players, myId, currentPlayerIdx) {
    const topDiv = document.getElementById('players-top');
    const bottomDiv = document.getElementById('players-bottom');
    if (!topDiv || !bottomDiv) return;
    topDiv.innerHTML = '';
    bottomDiv.innerHTML = '';

    // Arrange players: current player always at bottom, others split top/bottom
    const myIdx = players.findIndex(p => p.id === myId);
    const ordered = [];
    for (let i = 1; i < players.length; ++i) {
        ordered.push(players[(myIdx + i) % players.length]);
    }
    // For up to 4 players: 1 at bottom (you), 1 left, 1 top, 1 right
    // For more: split evenly top/bottom
    const half = Math.ceil(ordered.length / 2);
    const topPlayers = ordered.slice(0, half);
    const bottomPlayers = ordered.slice(half);

    // Helper to render a player card (not hand)
    function renderPlayer(player, idx) {
        const div = document.createElement('div');
        div.className = 'table-player' + (idx === currentPlayerIdx ? ' current-turn' : '');
        if (player.avatar) {
            const img = document.createElement('img');
            img.className = 'table-player-avatar';
            img.src = player.avatar;
            div.appendChild(img);
        }
        const name = document.createElement('div');
        name.className = 'table-player-name';
        name.textContent = player.name;
        div.appendChild(name);

        // Card count (show as card backs)
        const cardsDiv = document.createElement('div');
        cardsDiv.className = 'table-player-cards';
        for (let i = 0; i < (player.cardCount || 0); ++i) {
            const cardBack = document.createElement('div');
            cardBack.className = 'card back small';
            cardsDiv.appendChild(cardBack);
        }
        div.appendChild(cardsDiv);

        return div;
    }

    topPlayers.forEach((p, idx) => topDiv.appendChild(renderPlayer(p, players.findIndex(x => x.id === p.id))));
    bottomPlayers.forEach((p, idx) => bottomDiv.appendChild(renderPlayer(p, players.findIndex(x => x.id === p.id))));
}

// Render turn indicator
function renderTurnIndicator(players, currentPlayerIdx) {
    const div = document.getElementById('turn-indicator');
    if (!div) return;
    if (currentPlayerIdx === undefined || !players[currentPlayerIdx]) {
        div.textContent = '';
        return;
    }
    div.textContent = `Turn: ${players[currentPlayerIdx].name}`;
}

// Optionally, connect on page load so the socket is ready
connectWebSocket();

// Add event listener for chat input
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
if (chatInput && chatSendBtn) {
    chatSendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
}