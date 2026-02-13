const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

// Importação da Lógica de Jogo
const { 
    prepararPartida, validarJogo, verificarSeEncaixa, separarTresVermelhos, ehTresVermelho, 
    ordenarMaoServer, ordenarJogoMesa, temCanastra, calcularResultadoFinal, calcularPlacarParcial,
    verificarPossibilidadeCompra 
} = require('./servidor/logicaJogo');

const { jogarTurnoBot } = require('./servidor/bot');
const db = require('./servidor/db'); 

const app = express();
const server = http.createServer(app);

// Configuração do Socket.io
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

let salas = {}; 

// --- FUNÇÕES AUXILIARES ---
const traduzirCarta = (c) => {
    if (!c) return 'Carta';
    const faces = { 'A': 'Ás', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', 'J': 'Valete', 'Q': 'Dama', 'K': 'Rei' };
    const naipes = { 'copas': 'Copas', 'ouros': 'Ouros', 'paus': 'Paus', 'espadas': 'Espadas' };
    return `${faces[c.face] || c.face} de ${naipes[c.naipe] || c.naipe}`;
};

const getContagemMaos = (sala) => {
    if (!sala || !sala.jogo) return [0, 0, 0, 0];
    return [
        sala.jogo.maoJogador1.length, sala.jogo.maoJogador2.length,
        sala.jogo.maoJogador3.length, sala.jogo.maoJogador4.length
    ];
};

const broadcastEstado = (sala) => {
    if(sala && sala.id && sala.jogo) {
        io.to(sala.id).emit('atualizarMaosCount', getContagemMaos(sala));
        io.to(sala.id).emit('atualizarMortos', {
            morto1: sala.jogo.morto1.length > 0,
            morto2: sala.jogo.morto2.length > 0
        });
        const placar = calcularPlacarParcial(sala);
        io.to(sala.id).emit('atualizarPlacar', { 
            p1: placar.p1.total, 
            p2: placar.p2.total 
        });
        io.to(sala.id).emit('atualizarContadores', {
            monte: sala.jogo.monte.length,
            lixo: sala.jogo.lixo.length
        });
    }
};

const garantirMonteDisponivel = (sala) => {
    if (sala.jogo.monte.length > 0) return true;
    let novoMonte = [];
    if (sala.jogo.morto1.length > 0) {
        novoMonte = sala.jogo.morto1;
        sala.jogo.morto1 = []; 
        sala.jogo.equipePegouMorto[0] = true; 
        io.to(sala.id).emit('vocePegouMorto'); 
    } else if (sala.jogo.morto2.length > 0) {
        novoMonte = sala.jogo.morto2;
        sala.jogo.morto2 = [];
        sala.jogo.equipePegouMorto[1] = true;
    }
    if (novoMonte.length > 0) {
        sala.jogo.monte = novoMonte;
        io.to(sala.id).emit('statusJogo', { msg: "Monte acabou! Morto virou novo monte." });
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
        let limpezaNecessaria = true;
        let loopSeguranca = 0; 
        while (limpezaNecessaria && loopSeguranca < 50) {
            loopSeguranca++;
            const { novaMao, tresEncontrados } = separarTresVermelhos(mao);
            if (tresEncontrados.length === 0) {
                limpezaNecessaria = false;
            } else {
                tresEncontrados.forEach(c => {
                    sala.jogo.tresVermelhos[idEquipe].push(c);
                    io.to(sala.id).emit('tresVermelhoRevelado', { idJogador: idxJogador, carta: c });
                });
                mao = novaMao;
                sala.jogo[`maoJogador${idxJogador + 1}`] = mao;
                for (let i = 0; i < tresEncontrados.length; i++) {
                    if (garantirMonteDisponivel(sala)) {
                        const nova = sala.jogo.monte.pop();
                        if (nova) mao.push(nova);
                        else { limpezaNecessaria = false; break; }
                    } else {
                        limpezaNecessaria = false;
                        io.to(sala.id).emit('statusJogo', { msg: "Sem cartas para repor o 3 Vermelho!" });
                        break;
                    }
                }
            }
        }
        sala.jogo[`maoJogador${idxJogador + 1}`] = mao;
        const modo = (sala.jogo.preferenciasOrdenacao && sala.jogo.preferenciasOrdenacao[idxJogador]) || 'naipe';
        sala.jogo[`maoJogador${idxJogador + 1}`] = ordenarMaoServer(sala.jogo[`maoJogador${idxJogador + 1}`], modo);
    } catch (e) { console.error("Erro higienizar:", e); }
};

const iniciarNovaRodada = (sala) => {
    sala.jogo = prepararPartida();
    sala.vez = Math.floor(Math.random() * 4);
    sala.estadoTurno = 'comprando';
    
    // 🆕 Define primeiro jogador para primeira compra dupla
    sala.jogo.primeiraCompraJogador = sala.vez;

    // 🆕 NÃO troca 3 vermelhos aqui - troca na vez de cada um
    const topoMonte = sala.jogo.monte.length > 0 ? { origem: sala.jogo.monte[sala.jogo.monte.length-1].origem } : null;

    sala.jogadores.forEach((sid, i) => {
        if (sid && !sid.startsWith('BOT')) {
            const s = io.sockets.sockets.get(sid);
            if(s) {
                s.emit('inicioPartida', { 
                    mao: sala.jogo[`maoJogador${i+1}`], 
                    idNoJogo: i, 
                    vezInicial: sala.vez,
                    tresVermelhos: sala.jogo.tresVermelhos,
                    maosCount: getContagemMaos(sala),
                    topoMonte: topoMonte,
                    qtdMonte: sala.jogo.monte.length
                });
            }
        }
    });

    setTimeout(() => {
        broadcastEstado(sala);
        io.to(sala.id).emit('statusJogo', { msg: "--- NOVA PARTIDA INICIADA ---" });
        io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno });
        verificarVezBot(sala);
    }, 1000);
};

const efetivarCompra = (sala, idx, carta, socket) => {
    sala.jogo[`maoJogador${idx + 1}`].push(carta);
    sala.jogo.cartaDaVez = carta; 
    higienizarMaoComTresVermelhos(sala, idx);
    const maoFinal = sala.jogo[`maoJogador${idx + 1}`];
    sala.estadoTurno = 'descartando';
    const socketId = sala.jogadores[idx];
    if(socketId && !socketId.startsWith('BOT')) {
        io.to(socketId).emit('cartaComprada', { mao: maoFinal, cartaNova: null }); 
    }
    broadcastEstado(sala);
    io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno });
};

// --- AÇÕES DO JOGO ---
const gameActions = {
    comprarDoMonte: (sala, idx, socket) => {
        if (sala.vez !== idx || sala.estadoTurno !== 'comprando') return;
        if (!garantirMonteDisponivel(sala)) { encerrarPartida(sala, -1); return; }
    
        // 🆕 Verifica se é primeira compra
        const ehPrimeiraCompra = sala.jogo.primeiraCompra && sala.jogo.primeiraCompraJogador === idx;
    
        let carta = sala.jogo.monte.pop();
        if (carta) {
            efetivarCompra(sala, idx, carta, socket);
        
            // 🆕 Se for primeira compra, permite recompra
            if (ehPrimeiraCompra) {
                sala.jogo.permitirRecompra = true;
                io.to(sala.id).emit('statusJogo', { 
                    msg: "Primeira compra! Você pode descartar e comprar novamente." 
            });
        }
    }
},

    comprarLixo: (sala, idx, indices, socket) => {
        if (sala.vez !== idx || sala.estadoTurno !== 'comprando') return;
        if (sala.jogo.lixo.length === 0) return;
        
        const cartaTopo = sala.jogo.lixo[sala.jogo.lixo.length - 1];
        if (cartaTopo.face === '3' && (cartaTopo.naipe === 'paus' || cartaTopo.naipe === 'espadas')) {
            if(socket) socket.emit('erroJogo', 'Lixo trancado por 3 Preto!');
            return;
        }

        const mao = sala.jogo[`maoJogador${idx + 1}`];
        const idEquipe = idx % 2;
        const jogosMesa = sala.jogo.jogosNaMesa[idEquipe];
        
        if (verificarPossibilidadeCompra(mao, cartaTopo, jogosMesa)) {
            sala.jogo.idsMaoAntesDaCompra = mao.map(c => c.id);
            const todoLixo = sala.jogo.lixo.splice(0);
            sala.jogo[`maoJogador${idx + 1}`] = mao.concat(todoLixo);
            sala.jogo.obrigacaoTopoLixo = cartaTopo.id;
            higienizarMaoComTresVermelhos(sala, idx);
            sala.estadoTurno = 'descartando';
            
            // LIMPA O LIXO VISUALMENTE
            io.to(sala.id).emit('lixoLimpo'); 

            if(socket) socket.emit('cartaComprada', { mao: sala.jogo[`maoJogador${idx + 1}`], cartaNova: cartaTopo });
            io.to(sala.id).emit('receberChat', { idJogador: -1, msg: `Jogador ${idx + 1} pegou o lixo!`, sistema: true });
            
            broadcastEstado(sala);
            io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno });
        } else {
            if(socket) socket.emit('erroJogo', 'Você precisa justificar o lixo (2 cartas iguais ou jogo na mesa)!');
        }
    },

    baixarJogo: (sala, idx, dados, socket) => {
        try {
            if (sala.vez !== idx) return; 
            const mao = sala.jogo[`maoJogador${idx + 1}`];
            const novasCartas = dados.indices.map(i => mao[i]);

            // Validação de Lixo
            if (sala.jogo.obrigacaoTopoLixo) {
                const usouTopo = novasCartas.some(c => c.id === sala.jogo.obrigacaoTopoLixo);
                if (!usouTopo) { if(socket) socket.emit('erroJogo', "Você deve usar a carta do topo do lixo agora!"); return; }
                if (sala.jogo.idsMaoAntesDaCompra) {
                    const cartasAuxiliares = novasCartas.filter(c => c.id !== sala.jogo.obrigacaoTopoLixo);
                    const todasOriginais = cartasAuxiliares.every(c => sala.jogo.idsMaoAntesDaCompra.includes(c.id));
                    if (!todasOriginais) { if(socket) socket.emit('erroJogo', "Justificativa do lixo inválida: use cartas da sua mão original!"); return; }
                }
                sala.jogo.obrigacaoTopoLixo = null;
                sala.jogo.idsMaoAntesDaCompra = null;
            }

            const qtdRestante = mao.length - dados.indices.length;
            if (qtdRestante <= 1) {
                const idEq = idx % 2;
                if (sala.jogo.equipePegouMorto[idEq] && !temCanastra(sala.jogo.jogosNaMesa[idEq])) {
                    if(socket) socket.emit('erroJogo', "Você não pode bater sem ter canastra!");
                    return;
                }
            }

            const idEquipe = idx % 2;
            let jogoAlvo = (dados.indexJogoMesa !== null && dados.indexJogoMesa >= 0) 
                           ? sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa] 
                           : [];
            
            let jogoFinal = [...jogoAlvo, ...novasCartas];

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
                
                if(socket) socket.emit('maoAtualizada', { mao: sala.jogo[`maoJogador${idx + 1}`] });
                // Envia o índice para o frontend saber onde atualizar
                io.to(sala.id).emit('mesaAtualizada', { 
                    idJogador: idx, 
                    cartas: jogoFinal, 
                    index: dados.indexJogoMesa 
                });
                
                broadcastEstado(sala);
            } else {
                if(socket) socket.emit('erroJogo', 'Jogada inválida! Verifique se a sequência ou trinca está correta.');
            }
        } catch(e) { console.error("Erro ao baixar jogo:", e); }
    },

descartarCarta: (sala, idx, indexCarta, socket) => {
    if (sala.vez !== idx || sala.jogo.obrigacaoTopoLixo) {
        if(socket && sala.jogo.obrigacaoTopoLixo) socket.emit('erroJogo', "Use a carta do lixo antes de descartar!");
        return;
    }
    const mao = sala.jogo[`maoJogador${idx + 1}`];
    if(!mao[indexCarta]) return;

    const carta = mao.splice(indexCarta, 1)[0];
    sala.jogo.lixo.push(carta);
    
    // 🆕 VERIFICA SE PERMITE RECOMPRA (PRIMEIRA COMPRA)
    if (sala.jogo.permitirRecompra) {
        sala.jogo.permitirRecompra = false;
        sala.jogo.primeiraCompra = false;
        sala.estadoTurno = 'comprando'; // Volta para comprar
        
        io.to(sala.id).emit('atualizarLixo', carta);
        io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno });
        if(socket) socket.emit('maoAtualizada', { mao });
        io.to(sala.id).emit('statusJogo', { msg: "Compre novamente!" });
        broadcastEstado(sala);
        return; // 🆕 NÃO PASSA A VEZ!
    }
    
    // Resto do código normal...
    if (mao.length === 0) {
        const idEq = idx % 2;
        if (!sala.jogo.equipePegouMorto[idEq]) entregarMorto(sala, idx);
        else {
            if (temCanastra(sala.jogo.jogosNaMesa[idEq])) {
                encerrarPartida(sala, idEq);
            } else {
                mao.push(carta);
                sala.jogo.lixo.pop();
                if(socket) socket.emit('erroJogo', 'Você não pode bater sem ter canastra!');
                if(socket) socket.emit('maoAtualizada', { mao });
                return;
            }
        }
    }

    sala.vez = (sala.vez + 1) % 4;
    sala.estadoTurno = 'comprando';
    io.to(sala.id).emit('atualizarLixo', carta);
    io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno });
    if(socket) socket.emit('maoAtualizada', { mao: sala.jogo[`maoJogador${idx + 1}`] });
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
    const sid = sala.jogadores[idx];
    if (sid && !sid.startsWith('BOT')) {
        io.to(sid).emit('maoAtualizada', { mao: sala.jogo[`maoJogador${idx + 1}`] });
        // 🆕 REMOVIDO emit('vocePegouMorto') - agora só mensagem no chat
    }
    io.to(sala.id).emit('statusJogo', { msg: `Jogador ${idx + 1} pegou o morto!` });
    broadcastEstado(sala);
}

function encerrarPartida(sala, idEquipeBateu) {
    const res = calcularResultadoFinal(sala, idEquipeBateu);
    
    // 🆕 SALVA ESTATÍSTICAS NO BANCO DE DADOS
    try {
        const equipe0 = [sala.usuarios[0], sala.usuarios[2]].filter(u => u && !u.anonimo);
        const equipe1 = [sala.usuarios[1], sala.usuarios[3]].filter(u => u && !u.anonimo);
        
        const vencedores = idEquipeBateu === 0 ? equipe0 : equipe1;
        const perdedores = idEquipeBateu === 0 ? equipe1 : equipe0;
        
        if (vencedores.length > 0 || perdedores.length > 0) {
            db.registrarFimPartida({
                vencedores: vencedores.map(u => u.email),
                perdedores: perdedores.map(u => u.email),
                pontosVencedor: idEquipeBateu === 0 ? res.placar.p1 : res.placar.p2,
                pontosPerdedor: idEquipeBateu === 0 ? res.placar.p2 : res.placar.p1
            });
        }
    } catch (e) {
        console.error("Erro ao salvar estatísticas:", e);
    }
    
    io.to(sala.id).emit('fimDeJogo', res);
    delete salas[sala.id];
}

function verificarVezBot(sala) {
    // 🆕 Troca 3 vermelhos do jogador da vez ANTES de jogar
    higienizarMaoComTresVermelhos(sala, sala.vez);
    
    const id = sala.jogadores[sala.vez];
    if (id && id.startsWith('BOT')) {
        jogarTurnoBot(sala, sala.vez, gameActions);
    }
}

io.on('connection', (socket) => {
    // 🆕 CORRIGIDO: Agora o registro funciona!
    // --- MONITORAMENTO DE ACESSOS ---
    const totalJogadores = io.engine.clientsCount; // Conta quantos sockets tem conectados
    const ipJogador = socket.handshake.address; // Tenta pegar o IP
    
    console.log(`[CONEXÃO] Novo jogador entrou.`);
    console.log(`IP: ${ipJogador}`);
    console.log(`Total Online: ${totalJogadores}`);
    
    socket.on('registro', d => {
        const r = db.registrarUsuario(d.email, d.senha, d.nome);
        if(r.sucesso) socket.emit('loginSucesso', r.usuario);
        else socket.emit('erroLogin', r.erro);
    });
    
    socket.on('login', d => { 
        const r = db.loginUsuario(d.email, d.senha); 
        if(r.sucesso) socket.emit('loginSucesso', r.usuario); 
        else socket.emit('erroLogin', r.erro);
    });
    
    socket.on('loginAnonimo', n => socket.emit('loginSucesso', { email: `anon_${socket.id}`, nome: n, anonimo: true }));
    socket.on('disconnect', () => {
        console.log(`[SAÍDA] Jogador saiu. Total Online: ${io.engine.clientsCount}`);
    });
    
    // 🆕 NOVO: Endpoint para buscar ranking
    socket.on('buscarRanking', () => {
        const ranking = db.obterRanking();
        socket.emit('rankingAtualizado', ranking);
    });
    
socket.on('entrarSala', id => {
    socket.join(id); 
    socket.salaAtual = id;
    
    if (!salas[id]) {
        salas[id] = { 
            id, 
            jogadores: [null, null, null, null], 
            donos: [null, null, null, null], 
            usuarios: [null, null, null, null], 
            jogo: null, 
            vez: 0 
        };
    }
    
    const s = salas[id];
    let slot = s.donos.indexOf(null);
    
    if(slot !== -1) { 
        s.donos[slot] = socket.id; 
        s.jogadores[slot] = socket.id;
        const usuarioAtual = socket.usuarioLogado || null;
        s.usuarios[slot] = usuarioAtual;
    }
    
    if(id === 'treino') { 
        for(let i=0; i<4; i++) {
            if(!s.donos[i]) { 
                s.donos[i] = `BOT-${i}`; 
                s.jogadores[i] = `BOT-${i}`; 
            }
        }
    }
    
    // 🆕 Timeout de segurança para evitar travamento
    if(s.donos.every(d => d !== null) && !s.jogo) {
        setTimeout(() => {
            if (!s.jogo) { // Verifica novamente
                console.log('Iniciando partida na sala:', id);
                iniciarNovaRodada(s);
            }
        }, 500); // Delay de 500ms
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});


