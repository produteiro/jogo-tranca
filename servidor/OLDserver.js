const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const db = require('./db');
const { 
    prepararPartida, validarJogo, verificarSeEncaixa, separarTresVermelhos, ehTresVermelho, 
    somarCartas, ordenarMaoServer, ordenarJogoMesa, temCanastra, calcularResultadoFinal, calcularPlacarParcial,
    verificarPossibilidadeCompra 
} = require('./logicaJogo');
const { jogarTurnoBot } = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('../public')); 
let salas = {}; 

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
    } else if (sala.jogo.morto2.length > 0) {
        novoMonte = sala.jogo.morto2;
        sala.jogo.morto2 = [];
        sala.jogo.equipePegouMorto[1] = true;
    }
    if (novoMonte.length > 0) {
        sala.jogo.monte = novoMonte;
        io.to(sala.id).emit('statusJogo', { msg: "Monte acabou! Morto virou o novo Monte." });
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
    console.log(`Iniciando rodada Sala ${sala.id}`);
    sala.jogo = prepararPartida();
    sala.vez = Math.floor(Math.random() * 4);
    sala.estadoTurno = 'comprando';

    for (let i = 0; i < 4; i++) { higienizarMaoComTresVermelhos(sala, i); }

    const topoMonte = sala.jogo.monte.length > 0 ? { origem: sala.jogo.monte[sala.jogo.monte.length-1].origem } : null;

    sala.jogadores.forEach((sid, i) => {
        if (!sid.startsWith('BOT')) {
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
        io.to(sala.id).emit('statusJogo', { msg: `Sorteio: Jogador ${sala.vez + 1} começa!` });
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
    
    if(!socketId.startsWith('BOT')) {
        io.to(socketId).emit('cartaComprada', { mao: maoFinal, cartaNova: null }); 
    } else {
        io.to(sala.id).emit('animacaoJogada', { acao: 'compra_monte', idJogador: idx });
    }
    
    if(!socketId.startsWith('BOT')) {
         socket.broadcast.to(sala.id).emit('animacaoJogada', { acao: 'compra_monte', idJogador: idx });
    }
    
    io.to(sala.id).emit('statusJogo', { msg: `Jogador ${idx + 1} comprou do monte.` });
    broadcastEstado(sala);
    io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno });
};

const gameActions = {
    comprarDoMonte: (sala, idx, socket) => {
        try {
            if (sala.vez !== idx) return; 
            if (!sala.jogo || sala.estadoTurno !== 'comprando') return;
            
            if (!garantirMonteDisponivel(sala)) {
                io.to(sala.id).emit('statusJogo', { msg: "FIM DE JOGO - ACABARAM AS CARTAS" });
                encerrarPartida(sala, -1);
                return; 
            }
            
            let carta = sala.jogo.monte.pop();
            if (!carta) return;

            if (sala.jogo.primeiraJogada === true) {
                const socketId = sala.jogadores[idx];
                if (socketId.startsWith('BOT')) {
                    sala.jogo.primeiraJogada = false;
                }
                efetivarCompra(sala, idx, carta, socket);
                return; 
            }
            efetivarCompra(sala, idx, carta, socket);
        } catch(e) { console.error("Erro comprarDoMonte:", e); }
    },

    responderPrimeiraCarta: (sala, idx, aceitou, socket) => {},

    comprarLixo: (sala, idx, indices, socket) => {
        try {
            if (sala.vez !== idx) return; 
            if (!sala || !sala.jogo || sala.jogo.lixo.length === 0) return;
            if (sala.estadoTurno !== 'comprando') return;
            if (sala.jogo.primeiraJogada && sala.jogo.primeiraJogadaEstado === 'reject') return; 

            const cartaTopo = sala.jogo.lixo[sala.jogo.lixo.length - 1];
            if (cartaTopo.face === '3' && (cartaTopo.naipe === 'paus' || cartaTopo.naipe === 'espadas')) {
                if(socket) socket.emit('erroJogo', 'Lixo trancado!');
                return;
            }

            const mao = sala.jogo[`maoJogador${idx + 1}`];
            const idEquipe = idx % 2;
            const jogosDaEquipe = sala.jogo.jogosNaMesa[idEquipe];

            const podeComprar = verificarPossibilidadeCompra(mao, cartaTopo, jogosDaEquipe);

            if (podeComprar) {
                const todoLixo = sala.jogo.lixo.splice(0, sala.jogo.lixo.length);
                sala.jogo[`maoJogador${idx + 1}`] = mao.concat(todoLixo);
                sala.jogo.obrigacaoTopoLixo = cartaTopo.id;

                higienizarMaoComTresVermelhos(sala, idx);
                sala.estadoTurno = 'descartando';
                
                if(sala.jogo.primeiraJogada) sala.jogo.primeiraJogada = false;

                io.to(sala.id).emit('animacaoJogada', { acao: 'compra_lixo', idJogador: idx });
                io.to(sala.id).emit('lixoLimpo', { idJogador: idx });
                
                if(socket) socket.emit('cartaComprada', { mao: sala.jogo[`maoJogador${idx + 1}`], cartaNova: cartaTopo });
                
                const textoCarta = traduzirCarta(cartaTopo);
                io.to(sala.id).emit('receberChat', { idJogador: -1, msg: `Jogador ${idx + 1} pegou o lixo! (Topo: ${textoCarta})`, sistema: true });
                
                io.to(sala.id).emit('statusJogo', { msg: `Jogador ${idx + 1} comprou o LIXO!` });
                broadcastEstado(sala);
                io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno });
            } else {
                if(socket) socket.emit('erroJogo', 'Esta carta não serve para você! Compre do monte.');
            }
        } catch(e) { console.error("Erro comprarLixo", e); }
    },

    baixarJogo: (sala, idx, dados, socket) => {
        try {
            if (sala.vez !== idx) return; 
            const mao = sala.jogo[`maoJogador${idx + 1}`];
            const novasCartas = dados.indices.map(i => mao[i]);

            if (sala.jogo.obrigacaoTopoLixo) {
                const usouTopo = novasCartas.some(c => c.id === sala.jogo.obrigacaoTopoLixo);
                if (!usouTopo) {
                    if(socket) socket.emit('erroJogo', "Você deve usar a carta do topo do lixo na sua primeira descida!");
                    return;
                }
                sala.jogo.obrigacaoTopoLixo = null;
            }

            // --- CORREÇÃO: TRAVA DE 1 CARTA ---
            // Se após baixar o jogo, o jogador ficar com 0 OU 1 carta, validamos se ele pode bater.
            // Se restar 1 carta, ele é obrigado a descartá-la para passar a vez.
            // Descartar a última carta = Bater. Se não tiver canastra/morto, não pode bater.
            // Logo, não pode ficar com 1 carta.
            
            const qtdAposBaixar = mao.length - dados.indices.length;
            
            if (qtdAposBaixar <= 1) { 
                const idEquipe = idx % 2;
                const jaPegouMorto = sala.jogo.equipePegouMorto[idEquipe];
                const mortoDisponivel = (idEquipe === 0 ? sala.jogo.morto1.length : sala.jogo.morto2.length) > 0;
                
                const indoProMorto = !jaPegouMorto && mortoDisponivel;
                
                if (!indoProMorto) {
                    let temCanastraAgora = temCanastra(sala.jogo.jogosNaMesa[idEquipe]);
                    
                    if (!temCanastraAgora) {
                        // Verifica se o jogo que está descendo agora completa a canastra
                        const qtdBaixada = dados.indices.length;
                        if (dados.indexJogoMesa !== null) {
                            const jogoAlvo = sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa];
                            if (jogoAlvo.length + qtdBaixada >= 7) temCanastraAgora = true;
                        } else {
                            if (qtdBaixada >= 7) temCanastraAgora = true;
                        }
                    }

                    if (!temCanastraAgora) {
                        const msgErro = qtdAposBaixar === 0 
                            ? "Você não pode bater sem ter Canastra!"
                            : "Você não pode ficar com apenas 1 carta sem ter Canastra (pois precisará descartá-la)!";
                        
                        if(socket) socket.emit('erroJogo', msgErro);
                        return; 
                    }
                }
            }
            // ------------------------------------

            const idEquipe = idx % 2;
            let jogoFinal = [];

            const sucessoBaixar = () => {
                dados.indices.sort((a, b) => b - a).forEach(i => mao.splice(i, 1));
                io.to(sala.id).emit('animacaoJogada', { acao: 'baixar_jogo', idJogador: idx, destinoMesa: true });
                if(sala.jogo.primeiraJogada) sala.jogo.primeiraJogada = false;

                if (mao.length === 0) {
                    const pegouMorto = sala.jogo.equipePegouMorto[idEquipe];
                    if (pegouMorto) {
                        if (temCanastra(sala.jogo.jogosNaMesa[idEquipe])) {
                            encerrarPartida(sala, idEquipe);
                            return;
                        }
                    } else {
                        entregarMorto(sala, idx);
                    }
                }
                
                if(socket) socket.emit('maoAtualizada', { mao: sala.jogo[`maoJogador${idx + 1}`] });
                broadcastEstado(sala);
            };

            if (dados.indexJogoMesa !== null) {
                jogoFinal = [...sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa], ...novasCartas];
                if (validarJogo(jogoFinal)) {
                    jogoFinal = ordenarJogoMesa(jogoFinal); 
                    sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa] = jogoFinal;
                    io.to(sala.id).emit('jogoAtualizado', { idJogador: idx, indexJogo: dados.indexJogoMesa, cartas: jogoFinal });
                    sucessoBaixar();
                } else if(socket) socket.emit('erroJogo', "Jogada inválida!");
            } else {
                if (validarJogo(novasCartas)) {
                    jogoFinal = ordenarJogoMesa(novasCartas); 
                    sala.jogo.jogosNaMesa[idEquipe].push(jogoFinal);
                    io.to(sala.id).emit('mesaAtualizada', { idJogador: idx, cartas: jogoFinal });
                    sucessoBaixar();
                } else if(socket) socket.emit('erroJogo', "Jogo inválido!");
            }
        } catch(e) { console.error("Erro baixarJogo", e); }
    },

    descartarCarta: (sala, idx, indexCarta, socket) => {
        try {
            if (sala.vez !== idx) return; 
            const mao = sala.jogo[`maoJogador${idx + 1}`];
            if (indexCarta < 0 || indexCarta >= mao.length) {
                if(socket) socket.emit('erroJogo', "Erro de índice.");
                return;
            }

            if (sala.jogo.obrigacaoTopoLixo) {
                if(socket) socket.emit('erroJogo', "Você precisa usar a carta do topo do lixo em um jogo antes de descartar!");
                else console.log(`[AVISO] Bot ${idx} tentou descartar sem cumprir obrigação do lixo.`);
                return;
            }

            const cartaParaDescarte = mao[indexCarta];
            if (ehTresVermelho(cartaParaDescarte)) {
                if(socket) socket.emit('erroJogo', "Você não pode descartar um 3 Vermelho!");
                if (!socket) { 
                     const outroIdx = mao.findIndex(c => !ehTresVermelho(c));
                     if(outroIdx !== -1) gameActions.descartarCarta(sala, idx, outroIdx, null);
                }
                return;
            }

            if (mao.length === 1) { 
                const idEquipe = idx % 2;
                const jaPegouMorto = sala.jogo.equipePegouMorto[idEquipe];
                const mortoDisponivel = (idEquipe === 0 ? sala.jogo.morto1.length : sala.jogo.morto2.length) > 0;
                const vaiProMorto = !jaPegouMorto && mortoDisponivel;
                
                if (!vaiProMorto && !temCanastra(sala.jogo.jogosNaMesa[idEquipe])) {
                    if(socket) socket.emit('erroJogo', "Você precisa de uma canastra para bater!");
                    return; 
                }
            }

            if (sala.jogo.primeiraJogada) {
                const mesmaCarta = (sala.jogo.cartaDaVez && cartaParaDescarte.face === sala.jogo.cartaDaVez.face && cartaParaDescarte.naipe === sala.jogo.cartaDaVez.naipe);
                if (mesmaCarta) {
                    const carta = mao.splice(indexCarta, 1)[0];
                    sala.jogo.lixo.push(carta);
                    const modo = (sala.jogo.preferenciasOrdenacao && sala.jogo.preferenciasOrdenacao[idx]) || 'naipe';
                    sala.jogo[`maoJogador${idx + 1}`] = ordenarMaoServer(sala.jogo[`maoJogador${idx + 1}`], modo);
                    io.to(sala.id).emit('atualizarLixo', carta);
                    io.to(sala.id).emit('animacaoJogada', { acao: 'descarte', idJogador: idx, carta: carta });
                    sala.estadoTurno = 'comprando';
                    sala.jogo.primeiraJogada = false; 
                    io.to(sala.id).emit('statusJogo', { msg: `Jogador ${idx + 1} rejeitou a carta.` });
                    io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno }); 
                    if(socket) socket.emit('maoAtualizada', { mao: sala.jogo[`maoJogador${idx + 1}`] });
                    broadcastEstado(sala);
                    return; 
                } else {
                    sala.jogo.primeiraJogada = false;
                }
            }

            const carta = mao.splice(indexCarta, 1)[0];
            sala.jogo.lixo.push(carta);
            const modo = (sala.jogo.preferenciasOrdenacao && sala.jogo.preferenciasOrdenacao[idx]) || 'naipe';
            sala.jogo[`maoJogador${idx + 1}`] = ordenarMaoServer(sala.jogo[`maoJogador${idx + 1}`], modo);

            if (mao.length === 0) {
                const idEquipe = idx % 2;
                if (!sala.jogo.equipePegouMorto[idEquipe]) {
                    entregarMorto(sala, idx); 
                } else {
                    encerrarPartida(sala, idEquipe);
                    return;
                }
            }

            sala.vez = (sala.vez + 1) % 4;
            sala.estadoTurno = 'comprando';
            io.to(sala.id).emit('atualizarLixo', carta);
            io.to(sala.id).emit('animacaoJogada', { acao: 'descarte', idJogador: idx, carta: carta });
            io.to(sala.id).emit('mudancaVez', { vez: sala.vez, estado: sala.estadoTurno });
            io.to(sala.id).emit('statusJogo', { msg: `Vez do Jogador ${sala.vez + 1}` });
            if(socket) socket.emit('maoAtualizada', { mao: sala.jogo[`maoJogador${idx + 1}`] });
            broadcastEstado(sala);
            verificarVezBot(sala);
        } catch (e) { console.error("Erro descartar", e); }
    },
    
    alternarOrdenacao: () => { 
        const s = salas[socket.salaAtual]; 
        if (!s || !s.jogo) return; 
        const idx = s.jogadores.indexOf(socket.id); 
        if (idx === -1) return;
        if (!s.jogo.preferenciasOrdenacao) s.jogo.preferenciasOrdenacao = ['naipe', 'naipe', 'naipe', 'naipe']; 
        const modoAtual = s.jogo.preferenciasOrdenacao[idx]; 
        const novoModo = (modoAtual === 'naipe') ? 'valor' : 'naipe'; 
        s.jogo.preferenciasOrdenacao[idx] = novoModo; 
        s.jogo[`maoJogador${idx + 1}`] = ordenarMaoServer(s.jogo[`maoJogador${idx + 1}`], novoModo); 
        socket.emit('maoAtualizada', { mao: s.jogo[`maoJogador${idx + 1}`], modo: novoModo }); 
    },
    reiniciarPartida: () => { const s = salas[socket.salaAtual]; if(s) iniciarNovaRodada(s); },
    enviarChat: (msg) => { const s = salas[socket.salaAtual]; if (s) { const idx = s.jogadores.indexOf(socket.id); const nome = socket.usuario ? socket.usuario.nome : `Jogador ${idx+1}`; const textoLimpo = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;"); io.to(s.id).emit('receberChat', { idJogador: idx, msg: `${nome}: ${textoLimpo}`, sistema: false }); } }
};

function entregarMorto(sala, idx) {
    const idEquipe = idx % 2; 
    const chave = idEquipe === 0 ? 'morto1' : 'morto2';
    sala.jogo.equipePegouMorto[idEquipe] = true;
    if (sala.jogo[chave].length > 0) {
        const cartas = sala.jogo[chave].splice(0, 11);
        sala.jogo[`maoJogador${idx + 1}`] = cartas;
        higienizarMaoComTresVermelhos(sala, idx);
        io.to(sala.id).emit('statusJogo', { msg: `Jogador ${idx + 1} pegou o morto!` });
        const id = sala.jogadores[idx];
        if (!id.startsWith('BOT')) {
            io.to(id).emit('maoAtualizada', { mao: sala.jogo[`maoJogador${idx + 1}`] });
            io.to(id).emit('vocePegouMorto', sala.jogo[`maoJogador${idx + 1}`]);
        }
        broadcastEstado(sala);
    } else {
        encerrarPartida(sala, idEquipe);
    }
}

function encerrarPartida(sala, idEquipeBateu) {
    const resultado = calcularResultadoFinal(sala, idEquipeBateu);
    io.to(sala.id).emit('fimDeJogo', resultado);
    const vencedores = []; const perdedores = [];
    let timeVencedor = idEquipeBateu;
    if (timeVencedor === -1) { timeVencedor = resultado.placar.p1 > resultado.placar.p2 ? 0 : 1; }
    sala.jogadores.forEach((socketId, index) => {
        if (socketId.startsWith('BOT')) return; 
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.usuario && !socket.usuario.anonimo) {
            const timeJogador = index % 2;
            if (timeJogador === timeVencedor) vencedores.push(socket.usuario.email);
            else perdedores.push(socket.usuario.email);
        }
    });
    if (vencedores.length > 0 || perdedores.length > 0) { db.registrarFimPartida({ vencedores, perdedores }); }
    delete salas[sala.id];
}

function verificarVezBot(sala) {
    if(!sala || !sala.jogadores) return;
    const id = sala.jogadores[sala.vez];
    if (id && id.startsWith('BOT')) jogarTurnoBot(sala, sala.vez, gameActions);
}

io.on('connection', (socket) => {
    socket.on('login', (dados) => {
        const res = db.loginUsuario(dados.email, dados.senha);
        if (res.sucesso) { socket.usuario = res.usuario; socket.emit('loginSucesso', res.usuario); } 
        else { socket.emit('erroLogin', res.erro); }
    });
    socket.on('registro', (dados) => {
        const res = db.registrarUsuario(dados.email, dados.senha, dados.nome);
        if (res.sucesso) { socket.usuario = res.usuario; socket.emit('loginSucesso', res.usuario); } 
        else { socket.emit('erroLogin', res.erro); }
    });
    socket.on('loginAnonimo', (nick) => {
        socket.usuario = { email: `anon_${socket.id}`, nome: nick, anonimo: true };
        socket.emit('loginSucesso', socket.usuario);
    });
    socket.on('pedirRanking', () => { socket.emit('receberRanking', db.obterRanking()); });
    socket.on('reentrarJogo', (usuario) => {
        socket.usuario = usuario; 
        let achou = false;
        for (const [idSala, sala] of Object.entries(salas)) {
            const idx = sala.donos.indexOf(usuario.email);
            if (idx !== -1) {
                achou = true;
                sala.jogadores[idx] = socket.id;
                socket.join(idSala);
                socket.salaAtual = idSala;
                const lixoTopo = sala.jogo.lixo.length > 0 ? sala.jogo.lixo[sala.jogo.lixo.length - 1] : null;
                const topoMonte = sala.jogo.monte.length > 0 ? { origem: sala.jogo.monte[sala.jogo.monte.length-1].origem } : null;
                const placar = calcularPlacarParcial(sala);
                socket.emit('reentradaSucesso');
                socket.emit('estadoAbsoluto', {
                    seuIndice: idx,
                    suaMao: sala.jogo[`maoJogador${idx + 1}`],
                    maosCount: getContagemMaos(sala),
                    mortos: { morto1: sala.jogo.morto1.length > 0, morto2: sala.jogo.morto2.length > 0 },
                    jogosNaMesa: sala.jogo.jogosNaMesa,
                    tresVermelhos: sala.jogo.tresVermelhos,
                    lixoTopo: lixoTopo,
                    topoMonte: topoMonte,
                    placar: placar, 
                    vez: sala.vez,
                    estadoTurno: sala.estadoTurno,
                    qtdMonte: sala.jogo.monte.length
                });
                return;
            }
        }
        if(!achou) socket.emit('reentradaErro');
    });
    socket.on('entrarSala', (id) => {
        if (!socket.usuario) { socket.emit('erroLogin', "Você precisa estar logado!"); return; }
        socket.join(id); socket.salaAtual = id;
        if (!salas[id]) { salas[id] = { id, jogadores: [], donos: [null, null, null, null], mapaUsuarios: {}, jogo: null, vez: 0 }; }
        const sala = salas[id];
        let slotIndex = sala.donos.indexOf(socket.usuario.email);
        if (slotIndex === -1) {
            slotIndex = sala.donos.indexOf(null);
            if (slotIndex !== -1) {
                sala.donos[slotIndex] = socket.usuario.email;
                sala.jogadores[slotIndex] = socket.id;
            } else { socket.emit('erroLogin', 'Sala cheia!'); return; }
        } else { sala.jogadores[slotIndex] = socket.id; }
        if (id === 'treino') {
            for(let i=0; i<4; i++) {
                if(sala.donos[i] === null) {
                    sala.donos[i] = `BOT-${i+1}`;
                    sala.jogadores[i] = `BOT-${i+1}`;
                }
            }
        }
        if (sala.donos.every(d => d !== null)) { if (!sala.jogo) { iniciarNovaRodada(sala); } }
    });
    socket.on('comprarCarta', () => { const s = salas[socket.salaAtual]; if (s && s.jogadores[s.vez] === socket.id) gameActions.comprarDoMonte(s, s.vez, socket); });
    socket.on('responderPrimeiraCarta', (aceitou) => { const s = salas[socket.salaAtual]; if (s && s.jogadores[s.vez] === socket.id) gameActions.responderPrimeiraCarta(s, s.vez, aceitou, socket); });
    socket.on('baixarJogo', (dados) => { const s = salas[socket.salaAtual]; if (s && s.jogadores[s.vez] === socket.id) gameActions.baixarJogo(s, s.vez, dados, socket); });
    socket.on('descartarCarta', (idx) => { const s = salas[socket.salaAtual]; if (s && s.jogadores[s.vez] === socket.id) gameActions.descartarCarta(s, s.vez, idx, socket); });
    socket.on('alternarOrdenacao', () => { 
        const s = salas[socket.salaAtual]; 
        if (!s || !s.jogo) return; 
        const idx = s.jogadores.indexOf(socket.id); 
        if (!s.jogo.preferenciasOrdenacao) s.jogo.preferenciasOrdenacao = ['naipe', 'naipe', 'naipe', 'naipe']; 
        const modoAtual = s.jogo.preferenciasOrdenacao[idx]; 
        const novoModo = (modoAtual === 'naipe') ? 'valor' : 'naipe'; 
        s.jogo.preferenciasOrdenacao[idx] = novoModo; 
        s.jogo[`maoJogador${idx + 1}`] = ordenarMaoServer(s.jogo[`maoJogador${idx + 1}`], novoModo); 
        socket.emit('maoAtualizada', { mao: s.jogo[`maoJogador${idx + 1}`], modo: novoModo }); 
    });
    socket.on('comprarLixo', (indices) => { const s = salas[socket.salaAtual]; if (s && s.jogadores[s.vez] === socket.id) gameActions.comprarLixo(s, s.vez, indices, socket); });
    socket.on('reiniciarPartida', () => { const s = salas[socket.salaAtual]; if(s) iniciarNovaRodada(s); });
    socket.on('enviarChat', (msg) => { const s = salas[socket.salaAtual]; if (s) { const idx = s.jogadores.indexOf(socket.id); const nome = socket.usuario ? socket.usuario.nome : `Jogador ${idx+1}`; const textoLimpo = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;"); io.to(s.id).emit('receberChat', { idJogador: idx, msg: `${nome}: ${textoLimpo}`, sistema: false }); } });
});

server.listen(3000, () => console.log('>>> Servidor pronto em http://localhost:3000'));