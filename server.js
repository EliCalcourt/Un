const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3001; // Use environment variable for port
const wss = new WebSocket.Server({ port: PORT, host: '0.0.0.0' }); // Bind to 0.0.0.0 for Render hosting

console.log(`Uno server running on ws://0.0.0.0:${PORT}`);

const rooms = {}; // roomCode -> { players: [{id, name, avatar, isHost, ws}], started: false }

function broadcastRoom(roomCode, type = 'lobby_update') {
    const room = rooms[roomCode];
    if (!room) return;
    room.players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({
                type,
                players: room.players.map(({id, name, avatar, isHost}) => ({id, name, avatar, isHost})),
                started: room.started,
                room: roomCode
            }));
        }
    });
}

// UNO DECK GENERATION
const COLORS = ['red', 'yellow', 'green', 'blue'];
const NUMBERS = [1,2,3,4,5,6,7,8,9];
const SPECIALS = ['skip', 'reverse', 'draw2'];
const WILD_CARDS = ['wild', 'wild4'];

function createUnoDeck() {
    const deck = [];
    // Number cards (two of each color/number)
    for (const color of COLORS) {
        for (const num of NUMBERS) {
            deck.push({ color, type: 'number', value: num });
            deck.push({ color, type: 'number', value: num });
        }
        // Special cards (two of each per color)
        for (const special of SPECIALS) {
            deck.push({ color, type: special });
            deck.push({ color, type: special });
        }
    }
    // Wild cards (4 of each)
    for (let i = 0; i < 4; ++i) {
        deck.push({ color: 'black', type: 'wild' });
        deck.push({ color: 'black', type: 'wild4' });
    }
    return deck;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Helper: get player by id
function getPlayer(room, id) {
    return room.players.find(p => p.id === id);
}

// Broadcast game state to all players (each gets their own hand)
function broadcastGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    room.players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({
                type: 'game_state',
                hand: room.hands[p.id] || [],
                discardTop: room.discard[room.discard.length - 1],
                drawCount: room.draw.length,
                currentPlayer: room.currentPlayer,
                direction: room.direction,
                players: room.players.map(({id, name, avatar, isHost}) => ({id, name, avatar, isHost, cardCount: (room.hands[id] || []).length})),
                room: roomCode
            }));
        }
    });
}

// Broadcast game over message
function broadcastGameOver(roomCode, winnerName) {
    const room = rooms[roomCode];
    if (!room) return;
    room.players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({
                type: 'game_over',
                message: `${winnerName} has won the game!`,
                room: roomCode
            }));
        }
    });
}

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substr(2, 6).toUpperCase();
    } while (rooms[code]);
    return code;
}

function broadcastChatMessage(roomCode, senderName, message) {
    const room = rooms[roomCode];
    if (!room) return;
    room.players.forEach(p => {
        if (p.ws && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({
                type: 'chat_message',
                sender: senderName,
                message,
                room: roomCode
            }));
        }
    });
}

wss.on('connection', function connection(ws) {
    let playerId = uuidv4();
    let currentRoom = null;

    ws.on('message', function incoming(message) {
        let msg;
        try { msg = JSON.parse(message); } catch { return; }

        if (msg.type === 'create') {
            const { name, avatar } = msg;
            const roomCode = generateRoomCode();

            rooms[roomCode] = { players: [], started: false };
            currentRoom = roomCode;

            rooms[roomCode].players.push({
                id: playerId,
                name: name || 'Player',
                avatar,
                isHost: true,
                ws
            });

            broadcastRoom(roomCode);
            ws.send(JSON.stringify({ type: 'room_joined', room: roomCode, id: playerId }));
        }

        if (msg.type === 'join') {
            const { name, avatar, room } = msg;
            const roomCode = (room || '').toUpperCase();

            if (!rooms[roomCode] || rooms[roomCode].started) {
                ws.send(JSON.stringify({ type: 'error', message: 'Room not found or already started.' }));
                return;
            }
            currentRoom = roomCode;

            // Remove previous player with same id if reconnecting
            rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== playerId);

            rooms[roomCode].players.push({
                id: playerId,
                name: name || 'Player',
                avatar,
                isHost: false,
                ws
            });

            broadcastRoom(roomCode);
            ws.send(JSON.stringify({ type: 'room_joined', room: roomCode, id: playerId }));
        }

        // Update name/avatar in lobby
        if (msg.type === 'update_profile' && currentRoom && rooms[currentRoom]) {
            const player = rooms[currentRoom].players.find(p => p.id === playerId);
            if (player) {
                if (typeof msg.name === 'string') player.name = msg.name;
                if (typeof msg.avatar === 'string') player.avatar = msg.avatar;
                broadcastRoom(currentRoom);
            }
        }

        // Host starts the game
        if (msg.type === 'start_game' && currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            const player = room.players.find(p => p.id === playerId);
            if (player && player.isHost && !room.started) {
                room.started = true;

                // --- UNO GAME SETUP ---
                // 1. Create and shuffle deck
                let deck = shuffle(createUnoDeck());

                // 2. Deal 7 cards to each player
                room.hands = {};
                for (const p of room.players) {
                    room.hands[p.id] = [];
                    for (let i = 0; i < 7; ++i) {
                        room.hands[p.id].push(deck.pop());
                    }
                }

                // 3. Set up draw and discard piles
                room.draw = deck;
                room.discard = [];

                // 4. Flip first card to discard (must be a colored number card)
                let firstCard;
                do {
                    firstCard = room.draw.pop();
                    // Put back if not a colored number card
                    if (
                        !firstCard ||
                        firstCard.type !== 'number' ||
                        !COLORS.includes(firstCard.color)
                    ) {
                        if (firstCard) room.draw.unshift(firstCard);
                        firstCard = null;
                    }
                } while (!firstCard);
                room.discard.push(firstCard);

                // 5. Set up turn order
                room.currentPlayer = 0; // index in room.players
                room.direction = 1; // 1 = clockwise, -1 = counterclockwise

                // 6. Broadcast initial game state
                broadcastGameState(currentRoom);
            }
        }

        // Handle play_card
        if (msg.type === 'play_card' && currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            if (!room.started) return;
            const playerIdx = room.players.findIndex(p => p.id === playerId);
            if (playerIdx !== room.currentPlayer) return; // Not your turn

            const hand = room.hands[playerId];
            if (!hand || typeof msg.cardIdx !== 'number' || msg.cardIdx < 0 || msg.cardIdx >= hand.length) return;
            const card = hand[msg.cardIdx];
            const top = room.discard[room.discard.length - 1];

            // Always use chosenColor if present for color matching
            let topColor = top && top.chosenColor ? top.chosenColor : (top ? top.color : null);

            // Validate play
            let valid = false;
            if (card.type === 'wild' || card.type === 'wild4') {
                valid = true;
            } else if (top && card.color === topColor) {
                valid = true;
            } else if (top && card.type === 'number' && top.type === 'number' && card.value === top.value) {
                valid = true;
            } else if (top && card.type !== 'number' && card.type === top.type) {
                valid = true;
            }

            if (!valid) return;

            // Add card to discard pile
            room.discard.push(card);

            // Remove card from hand
            hand.splice(msg.cardIdx, 1);

            // Declare winner if the player has no cards left
            if (hand.length === 0) {
                broadcastGameOver(currentRoom, room.players[playerIdx].name);
                room.started = false; // End the game

                // Reset room state for lobby
                room.hands = {};
                room.draw = [];
                room.discard = [];
                room.currentPlayer = null;
                room.direction = 1;

                broadcastRoom(currentRoom); // Update lobby state for all players
                return; // Stop further processing
            }

            // --- Wild/Wild4 logic and special cards ---
            if (card.type === 'wild' || card.type === 'wild4') {
                if (!msg.chosenColor || !COLORS.includes(msg.chosenColor)) return;
                card.chosenColor = msg.chosenColor;

                if (card.type === 'wild4') {
                    // Force next player to draw 4 and skip turn
                    const nextIdx = (playerIdx + room.direction + room.players.length) % room.players.length;
                    const nextPlayerId = room.players[nextIdx].id;
                    const nextHand = room.hands[nextPlayerId];

                    for (let i = 0; i < 4; ++i) {
                        if (room.draw.length === 0) break;
                        nextHand.push(room.draw.pop());
                    }
                }
            } else {
                // Clear previous wild's chosenColor if this card doesn't match it
                if (top && (top.type === 'wild' || top.type === 'wild4') && top.chosenColor) {
                    if (card.color !== top.chosenColor) {
                        delete top.chosenColor;
                    }
                }

                // Handle special cards: skip, reverse, draw2
                let advanceBy = 1;
                if (card.type === 'skip') {
                    advanceBy = 2;
                } else if (card.type === 'reverse') {
                    room.direction *= -1;
                    if (room.players.length === 2) {
                        // In 2-player game, reverse acts like skip
                        advanceBy = 2;
                    }
                } else if (card.type === 'draw2') {
                    const nextIdx = (playerIdx + room.direction + room.players.length) % room.players.length;
                    const nextPlayerId = room.players[nextIdx].id;
                    const nextHand = room.hands[nextPlayerId];

                    for (let i = 0; i < 2; ++i) {
                        if (room.draw.length === 0) break;
                        nextHand.push(room.draw.pop());
                    }

                    advanceBy = 2; // Skip after drawing
                }

                room.currentPlayer = (playerIdx + room.direction * advanceBy + room.players.length) % room.players.length;
            }

            broadcastGameState(currentRoom);
        }

        // Handle draw_card
        if (msg.type === 'draw_card' && currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            if (!room.started) return;
            const playerIdx = room.players.findIndex(p => p.id === playerId);
            if (playerIdx !== room.currentPlayer) return; // Not your turn

            const hand = room.hands[playerId];
            const top = room.discard[room.discard.length - 1];
            let topColor = top && top.chosenColor ? top.chosenColor : (top ? top.color : null);

            // Check if player has any valid play
            let hasValid = false;
            for (const card of hand) {
                if (
                    card.type === 'wild' || card.type === 'wild4' ||
                    card.color === topColor ||
                    (card.type === 'number' && top.type === 'number' && card.value === top.value) ||
                    (card.type !== 'number' && card.type === top.type)
                ) {
                    hasValid = true;
                    break;
                }
            }
            if (hasValid) return; // Can't draw if you have a valid play

            // Draw a card
            if (room.draw.length === 0) {
                // Optionally: reshuffle discard pile into draw pile if empty
                return;
            }
            const drawn = room.draw.pop();
            hand.push(drawn);

            // If the drawn card is playable, player can play it (do not advance turn)
            let canPlay = (
                drawn.type === 'wild' || drawn.type === 'wild4' ||
                drawn.color === topColor ||
                (drawn.type === 'number' && top.type === 'number' && drawn.value === top.value) ||
                (drawn.type !== 'number' && drawn.type === top.type)
            );
            if (!canPlay) {
                // Advance to next player
                const playerCount = room.players.length;
                room.currentPlayer = (room.currentPlayer + room.direction + playerCount) % playerCount;
            }
            broadcastGameState(currentRoom);
        }

        // Handle restart_game
        if (msg.type === 'restart_game' && currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            if (!room.started) {
                room.started = false;
                room.hands = {};
                room.draw = [];
                room.discard = [];
                room.currentPlayer = null;
                room.direction = 1;

                // Reset deck and players
                let deck = shuffle(createUnoDeck());
                for (const p of room.players) {
                    room.hands[p.id] = [];
                    for (let i = 0; i < 7; ++i) {
                        room.hands[p.id].push(deck.pop());
                    }
                }
                room.draw = deck;

                // Flip first card to discard
                let firstCard;
                do {
                    firstCard = room.draw.pop();
                    if (!firstCard || firstCard.type !== 'number' || !COLORS.includes(firstCard.color)) {
                        if (firstCard) room.draw.unshift(firstCard);
                        firstCard = null;
                    }
                } while (!firstCard);
                room.discard.push(firstCard);

                room.currentPlayer = 0;
                room.direction = 1;

                broadcastGameState(currentRoom);
            }
        }

        // Handle chat messages
        if (msg.type === 'chat_message') {
            if (!currentRoom || !rooms[currentRoom]) return; // Ensure player is in a room
            const player = rooms[currentRoom].players.find(p => p.id === playerId);
            if (player && typeof msg.message === 'string' && msg.message.trim()) {
                broadcastChatMessage(currentRoom, player.name, msg.message.trim());
            }
        }

    });

    ws.on('close', function() {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].players = rooms[currentRoom].players.filter(p => p.id !== playerId);
            // If host left, assign new host
            if (rooms[currentRoom].players.length > 0 && !rooms[currentRoom].players.some(p => p.isHost)) {
                rooms[currentRoom].players[0].isHost = true;
            }
            broadcastRoom(currentRoom);
            if (rooms[currentRoom].players.length === 0) {
                delete rooms[currentRoom];
            }
        }
    });
});
