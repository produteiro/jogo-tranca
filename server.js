const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

// Importação da Lógica
const { 
    prepararPartida, validarJogo, separarTresVermelhos, 
    ordenarMaoServer, ordenarJogoMesa, temCanastra, calcularResultadoFinal, calcularPlacarParcial,
    verificarPossibilidadeCompra 
} = require('./servidor/logicaJogo');

const { jogarTurnoBot } = require('./servidor/bot');
const db = require('./servidor/db'); 

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true }
});

app.use(express.static(path.join(__dirname, 'public')));

let salas = {}; 

// --- FUNÇÕES AUXILIARES ---

const getContagemMaos = (sala) => {
    if (!sala || !sala.jogo) return [0, 0, 0, 0];
    return [
        sala.jogo.maoJogador1.length, sala.jogo.maoJogador2.length,
        sala.jogo.maoJogador3.length, sala.jogo.maoJogador4.length
    ];
};

const broadcastEstado = (sala) => {
    if(sala && sala.id && sala.jogo) {
        // Envia estado completo para garantir sincronia
        io.to(sala.id).emit('estadoJogo', {
            ...sala,
            placarCalculado: calcularPlacarParcial(sala),
            maosCount: getContagemMaos(sala)
        });
        
        // Atualizações pontuais para animações
        io.to(sala.id).emit('atualizarMaosCount', getContagemMaos(sala));
        io.to(sala.id).emit('atualizarPlacar', calcularPlacarParcial(sala)); 
        io.to(sala.id).emit('atualizarContadores', { monte: sala.jogo.monte.length, lixo: sala.jogo.lixo.length });
    }
};

const garantirMonteDisponivel = (sala) => {
    if (sala.jogo.monte.length > 0) return true;
    
    let novoMonte = [];
    if (sala.jogo.morto1.length > 0) {
        novoMonte = sala.jogo.morto1;
        sala.jogo.morto1 = []; 
        sala.jogo.equipePegouMorto[0] = true; 
        io.to(sala.id).emit('statusJogo', { msg: "Morto virou monte!" });
    } else if (sala.jogo.morto2.length > 0) {
        novoMonte = sala.jogo.morto2;
        sala.jogo.morto2 = [];
        sala.jogo.equipePegouMorto[1] = true;
        io.to(sala.id).emit('statusJogo', { msg: "Morto virou monte!" });
    }
    
    if (novoMonte.length > 0) {
        sala.jogo.monte = novoMonte;
        broadcastEstado(sala); 
        return true;
    }
    return false;
};

// Esta função deve ser declarada apenas UMA VEZ aqui
const higienizarMaoComTresVermelhos = (sala, idx) => {
    try {
        const idEquipe = idx % 2;
        let mao = sala.jogo[`maoJogador${idx + 1}`];
        let trocou = false;
        let loop = 0;
        
        while (loop < 10) {
            const { novaMao, tresEncontrados } = separarTresVermelhos(mao);
            if (tresEncontrados.length === 0) break;
            
            tresEncontrados.forEach(c => sala.jogo.tresVermelhos[idEquipe].push(c));
            mao = novaMao;
            
            for(let i=0; i<tresEncontrados.length; i++){
                // Se monte vazio, tenta pegar do morto
                if (sala.jogo.monte.length === 0) garantirMonteDisponivel(sala);
                
                if (sala.jogo.monte.length > 0) {
                    mao.push(sala.jogo.monte.pop());
                    trocou = true;
                    // Se zerou ao pegar, tenta repor imediatamente
                    if (sala.jogo.monte.length === 0) garantirMonteDisponivel(sala);
                }
            }
            loop++;
        }
        
        sala.jogo[`maoJogador${idx + 1}`] = mao; // Salva a mão limpa
        
        if (trocou) {
            const modo = sala.jogo.preferenciasOrdenacao?.[idx] || 'naipe';
            sala.jogo[`maoJogador${idx + 1}`] = ordenarMaoServer(mao, modo);
        }
    } catch (e) { console.error("Erro higienizar:", e); }
};

const iniciarNovaRodada = (sala) => {
    console.log(`[SALA ${sala.id}] Iniciando nova rodada...`);
    sala.jogo = prepararPartida();
    sala.vez = 0; 
    sala.estadoTurno = 'comprando';
    sala.jogo.primeiraCompra = true;
    sala.jogo.primeiraCompraJogador = 0;

    for(let i=0; i<4; i++) higienizarMaoComTresVermelhos(sala, i);

    io.to(sala.id).emit('statusJogo', { msg: "--- NOVA PARTIDA INICIADA ---" });
    broadcastEstado(sala);
    
    verificarVezBot(sala);
};

// --- AÇÕES DO JOGO ---
const gameActions = {
    comprarDoMonte: (sala, idx, socket) => {
        if (sala.vez !== idx || sala.estadoTurno !== 'comprando') return;
        
        // Verifica disponibilidade
        if (sala.jogo.monte.length === 0) {
            if (!garantirMonteDisponivel(sala)) return; 
        }
    
        const ehPrimeiraCompra = sala.jogo.primeiraCompra && sala.jogo.primeiraCompraJogador === idx;
        const carta = sala.jogo.monte.pop();
        
        // Repõe imediatamente se zerar
        if (sala.jogo.monte.length === 0) garantirMonteDisponivel(sala);
        
        sala.jogo[`maoJogador${idx + 1}`].push(carta);
        higienizarMaoComTresVermelhos(sala, idx);
        
        sala.estadoTurno = 'descartando';
        
        if (ehPrimeiraCompra) {
            sala.jogo.permitirRecompra = true;
            sala.jogo.idCartaRecompra = carta.id; // 🆕 SALVA O ID DA CARTA PARA CONFERIR DEPOIS
            io.to(sala.id).emit('statusJogo', { msg: "Primeira compra! Descarte esta mesma carta para comprar de novo." });
        }

        io.to(sala.jogadores[idx]).emit('cartaComprada', { cartaId: carta.id }); 
        broadcastEstado(sala);
    },

    comprarLixo: (sala, idx, indices, socket) => {
        if (sala.vez !== idx || sala.estadoTurno !== 'comprando') return;
        if (sala.jogo.lixo.length === 0) return;
        
        const cartaTopo = sala.jogo.lixo[sala.jogo.lixo.length - 1];
        if (cartaTopo.face === '3' && (['paus','espadas'].includes(cartaTopo.naipe))) {
            if(socket) socket.emit('erroJogo', 'Lixo trancado!');
            return;
        }

        const mao = sala.jogo[`maoJogador${idx + 1}`];
        const jogosMesa = sala.jogo.jogosNaMesa[idx%2];
        
        if (verificarPossibilidadeCompra(mao, cartaTopo, jogosMesa)) {
            const lixo = sala.jogo.lixo.splice(0);
            sala.jogo[`maoJogador${idx + 1}`] = mao.concat(lixo);
            sala.jogo.obrigacaoTopoLixo = cartaTopo.id;
            sala.jogo.idsMaoAntesDaCompra = mao.map(c => c.id);
            
            higienizarMaoComTresVermelhos(sala, idx);
            sala.estadoTurno = 'descartando';
            sala.jogo.primeiraCompra = false; // Pegou lixo, perde direito a recompra
            
            io.to(sala.id).emit('lixoLimpo'); 
            io.to(sala.id).emit('statusJogo', { msg: `Jogador ${idx+1} pegou o lixo!` });
            
            broadcastEstado(sala);
        } else {
            if(socket) socket.emit('erroJogo', 'Precisa justificar o lixo!');
        }
    },

    baixarJogo: (sala, idx, dados, socket) => {
        if (sala.vez !== idx) return; 
        const mao = sala.jogo[`maoJogador${idx + 1}`];
        const cartas = dados.indices.map(i => mao[i]);

        if (sala.jogo.obrigacaoTopoLixo) {
            if (!cartas.some(c => c.id === sala.jogo.obrigacaoTopoLixo)) {
                if(socket) socket.emit('erroJogo', "Use a carta do lixo!"); 
                return;
            }
            sala.jogo.obrigacaoTopoLixo = null; 
        }

        const idEquipe = idx % 2;
        let jogoAlvo = (dados.indexJogoMesa !== null && dados.indexJogoMesa >= 0) 
                       ? sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa] : [];
        let jogoFinal = [...jogoAlvo, ...cartas];

        if (validarJogo(jogoFinal)) {
            dados.indices.sort((a, b) => b - a).forEach(i => mao.splice(i, 1));
            jogoFinal = ordenarJogoMesa(jogoFinal);
            
            if (dados.indexJogoMesa !== null && dados.indexJogoMesa >= 0) {
                sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa] = jogoFinal;
            } else {
                sala.jogo.jogosNaMesa[idEquipe].push(jogoFinal);
            }
            
            if (mao.length === 0) {
                if (!sala.jogo.equipePegouMorto[idEquipe]) entregarMorto(sala, idx);
                else if (temCanastra(sala.jogo.jogosNaMesa[idEquipe])) encerrarPartida(sala, idEquipe);
            }
            
            broadcastEstado(sala);
        } else {
            if(socket) socket.emit('erroJogo', 'Jogo inválido.');
        }
    },

    descartarCarta: (sala, idx, indexCarta, socket) => {
        if (sala.vez !== idx) return;
        if (sala.jogo.obrigacaoTopoLixo) {
            if(socket) socket.emit('erroJogo', "Use a carta do lixo antes de descartar!"); 
            return; 
        }

        const mao = sala.jogo[`maoJogador${idx + 1}`];
        if (!mao || !mao[indexCarta]) return;

        const carta = mao.splice(indexCarta, 1)[0];
        sala.jogo.lixo.push(carta);
        
        // 🆕 LÓGICA RIGOROSA DE RECOMPRA
        if (sala.jogo.permitirRecompra) {
            // Só permite jogar de novo se a carta descartada for IDÊNTICA à comprada
            if (carta.id === sala.jogo.idCartaRecompra) {
                sala.jogo.permitirRecompra = false;
                sala.jogo.primeiraCompra = false;
                sala.estadoTurno = 'comprando';
                
                io.to(sala.id).emit('statusJogo', { msg: "Descartou a carta certa! Compre novamente." });
                broadcastEstado(sala);
                // Não passa a vez, retorna aqui
                return;
            } else {
                // Se descartou outra carta, perdeu a chance. O jogo segue normal.
                sala.jogo.permitirRecompra = false;
                sala.jogo.primeiraCompra = false;
                io.to(sala.id).emit('statusJogo', { msg: "Não descartou a carta comprada. Passou a vez." });
            }
        }

        // Verifica Batida
        if (mao.length === 0) {
            const idEq = idx % 2;
            if (!sala.jogo.equipePegouMorto[idEq]) {
                entregarMorto(sala, idx);
            } else {
                if (temCanastra(sala.jogo.jogosNaMesa[idEq])) {
                    encerrarPartida(sala, idEq);
                    return; // 🆕 IMPORTANTE: Para a execução aqui se o jogo acabou
                } else {
                    mao.push(carta); 
                    sala.jogo.lixo.pop();
                    if(socket) socket.emit('erroJogo', 'Precisa de canastra para bater!');
                    broadcastEstado(sala);
                    return;
                }
            }
        }

        sala.vez = (sala.vez + 1) % 4;
        sala.estadoTurno = 'comprando';
        
        broadcastEstado(sala);
        verificarVezBot(sala);
    }
};

function entregarMorto(sala, idx) {
    const idEq = idx % 2; 
    const chave = idEq === 0 ? 'morto1' : 'morto2';
    sala.jogo.equipePegouMorto[idEq] = true;
    const cartas = sala.jogo[chave].splice(0, 11);
    sala.jogo[`maoJogador${idx + 1}`] = cartas;
    higienizarMaoComTresVermelhos(sala, idx);
    io.to(sala.id).emit('statusJogo', { msg: `Jogador ${idx + 1} pegou o morto!` });
    broadcastEstado(sala);
}

function encerrarPartida(sala, idEquipeBateu) {
    const res = calcularResultadoFinal(sala, idEquipeBateu);
    io.to(sala.id).emit('fimDeJogo', res);
    sala.jogo = null;
    sala.vez = 0;
}

function verificarVezBot(sala) {
    if(!sala.jogo) return;
    const id = sala.jogadores[sala.vez];
    if (id && id.startsWith('BOT')) {
        setTimeout(() => {
            if(sala.jogo) jogarTurnoBot(sala, sala.vez, gameActions);
        }, 1000);
    }
}

io.on('connection', (socket) => {
    const totalJogadores = io.engine.clientsCount;
    console.log(`[CONEXÃO] Jogador entrou. Total Online: ${totalJogadores}`);
    
    socket.on('loginAnonimo', n => {
        socket.usuarioLogado = { email: `anon_${socket.id}`, nome: n, anonimo: true };
        socket.emit('loginSucesso', socket.usuarioLogado);
    });

    socket.on('enviarChat', (msg) => {
        const nome = socket.usuarioLogado ? socket.usuarioLogado.nome : `Jogador ${socket.id.substr(0,4)}`;
        if (socket.salaAtual) {
            io.to(socket.salaAtual).emit('receberChat', { nome: nome, msg: msg });
        }
    });

    socket.on('entrarSala', idSolicitado => {
        // CORREÇÃO: Se for treino, cria uma sala ÚNICA para este jogador
        // Se não for treino (futuro multiplayer), usa o ID solicitado
        const idSala = (idSolicitado === 'treino') ? `treino-${socket.id}` : idSolicitado;
        
        socket.join(idSala); 
        socket.salaAtual = idSala;
        
        // Cria a sala se não existir
        if (!salas[idSala]) {
            salas[idSala] = { 
                id: idSala, 
                jogadores: [null,null,null,null], 
                donos: [null,null,null,null], 
                usuarios: [null,null,null,null], 
                jogo: null, 
                vez: 0 
            };
        }
        
        const s = salas[idSala];
        let slot = s.donos.indexOf(null);
        
        // Reconexão: Se já sou dono, volto pro meu lugar
        if (s.donos.includes(socket.id)) slot = s.donos.indexOf(socket.id);
        
        if(slot !== -1) { 
            s.donos[slot] = socket.id; 
            s.jogadores[slot] = socket.id;
            s.usuarios[slot] = socket.usuarioLogado;
        }
        
        // Se for treino (qualquer sala que comece com 'treino-'), preenche com Bots
        if(idSala.startsWith('treino-')) { 
            for(let i=0; i<4; i++) {
                if(!s.donos[i]) { 
                    s.donos[i] = `BOT-${i}`; 
                    s.jogadores[i] = `BOT-${i}`; 
                }
            }
        }
        
        // Inicia o jogo se estiver cheio
        if(s.donos.every(d => d !== null) && !s.jogo) {
            iniciarNovaRodada(s);
        } else if (s.jogo) {
            socket.emit('estadoJogo', s); // Envia estado atual se reconectar
        }
    });

    socket.on('jogada', (dados) => {
        const s = salas[socket.salaAtual];
        if (!s || !s.jogo) return;
        const meuIndex = s.jogadores.indexOf(socket.id);
        
        if (dados.acao === 'comprarMonte') gameActions.comprarDoMonte(s, meuIndex, socket);
        else if (dados.acao === 'comprarLixo') gameActions.comprarLixo(s, meuIndex, null, socket);
        else if (dados.acao === 'baixarJogo') gameActions.baixarJogo(s, meuIndex, dados.dados, socket);
        else if (dados.acao === 'descartar') gameActions.descartarCarta(s, meuIndex, dados.dados.index, socket);
        else if (dados.acao === 'ordenar') {
             const modo = s.jogo.preferenciasOrdenacao && s.jogo.preferenciasOrdenacao[meuIndex] === 'naipe' ? 'valor' : 'naipe';
             if(!s.jogo.preferenciasOrdenacao) s.jogo.preferenciasOrdenacao = {};
             s.jogo.preferenciasOrdenacao[meuIndex] = modo;
             s.jogo[`maoJogador${meuIndex + 1}`] = ordenarMaoServer(s.jogo[`maoJogador${meuIndex + 1}`], modo);
             broadcastEstado(s);
        }
    });

    socket.on('resetJogo', () => {
        const s = salas[socket.salaAtual];
        if(s) {
            console.log("Reset solicitado.");
            s.jogo = null; 
            iniciarNovaRodada(s); 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Rodando na porta ${PORT}`));


