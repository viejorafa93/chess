document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const colorSelection = document.getElementById('color-selection');
    const whiteButton = document.getElementById('white-button');
    const blackButton = document.getElementById('black-button');
    const mainContainer = document.getElementById('main-container');
    const chatLog = document.getElementById('chat-log');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const moveHistory = document.getElementById('move-history');

    // Configuración de la API de OpenRouter
    const OPENROUTER_API_KEY = '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';
    const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
    const SITE_URL = window.location.origin;
    const SITE_NAME = 'Asistente de Ajedrez';

    // Game state
    let playerColor = '';
    let turnCounter = 1;
    let game = new Chess(); // Instancia de chess.js
    let board = null; // Instancia de chessboard.js
    let gameHistory = []; // Historial de la partida para contexto
    let suggestedMove = null; // Almacena el movimiento sugerido por la IA

    // Emojis para las piezas de ajedrez
    const pieceEmojis = {
        'p': '♟️', // peón
        'r': '♜', // torre
        'n': '♞', // caballo
        'b': '♝', // alfil
        'q': '♛', // dama
        'k': '♚', // rey
    };

    // Sistema de caché para respuestas de la API
    const responseCache = {
        cache: new Map(),
        maxSize: 50,
        
        get(key) {
            return this.cache.get(key);
        },
        
        set(key, value) {
            if (this.cache.size >= this.cache.maxSize) {
                // Eliminar la entrada más antigua
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            this.cache.set(key, value);
        }
    };

    // Función para actualizar el indicador de turno
    function updateTurnIndicator() {
        const turnIndicator = document.querySelector('.turn-indicator');
        const currentTurn = game.turn();
        const isWhiteTurn = currentTurn === 'w';
        
        // Actualizar clases
        turnIndicator.classList.remove('white-turn', 'black-turn');
        turnIndicator.classList.add(isWhiteTurn ? 'white-turn' : 'black-turn');
        
        // Actualizar emoji y texto
        const pieceEmoji = document.querySelector('.piece-emoji');
        const turnText = document.querySelector('.turn-text');
        
        pieceEmoji.textContent = isWhiteTurn ? '♔' : '♚';
        turnText.textContent = `Turno de las ${isWhiteTurn ? 'Blancas' : 'Negras'}`;
    }

    // Control de frecuencia de solicitudes
    const rateLimiter = {
        lastCallTime: 0,
        minInterval: 3000, // 3 segundos entre llamadas
        
        canMakeCall() {
            const now = Date.now();
            if (now - this.lastCallTime >= this.minInterval) {
                this.lastCallTime = now;
                return true;
            }
            return false;
        },
        
        getTimeRemaining() {
            const now = Date.now();
            const timeElapsed = now - this.lastCallTime;
            return Math.max(0, this.minInterval - timeElapsed);
        }
    };
    // Actualiza el prompt para respuestas más personalizadas
const analysisPrompt = `Eres un asistente de ajedrez personal que ayuda a UN SOLO jugador.
Si el mensaje menciona "Mi oponente ha jugado", analiza el movimiento del oponente y aconseja al jugador cómo responder.
Si el mensaje menciona "He movido", evalúa el movimiento del jugador y sugiere el siguiente plan.

Responde siempre en este formato:
Para movimientos del oponente:
"Tu oponente ha [evaluación del movimiento]. Te sugiero jugar [movimiento] porque [explicación estratégica]. [Nombre de la apertura si aplica]."

Para movimientos del jugador:
"Buena jugada. Considera jugar [movimiento] porque [explicación estratégica]. [Nombre de la apertura si aplica]."

Mantén las respuestas cortas y directas, usando lenguaje simple.`;

// Actualiza la configuración de la API
const apiConfig = {
    temperature: 0.7,
    max_tokens: 200,
    model: 'anthropic/claude-3-haiku',
    messages: [
        {
            role: "system",
            content: analysisPrompt
        }
    ]
};

// Función para procesar texto y resaltar coordenadas
function processChessText(text) {
    // Mapa de traducción de piezas en español a inglés
    const piezasEspanol = {
        'C': 'N', // Caballo -> Knight
        'A': 'B', // Alfil -> Bishop
        'T': 'R', // Torre -> Rook
        'D': 'Q', // Dama -> Queen
        'R': 'K'  // Rey -> King
    };
    
    // Primero traducir las piezas de español a inglés
    text = text.replace(/[CATDR][a-h][1-8]/g, match => {
        const pieza = match[0];
        const resto = match.slice(1);
        return (piezasEspanol[pieza] || pieza) + resto;
    });
    
    // Patrón mejorado que detecta:
    // 1. Movimientos completos (e2e4)
    // 2. Notación algebraica con piezas (Nf3, Bc4)
    // 3. Coordenadas simples (e4)
    const pattern = /(?<![a-zA-Z])([a-h][1-8][a-h][1-8])(?![a-zA-Z])|(?<![a-zA-Z])([KQRBNP][a-h][1-8])(?![a-zA-Z])|(?<![a-zA-Z])([a-h][1-8])(?![a-zA-Z])/g;
    
    return text.replace(pattern, (match, fullMove, algebraic, single) => {
        if (fullMove) {
            // Para movimientos completos como e2e4
            return `<span class="move" data-move="${fullMove}">${fullMove}</span>`;
        } else if (algebraic) {
            // Para notación algebraica como Nf3
            const square = algebraic.slice(-2);
            return `<span class="move" data-move="${square}">${algebraic}</span>`;
        } else {
            // Para coordenadas simples como e4
            return `<span class="move" data-move="${single}">${single}</span>`;
        }
    });
}

// Función para agregar eventos de resaltado a los spans de movimientos
function addHighlightEvents(element) {
    const moveSpans = element.querySelectorAll('.move');
    moveSpans.forEach(span => {
        span.addEventListener('mouseover', () => {
            const moveData = span.getAttribute('data-move');
            removeHighlights();
            if (moveData.length === 4) {
                const from = moveData.substring(0, 2);
                const to = moveData.substring(2, 4);
                $(`#chess-board .square-${from}`).addClass('highlight-from-chat');
                $(`#chess-board .square-${to}`).addClass('highlight-from-chat');
            } else if (moveData.length === 2) {
                $(`#chess-board .square-${moveData}`).addClass('highlight-from-chat');
            }
        });
        
        span.addEventListener('mouseout', () => {
            removeHighlights();
        });
    });
}

    // Color selection handlers
    whiteButton.addEventListener('click', () => {
        playerColor = 'w';
        startGame();
    });

    blackButton.addEventListener('click', () => {
        playerColor = 'b';
        startGame();
    });

    function startGame() {
        colorSelection.classList.add('hidden');
        mainContainer.classList.remove('hidden');
        
        // Inicializar el tablero con chessboard.js
        const config = {
            draggable: true,
            position: 'start',
            orientation: playerColor === 'w' ? 'white' : 'black',
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
            onDragStart: onDragStart,
            onDrop: onDrop,
            onSnapEnd: onSnapEnd,
            onMouseoverSquare: onMouseoverSquare,
            onMouseoutSquare: onMouseoutSquare
        };
        
        board = Chessboard('chess-board', config);
        
        // Actualizar el indicador de turno inicial
        updateTurnIndicator();
        
        // Ajustar el tamaño del tablero cuando cambia el tamaño de la ventana
        $(window).resize(() => {
            board.resize();
        });
        
        // Mensaje inicial
        let welcomeMessage;
        if (playerColor === 'w') {
            welcomeMessage = `¡Bienvenido a la partida "Estrategia Clásica"! Has elegido jugar con las piezas blancas. Te sugiero comenzar con la Apertura Española (1.e4 e5 2.Cf3 Cc6 3.Bb5) o la Apertura Italiana (1.e4 e5 2.Cf3 Cc6 3.Bc4), ambas son excelentes opciones para desarrollar un juego posicional sólido.`;
        } else {
            welcomeMessage = `Has elegido jugar con las piezas negras. Las blancas empiezan. Puedes mover ambos colores para practicar o analizar posiciones.`;
        }
        appendMessage('Asistente', welcomeMessage);
        
        // Inicializar el historial de la partida
        gameHistory = [{
            role: "system",
            content: "Eres un maestro de ajedrez que ayuda a desarrollar el pensamiento crítico. Analiza posiciones explicando conceptos estratégicos y tácticos. No solo sugieras movimientos, sino explica el 'por qué' detrás de cada decisión. Limita tus respuestas a 3-4 oraciones. La partida acaba de comenzar con la posición inicial estándar."
        }];
    }

    // Función para verificar si un movimiento es legal
    function onDragStart(source, piece) {
        // No permitir arrastrar piezas si el juego ha terminado
        if (game.game_over()) return false;
        
        // Permitir mover ambos colores (para análisis)
        highlightPossibleMoves(source);
        return true;
    }

    // Función para resaltar movimientos posibles
    function highlightPossibleMoves(square) {
        // Limpiar resaltados anteriores
        removeHighlights();
        
        // Obtener la pieza en la casilla seleccionada
        const piece = game.get(square);
        if (!piece) return;
        
        // Obtener todos los movimientos legales desde esta casilla
        const moves = game.moves({ 
            square: square, 
            verbose: true 
        });
        
        // Resaltar casillas de destino posibles
        moves.forEach(move => {
            // Resaltar casilla de destino
            $(`#chess-board .square-${move.to}`).addClass('highlight-square');
            
            // Si es una captura, resaltar en amarillo
            if (move.captured) {
                $(`#chess-board .square-${move.to}`).addClass('highlight-yellow');
            }
        });
        
        // Resaltar piezas en peligro
        highlightThreatenedPieces();
        
        // Resaltar la sugerencia principal si existe
        if (suggestedMove) {
            highlightSuggestedMove(suggestedMove);
        }
    }

    // Función para resaltar piezas amenazadas
    function highlightThreatenedPieces() {
        const currentTurn = game.turn();
        
        // Revisar cada casilla del tablero
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = String.fromCharCode(97 + col) + (8 - row);
                const piece = game.get(square);
                
                if (piece && piece.color === currentTurn) {
                    // Verificar si la pieza está amenazada
                    if (isSquareAttacked(square, currentTurn === 'w' ? 'b' : 'w')) {
                        $(`#chess-board .square-${square}`).addClass('highlight-red');
                    }
                }
            }
        }
    }

    // Función para verificar si una casilla está amenazada
    function isSquareAttacked(square, byColor) {
        // Crear una copia del juego para no modificar el estado actual
        const tempGame = new Chess(game.fen());
        
        // Cambiar el turno para ver los movimientos del oponente
        if (tempGame.turn() !== byColor) {
            // Añadir una pieza temporal del color opuesto para cambiar el turno
            const emptySquare = findEmptySquare(tempGame);
            if (emptySquare) {
                tempGame.put({ type: 'p', color: tempGame.turn() }, emptySquare);
                tempGame.remove(emptySquare);
            }
        }
        
        // Obtener todos los movimientos legales del oponente
        const moves = tempGame.moves({ verbose: true });
        
        // Verificar si algún movimiento ataca la casilla
        return moves.some(move => move.to === square);
    }

    // Función auxiliar para encontrar una casilla vacía
    function findEmptySquare(chessInstance) {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = String.fromCharCode(97 + col) + (8 - row);
                if (!chessInstance.get(square)) {
                    return square;
                }
            }
        }
        return null;
    }

    // Función para resaltar la sugerencia principal
    function highlightSuggestedMove(move) {
        if (!move) return;
        
        // El formato esperado es "e2e4" (origen-destino)
        if (move.length === 4) {
            const from = move.substring(0, 2);
            const to = move.substring(2, 4);
            $(`#chess-board .square-${from}`).addClass('highlight-green');
            $(`#chess-board .square-${to}`).addClass('highlight-green');
        }
    }

    // Función para remover todos los resaltados
    function removeHighlights() {
        $('#chess-board .square-55d63').removeClass('highlight-square highlight-green highlight-yellow highlight-red highlight-from-chat');
    }

    // Función para manejar cuando el mouse pasa sobre una casilla
    function onMouseoverSquare(square, piece) {
        if (!piece) return;
        
        // Resaltar los movimientos posibles desde esta casilla
        const moves = game.moves({
            square: square,
            verbose: true
        });
        
        if (moves.length === 0) return;
        
        // Resaltar la casilla de origen
        $(`#chess-board .square-${square}`).addClass('highlight-square');
        
        // Resaltar las casillas de destino
        moves.forEach(move => {
            $(`#chess-board .square-${move.to}`).addClass('highlight-square');
            
            // Si es una captura, resaltar en amarillo
            if (move.captured) {
                $(`#chess-board .square-${move.to}`).addClass('highlight-yellow');
            }
        });
    }

    // Función para manejar cuando el mouse sale de una casilla
    function onMouseoutSquare(square, piece) {
        removeHighlights();
        
        // Restaurar la sugerencia principal si existe
        if (suggestedMove) {
            highlightSuggestedMove(suggestedMove);
        }
    }

    // Función para manejar cuando se suelta una pieza
    function onDrop(source, target) {
        // Limpiar resaltados
        removeHighlights();
        
        // Verificar si el movimiento es legal
        const move = game.move({
            from: source,
            to: target,
            promotion: 'q' // Siempre promover a reina por simplicidad
        });

        // Si el movimiento no es legal, regresar la pieza
        if (move === null) return 'snapback';

        // Actualizar el indicador de turno
        updateTurnIndicator();

        // Registrar el movimiento
        const moveNotation = move.san;
        const pieceType = move.piece;
        const pieceColor = move.color;
        
        // Añadir al historial con emoji
        addMoveToHistory(move);
        
        // Mostrar el movimiento en el chat
        appendMessage('Jugador', moveNotation, { piece: pieceType });
        
        // Construir mensaje para la IA basado en quién movió
        let messageForAI;
        if (pieceColor === playerColor) {
            messageForAI = `He movido ${moveNotation}. ¿Qué movimiento me sugieres hacer después y por qué?`;
        } else {
            messageForAI = `Mi oponente ha jugado ${moveNotation}. Analiza su movimiento y aconséjame cómo responder.`;
        }
        
        // Añadir el movimiento al historial para la IA
        gameHistory.push({
            role: "user",
            content: messageForAI
        });
        
        // Obtener respuesta de la IA
        showLoadingIndicator();
        getAIResponse()
            .then(response => {
                hideLoadingIndicator();
                appendMessage('Asistente', response.text);
                
                // Actualizar la sugerencia principal si existe
                suggestedMove = response.suggestedMove;
                if (suggestedMove) {
                    highlightSuggestedMove(suggestedMove);
                }
                
                // Añadir la respuesta al historial para mantener el contexto
                gameHistory.push({
                    role: "assistant",
                    content: response.text
                });
            })
            .catch(error => {
                hideLoadingIndicator();
                console.error('Error al obtener respuesta de la IA:', error);
                appendMessage('Asistente', 'Lo siento, hubo un error al analizar el movimiento. Por favor, intenta de nuevo.');
            });
        
        // Actualizar el estado del juego
        updateStatus();
    }

    // Función para actualizar la posición del tablero después de un movimiento
    function onSnapEnd() {
        board.position(game.fen());
    }

    // Función para procesar un movimiento desde la notación
    function processMove(notation, isPlayer) {
        // Verificar si el movimiento es legal
        const move = game.move(notation, { sloppy: true });
        
        if (move) {
            // Actualizar el tablero
            board.position(game.fen());
            
            // Determinar el color de la pieza movida
            const pieceColor = move.color === 'w' ? 'blancas' : 'negras';
            const isCorrectColor = (isPlayer && move.color === playerColor) || 
                                 (!isPlayer && move.color !== playerColor);
            
            if (!isCorrectColor) {
                // Si el movimiento es del color incorrecto, revertirlo
                game.undo();
                board.position(game.fen());
                appendMessage('Sistema', `Error: No puedes mover las piezas ${pieceColor} en esta área.`);
                return false;
            }

            // Obtener información de la pieza movida
            const pieceType = move.piece;
            const pieceEmoji = pieceEmojis[pieceType] || '';
            
            // Agregar el movimiento al historial
            addMoveToHistory(move);
            
            // Actualizar el estado del juego
            updateStatus();
            
            // Actualizar el indicador de turno
            updateTurnIndicator();
            
            // Limpiar los resaltados
            removeHighlights();

            // Agregar mensaje al chat según quién hizo el movimiento
            const messagePrefix = isPlayer ? 'Jugador' : 'Oponente';
            appendMessage(messagePrefix, `${pieceEmoji} ${notation}`, { piece: pieceType });
            
            return true;
        } else {
            appendMessage('Sistema', 'Movimiento inválido. Por favor, intenta de nuevo.');
            return false;
        }
    }

    // Función para actualizar el estado del juego
    function updateStatus() {
        let status = '';
        
        // Verificar si hay jaque mate
        if (game.in_checkmate()) {
            status = 'Jaque mate. ' + (game.turn() === 'w' ? 'Negras' : 'Blancas') + ' ganan.';
            appendMessage('Asistente', status);
            
            // Actualizar el contexto para la IA
            gameHistory.push({
                role: "system",
                content: `La partida ha terminado en jaque mate. ${game.turn() === 'w' ? 'Negras' : 'Blancas'} han ganado.`
            });
        }
        // Verificar si hay tablas
        else if (game.in_draw()) {
            status = 'Tablas. ';
            if (game.in_stalemate()) {
                status += 'Por ahogado.';
            } else if (game.in_threefold_repetition()) {
                status += 'Por triple repetición.';
            } else if (game.insufficient_material()) {
                status += 'Por material insuficiente.';
            } else {
                status += 'Por la regla de 50 movimientos.';
            }
            appendMessage('Asistente', status);
            
            // Actualizar el contexto para la IA
            gameHistory.push({
                role: "system",
                content: `La partida ha terminado en tablas. ${status}`
            });
        }
        // Verificar si hay jaque
        else if (game.in_check()) {
            status = '¡Jaque!';
            appendMessage('Asistente', status);
            
            // Actualizar el contexto para la IA
            gameHistory.push({
                role: "system",
                content: `El rey está en jaque. La posición actual en FEN es: ${game.fen()}`
            });
        }
    }

    // Chat functions
    const appendMessage = (sender, message, moveInfo = null) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender.toLowerCase()}`;

        if (sender.toLowerCase() === 'jugador') {
            // Estructura para mensajes del jugador
            const playerHeader = document.createElement('div');
            playerHeader.className = 'player-header';

            // Determinar el color correcto basado en el movimiento
            const moveColor = moveInfo && moveInfo.color ? moveInfo.color : (game.turn() === 'w' ? 'b' : 'w');
            const isPlayerMove = moveColor === playerColor;
            
            const pieceEmoji = document.createElement('span');
            pieceEmoji.className = 'piece-emoji';
            pieceEmoji.textContent = moveColor === 'w' ? '♔' : '♚';

            const playerText = document.createElement('span');
            playerText.className = 'player-text';
            playerText.textContent = moveColor === 'w' ? 'Blancas' : 'Negras';

            playerHeader.appendChild(pieceEmoji);
            playerHeader.appendChild(playerText);

            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';
            
            if (moveInfo && moveInfo.san) {
                // Si es un movimiento, mostrar la notación y el emoji de la pieza
                const moveSpan = document.createElement('span');
                moveSpan.className = 'move';
                const pieceSymbol = moveInfo.piece ? (pieceEmojis[moveInfo.piece] || '') : '';
                moveSpan.innerHTML = `${pieceSymbol} ${moveInfo.san}`;
                if (moveInfo.from && moveInfo.to) {
                    moveSpan.setAttribute('data-move', moveInfo.from + moveInfo.to);
                    addHighlightEvents(moveSpan);
                }
                messageContent.appendChild(moveSpan);
            } else if (message) {
                // Procesar el texto del jugador para resaltar coordenadas
                messageContent.innerHTML = processChessText(message);
                addHighlightEvents(messageContent);
            }

            messageDiv.appendChild(playerHeader);
            messageDiv.appendChild(messageContent);
        } else {
            // Para mensajes del asistente, mantener como un solo párrafo
            const p = document.createElement('p');
            p.innerHTML = message ? processChessText(message) : '';
            addHighlightEvents(p);
            messageDiv.appendChild(p);
        }

        chatLog.appendChild(messageDiv);
        chatLog.scrollTop = chatLog.scrollHeight;
    };
    
    

    function addMoveToHistory(move) {
        const historyContainer = document.getElementById('move-history');
        
        if (!historyContainer) {
            console.error('No se encontró el contenedor del historial');
            return;
        }
        
        const moveText = typeof move === 'string' ? move : move.san;
        const piece = typeof move === 'string' ? getPieceFromNotation(move) : move.piece;
        const color = game.turn() === 'w' ? 'b' : 'w'; // El color que acaba de mover
        const turnNumber = Math.ceil(game.history().length / 2);
        const pieceSymbol = pieceEmojis[piece] || '';
        
        // Obtener las coordenadas del movimiento
        let from, to;
        if (typeof move === 'object') {
            from = move.from;
            to = move.to;
        }
        
        // Si es un movimiento blanco, crear una nueva línea
        if (color === 'w') {
            const historyItem = document.createElement('div');
            historyItem.classList.add('history-item');
            
            const moveNumber = document.createElement('strong');
            moveNumber.classList.add('move-number');
            moveNumber.textContent = `${turnNumber}.`;
            
            const moveContent = document.createElement('div');
            moveContent.classList.add('move-content');
            
            const whiteMove = document.createElement('div');
            whiteMove.classList.add('white-move');
            whiteMove.innerHTML = `<span class="piece-symbol">${pieceSymbol}</span>${moveText}`;
            
            // Agregar atributos de datos para las coordenadas
            if (from && to) {
                whiteMove.setAttribute('data-from', from);
                whiteMove.setAttribute('data-to', to);
                
                // Agregar eventos de mouse
                whiteMove.addEventListener('mouseenter', () => {
                    removeHighlights();
                    $(`#chess-board .square-${from}`).addClass('highlight-from-chat');
                    $(`#chess-board .square-${to}`).addClass('highlight-from-chat');
                });
                
                whiteMove.addEventListener('mouseleave', () => {
                    removeHighlights();
                    // Restaurar la sugerencia principal si existe
                    if (suggestedMove) {
                        highlightSuggestedMove(suggestedMove);
                    }
                });
            }
            
            moveContent.appendChild(whiteMove);
            historyItem.appendChild(moveNumber);
            historyItem.appendChild(moveContent);
            historyContainer.appendChild(historyItem);
        } else {
            // Si es un movimiento negro, añadir al último elemento
            const lastItem = historyContainer.lastElementChild;
            if (lastItem) {
                const moveContent = lastItem.querySelector('.move-content');
                const blackMove = document.createElement('div');
                blackMove.classList.add('black-move');
                blackMove.innerHTML = `<span class="piece-symbol">${pieceSymbol}</span>${moveText}`;
                
                // Agregar atributos de datos para las coordenadas
                if (from && to) {
                    blackMove.setAttribute('data-from', from);
                    blackMove.setAttribute('data-to', to);
                    
                    // Agregar eventos de mouse
                    blackMove.addEventListener('mouseenter', () => {
                        removeHighlights();
                        $(`#chess-board .square-${from}`).addClass('highlight-from-chat');
                        $(`#chess-board .square-${to}`).addClass('highlight-from-chat');
                    });
                    
                    blackMove.addEventListener('mouseleave', () => {
                        removeHighlights();
                        // Restaurar la sugerencia principal si existe
                        if (suggestedMove) {
                            highlightSuggestedMove(suggestedMove);
                        }
                    });
                }
                
                moveContent.appendChild(blackMove);
            }
        }
        
        historyContainer.scrollTop = historyContainer.scrollHeight;
    }

    function getPieceFromNotation(notation) {
        const pieceMap = {
            'K': 'king',
            'Q': 'queen',
            'R': 'rook',
            'B': 'bishop',
            'N': 'knight',
            'P': 'pawn'
        };
        
        const firstChar = notation.charAt(0).toUpperCase();
        return pieceMap[firstChar] || 'pawn';
    }

    function getPieceEmoji(piece, color) {
        const emoji = pieceEmojis[piece] || '';
        return emoji;
    }

    const handleUserInput = () => {
        const message = userInput.value.trim();
        if (message) {
            appendMessage('Jugador', message);
            userInput.value = '';

            // Añadir la pregunta al historial para la IA
            gameHistory.push({
                role: "user",
                content: message
            });
            
            // Obtener respuesta de la IA
            showLoadingIndicator();
            getAIResponse()
                .then(response => {
                    hideLoadingIndicator();
                    appendMessage('Asistente', response.text);
                    
                    // Actualizar la sugerencia principal si existe
                    suggestedMove = response.suggestedMove;
                    if (suggestedMove) {
                        highlightSuggestedMove(suggestedMove);
                    }
                    
                    // Añadir la respuesta al historial para mantener el contexto
                    gameHistory.push({
                        role: "assistant",
                        content: response.text
                    });
                })
                .catch(error => {
                    hideLoadingIndicator();
                    console.error('Error al obtener respuesta de la IA:', error);
                    appendMessage('Asistente', 'Lo siento, hubo un error al procesar tu pregunta. Por favor, intenta de nuevo.');
                });
        }
    };

    // Función para mostrar indicador de carga
    function showLoadingIndicator() {
        const loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'loading-indicator';
        loadingIndicator.classList.add('loading');
        chatLog.appendChild(loadingIndicator);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    // Función para ocultar indicador de carga
    function hideLoadingIndicator() {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
    }

    // Función para extraer el movimiento sugerido del análisis
    function extractSuggestedMove(analysis) {
        // Buscar patrones como "sugiero e2e4" o "recomiendo mover de e2 a e4"
        const movePatterns = [
            /sugiero\s+([a-h][1-8][a-h][1-8])/i,
            /recomiendo\s+([a-h][1-8][a-h][1-8])/i,
            /mejor\s+movimiento\s+es\s+([a-h][1-8][a-h][1-8])/i,
            /mover\s+de\s+([a-h][1-8])\s+a\s+([a-h][1-8])/i,
            /jugar\s+([a-h][1-8][a-h][1-8])/i
        ];
        
        for (const pattern of movePatterns) {
            const match = analysis.match(pattern);
            if (match) {
                // Si el patrón incluye "de X a Y", combinar las casillas
                if (match.length === 3) {
                    return match[1] + match[2];
                }
                return match[1];
            }
        }
        
        return null;
    }

    // Función para obtener respuesta de la IA
    async function getAIResponse() {
        try {
            // Verificar si podemos hacer una llamada a la API
            if (!rateLimiter.canMakeCall()) {
                const waitTime = Math.ceil(rateLimiter.getTimeRemaining() / 1000);
                return {
                    text: `Por favor espera ${waitTime} segundos antes de hacer otra consulta. Estoy limitando las llamadas a la API para evitar errores.`,
                    suggestedMove: null
                };
            }
            
            // Preparar el contexto actual de la partida
            const currentPosition = game.fen();
            const moveHistory = game.history().join(', ');
            const possibleMoves = game.moves({ verbose: true }).map(m => `${m.from}${m.to}`).join(', ');
            
            // Obtener el último mensaje del usuario
            const lastUserMessage = gameHistory[gameHistory.length - 1];
            
            // Crear una clave para la caché
            const cacheKey = `${currentPosition}-${lastUserMessage.content}`;
            
            // Verificar si tenemos una respuesta en caché
            const cachedResponse = responseCache.get(cacheKey);
            if (cachedResponse) {
                return cachedResponse;
            }
            
            // Preparar los mensajes para la API
            const messages = [
                {
                    role: "system",
                    content: analysisPrompt
                },
                {
                    role: "user",
                    content: `Posición actual en FEN: ${currentPosition}
                             
                             Historial de movimientos: ${moveHistory}
                             
                             Movimientos posibles: ${possibleMoves}
                             
                             ${lastUserMessage.content}`
                }
            ];

            // Realizar la petición a la API de OpenRouter
            const response = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'HTTP-Referer': SITE_URL,
                    'X-Title': SITE_NAME,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'anthropic/claude-3-haiku',
                    messages: messages,
                    max_tokens: 250,
                    temperature: 0.7,
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`Error en la API: ${response.status}`);
            }

            const data = await response.json();
            
            // Extraer la respuesta del modelo
            if (data.choices && data.choices[0] && data.choices[0].message) {
                const aiText = data.choices[0].message.content;
                const suggestedMove = extractSuggestedMove(aiText);
                
                const result = {
                    text: aiText,
                    suggestedMove: suggestedMove
                };
                
                // Guardar en caché
                responseCache.set(cacheKey, result);
                
                return result;
            } else {
                throw new Error('Formato de respuesta inválido');
            }
        } catch (error) {
            console.error('Error al obtener respuesta de la IA:', error);
            
            // Si el error es por límite de frecuencia, informar al usuario
            if (error.message.includes('rate limit') || error.message.includes('429')) {
                return {
                    text: 'Por favor espera unos segundos antes de hacer otra consulta. Estamos limitando las llamadas a la API para evitar errores.',
                    suggestedMove: null
                };
            }
            
            // Si el error es por problemas de conexión, usar respuesta simulada
            const simulatedResponse = {
                text: 'Lo siento, hay problemas de conexión con el asistente. Aquí tienes un análisis básico de la posición actual:\n\n' +
                      'AMENAZAS: Verifica las piezas que están bajo ataque.\n' +
                      'TÁCTICAS: Busca oportunidades de ganar material o mejorar la posición de tus piezas.\n' +
                      'PLAN: Desarrolla tus piezas y controla el centro del tablero.',
                suggestedMove: null
            };
            
            // Intentar obtener un movimiento legal aleatorio como sugerencia
            try {
                const legalMoves = game.moves({ verbose: true });
                if (legalMoves.length > 0) {
                    const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
                    simulatedResponse.suggestedMove = randomMove.from + randomMove.to;
                }
            } catch (e) {
                console.error('Error al generar movimiento sugerido:', e);
            }
            
            return simulatedResponse;
        }
    }

    // Event listeners
    sendButton.addEventListener('click', handleUserInput);
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleUserInput();
        }
    });

    function highlightSquareFromText(text) {
        // Buscar coordenadas en el formato de ajedrez (ejemplo: e2e4 o e2)
        const coordPattern = /([a-h][1-8])([a-h][1-8])?/g;
        const matches = text.match(coordPattern);
        
        if (matches) {
            matches.forEach(coord => {
                if (coord.length === 4) {
                    // Si es un movimiento completo (e2e4)
                    const from = coord.substring(0, 2);
                    const to = coord.substring(2, 4);
                    $(`#chess-board .square-${from}`).addClass('highlight-from-chat');
                    $(`#chess-board .square-${to}`).addClass('highlight-from-chat');
                } else {
                    // Si es una sola coordenada (e4)
                    $(`#chess-board .square-${coord}`).addClass('highlight-from-chat');
                }
            });
        }
    }

    // Función global para resaltar casillas
    window.highlightSquare = function(from, to = null) {
        removeHighlights();
        $(`#chess-board .square-${from}`).addClass('highlight-from-chat');
        if (to) {
            $(`#chess-board .square-${to}`).addClass('highlight-from-chat');
        }
    };
});

