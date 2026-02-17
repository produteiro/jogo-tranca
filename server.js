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
        const placar = calcularPlacarParcial(sala);
        const contagem = getContagemMaos(sala);

        // CORREÇÃO: Envia tudo dentro do objeto 'estadoJogo' para garantir sincronia
        io.to(sala.id).emit('estadoJogo', {
            ...sala,
            placarCalculado: placar,
            maosCount: contagem
        });
        
        // Emits individuais para animações pontuais (mantido para compatibilidade)
        io.to(sala.id).emit('atualizarMaosCount', contagem);
        io.to(sala.id).emit('atualizarPlacar', { p1: placar.p1.total, p2: placar.p2.total });
        io.to(sala.id).emit('atualizarContadores', { monte: sala.jogo.monte.length, lixo: sala.jogo.lixo.length });
    }
};

const garantirMonteDisponivel = (sala) => {
    if (sala.jogo.monte.length > 0) return true;
    let novoMonte = [];
    if (sala.jogo.morto1.length > 0) {
        novoMonte = sala.jogo.morto1;
        sala.jogo.morto1 = []; 
        io.to(sala.id).emit('statusJogo', { msg: "Morto 1 virou monte!" });
    } else if (sala.jogo.morto2.length > 0) {
        novoMonte = sala.jogo.morto2;
        sala.jogo.morto2 = [];
        io.to(sala.id).emit('statusJogo', { msg: "Morto 2 virou monte!" });
    }
    if (novoMonte.length > 0) {
        sala.jogo.monte = novoMonte;
        broadcastEstado(sala); 
        return true;
    }
    return false;
};

const higienizarMaoComTresVermelhos = (sala, idxJogador) => {
    try {
        const idEquipe = idxJogador % 2;
        let mao = sala.jogo[`maoJogador${idxJogador + 1}`];
        if (!mao) return; 
        
        let trocou = false;
        let loop = 0;
        
        while (loop < 10) {
            const { novaMao, tresEncontrados } = separarTresVermelhos(mao);
            if (tresEncontrados.length === 0) break;
            
            tresEncontrados.forEach(c => {
                sala.jogo.tresVermelhos[idEquipe].push(c);
            });
            
            mao = novaMao;
            
            for(let i=0; i<tresEncontrados.length; i++){
                if (sala.jogo.monte.length === 0) garantirMonteDisponivel(sala);
                if (sala.jogo.monte.length > 0) {
                    mao.push(sala.jogo.monte.pop());
                    trocou = true;
                }
            }
            loop++;
        }
        
        if (trocou) {
            sala.jogo[`maoJogador${idxJogador + 1}`] = ordenarMaoServer(mao, 'naipe');
        } else {
            sala.jogo[`maoJogador${idxJogador + 1}`] = mao;
        }
    } catch (e) { console.error("Erro higienizar:", e); }
};

const iniciarNovaRodada = (sala) => {
    console.log(`[SALA ${sala.id}] Iniciando nova rodada...`);
    sala.jogo = prepararPartida();
    
    // Aleatoriedade no início (0 a 3)
    sala.vez = Math.floor(Math.random() * 4); 
    
    sala.estadoTurno = 'comprando';
    sala.jogo.primeiraCompra = true;
    sala.jogo.primeiraCompraJogador = sala.vez;

    for(let i=0; i<4; i++) higienizarMaoComTresVermelhos(sala, i);

    io.to(sala.id).emit('statusJogo', { msg: `--- NOVA PARTIDA! O Jogador ${sala.vez + 1} começa ---` });
    broadcastEstado(sala);
    
    verificarVezBot(sala);
};

// --- AÇÕES DO JOGO ---
const gameActions = {
    comprarDoMonte: (sala, idx, socket) => {
        if (sala.vez !== idx || sala.estadoTurno !== 'comprando') return;
        
        if (sala.jogo.monte.length === 0) {
            if (!garantirMonteDisponivel(sala)) { encerrarPartida(sala, -1); return; }
        }
    
        const ehPrimeiraCompra = sala.jogo.primeiraCompra && sala.jogo.primeiraCompraJogador === idx;
        const carta = sala.jogo.monte.pop();
        
        if (sala.jogo.monte.length === 0) garantirMonteDisponivel(sala);
        
        sala.jogo[`maoJogador${idx + 1}`].push(carta);
        higienizarMaoComTresVermelhos(sala, idx);
        
        sala.estadoTurno = 'descartando';
        
        if (ehPrimeiraCompra) {
            sala.jogo.permitirRecompra = true;
            sala.jogo.idCartaRecompra = carta.id;
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
        const idEquipe = idx % 2;
        const jogosMesa = sala.jogo.jogosNaMesa[idEquipe];
        
        if (verificarPossibilidadeCompra(mao, cartaTopo, jogosMesa)) {
            const todoLixo = sala.jogo.lixo.splice(0);
            sala.jogo[`maoJogador${idx + 1}`] = mao.concat(todoLixo);
            sala.jogo.obrigacaoTopoLixo = cartaTopo.id;
            sala.jogo.idsMaoAntesDaCompra = mao.map(c => c.id);
            
            higienizarMaoComTresVermelhos(sala, idx);
            sala.estadoTurno = 'descartando';
            sala.jogo.primeiraCompra = false;
            sala.jogo.permitirRecompra = false;
            
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

        // --- CORREÇÃO OBRIGAÇÃO LIXO (DESTRAVAR DESCARTE) ---
        if (sala.jogo.obrigacaoTopoLixo) {
            const idObrigacao = sala.jogo.obrigacaoTopoLixo;
            
            // Busca a carta original na mão ou cria referência baseada no ID
            // Se a carta não estiver na mão (já foi usada?), tentamos validar pelos dados do lixo se possível, 
            // mas aqui focamos na comparação flexível (Face/Naipe).
            const cartaObrigacaoNaMao = mao.find(c => c.id === idObrigacao);
            
            // Se não achou pelo ID (ex: bug de sync), tentamos achar uma carta compatível na mão 'antes da compra' 
            // ou assumimos que o jogador tem que ter baixado uma carta igual.
            
            const cumpriu = cartas.some(c => {
                // 1. Verifica ID exato
                if (c.id === idObrigacao) return true;
                // 2. Verifica equivalência (Mesma carta, outro baralho/ID)
                if (cartaObrigacaoNaMao && c.face === cartaObrigacaoNaMao.face && c.naipe === cartaObrigacaoNaMao.naipe) return true;
                return false;
            });

            if (cumpriu) {
                sala.jogo.obrigacaoTopoLixo = null; // ✅ DESTRAVA O JOGO
            } else {
                // Se a carta da obrigação sumiu da mão (ex: bug raro), limpamos a obrigação para não travar
                if (!cartaObrigacaoNaMao) {
                     sala.jogo.obrigacaoTopoLixo = null;
                } else {
                    if(socket) socket.emit('erroJogo', "Para baixar, você DEVE usar a carta que pegou do lixo!"); 
                    return;
                }
            }
        }

        const idEquipe = idx % 2;
        let jogoAlvo = (dados.indexJogoMesa !== null && dados.indexJogoMesa >= 0) 
                       ? sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa] : [];
        let jogoFinal = [...jogoAlvo, ...cartas];

        if (validarJogo(jogoFinal)) {
            // Remove cartas da mão (ordem decrescente de índice para não quebrar array)
            dados.indices.sort((a, b) => b - a).forEach(i => mao.splice(i, 1));
            jogoFinal = ordenarJogoMesa(jogoFinal);
            
            if (dados.indexJogoMesa !== null && dados.indexJogoMesa >= 0) {
                sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa] = jogoFinal;
            } else {
                sala.jogo.jogosNaMesa[idEquipe].push(jogoFinal);
            }
            
            // Verifica fim de mão (Morto ou Batida)
            if (mao.length === 0) {
                const temMortoDisponivel = sala.jogo.morto1.length > 0 || sala.jogo.morto2.length > 0;
                if (!sala.jogo.equipePegouMorto[idEquipe] && temMortoDisponivel) entregarMorto(sala, idx);
                else if (temCanastra(sala.jogo.jogosNaMesa[idEquipe])) encerrarPartida(sala, idEquipe);
            }
            
            broadcastEstado(sala);
        } else {
            if(socket) socket.emit('erroJogo', 'Jogo inválido.');
        }
    },

    descartarCarta: (sala, idx, indexCarta, socket) => {
        if (sala.vez !== idx) return;
        if (sala.jogo.obrigacaoTopoLixo && socket) { socket.emit('erroJogo', "Use o lixo antes!"); return; }

        const mao = sala.jogo[`maoJogador${idx + 1}`];
        if (!mao || !mao[indexCarta]) return;

        const carta = mao.splice(indexCarta, 1)[0];
        sala.jogo.lixo.push(carta);
        
        // Recompra
        if (sala.jogo.permitirRecompra) {
            const ehACartaDaRecompra = (carta.id === sala.jogo.idCartaRecompra);
            sala.jogo.permitirRecompra = false;
            sala.jogo.primeiraCompra = false;

            if (ehACartaDaRecompra) {
                sala.estadoTurno = 'comprando';
                io.to(sala.id).emit('statusJogo', { msg: "Descartou a carta certa! Compre novamente." });
                broadcastEstado(sala);
                return; // NÃO passa a vez
            } else {
                io.to(sala.id).emit('statusJogo', { msg: "Descartou outra carta. Passando a vez." });
            }
        }

        if (mao.length === 0) {
            const idEq = idx % 2;
            const temMortoDisponivel = sala.jogo.morto1.length > 0 || sala.jogo.morto2.length > 0;

            if (!sala.jogo.equipePegouMorto[idEq] && temMortoDisponivel) {
                entregarMorto(sala, idx);
            } else {
                if (temCanastra(sala.jogo.jogosNaMesa[idEq])) {
                    encerrarPartida(sala, idEq);
                    return;
                } else {
                    mao.push(carta); 
                    sala.jogo.lixo.pop();
                    if(socket) socket.emit('erroJogo', 'Precisa de canastra para bater!');
                    broadcastEstado(sala);
                    return;
                }
            }
        }

        // Sentido Horário (+1)
        sala.vez = (sala.vez + 1) % 4;
        sala.estadoTurno = 'comprando';
        
        broadcastEstado(sala);
        verificarVezBot(sala);
    }
};

function entregarMorto(sala, idx) {
    const idEq = idx % 2; 
    let cartas = [];
    if (sala.jogo.morto1.length > 0) cartas = sala.jogo.morto1.splice(0, 11);
    else if (sala.jogo.morto2.length > 0) cartas = sala.jogo.morto2.splice(0, 11);
    else return;

    sala.jogo.equipePegouMorto[idEq] = true;
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
    socket.on('loginAnonimo', n => {
        socket.usuarioLogado = { email: `anon_${socket.id}`, nome: n, anonimo: true };
        socket.emit('loginSucesso', socket.usuarioLogado);
    });

    socket.on('entrarSala', idSolicitado => {
        const idSala = (idSolicitado === 'treino') ? `treino-${socket.id}` : idSolicitado;
        socket.join(idSala); 
        socket.salaAtual = idSala;
        
        if (!salas[idSala]) {
            salas[idSala] = { id: idSala, jogadores: [null,null,null,null], donos: [null,null,null,null], usuarios: [null,null,null,null], jogo: null, vez: 0 };
        }
        
        const s = salas[idSala];
        let slot = s.donos.indexOf(null);
        if (s.donos.includes(socket.id)) slot = s.donos.indexOf(socket.id);
        
        if(slot !== -1) { 
            s.donos[slot] = socket.id; 
            s.jogadores[slot] = socket.id;
            s.usuarios[slot] = socket.usuarioLogado;
        }
        
        if(idSala.startsWith('treino-')) { 
            for(let i=0; i<4; i++) if(!s.donos[i]) { s.donos[i] = `BOT-${i}`; s.jogadores[i] = `BOT-${i}`; }
        }
        
        if(s.donos.every(d => d !== null) && !s.jogo) {
            iniciarNovaRodada(s);
        } else if (s.jogo) {
            socket.emit('estadoJogo', s);
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
            s.jogo = null; 
            iniciarNovaRodada(s); 
        }
    });
    
    socket.on('enviarChat', (msg) => {
        const nome = socket.usuarioLogado ? socket.usuarioLogado.nome : `Jogador ${socket.id.substr(0,4)}`;
        io.to(socket.salaAtual).emit('receberChat', { nome: nome, msg: msg });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Rodando na porta ${PORT}`));


