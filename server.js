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

        io.to(sala.id).emit('estadoJogo', {
            ...sala,
            placarCalculado: placar,
            maosCount: contagem
        });
        
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
            
            tresEncontrados.forEach(c => sala.jogo.tresVermelhos[idEquipe].push(c));
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
    sala.jogo = prepararPartida();
    sala.vez = Math.floor(Math.random() * 4); 
    sala.estadoTurno = 'comprando';

    for(let i=0; i<4; i++) higienizarMaoComTresVermelhos(sala, i);

    io.to(sala.id).emit('statusJogo', { msg: `--- NOVA PARTIDA! O Jogador ${sala.vez + 1} começa ---` });
    broadcastEstado(sala);
    verificarVezBot(sala);
};

// --- AÇÕES DO JOGO ---
const gameActions = {
comprarDoMonte: (sala, idx, socket) => {
        if (sala.vez !== idx) {
            if(socket) socket.emit('erroJogo', 'Não é a sua vez de jogar!');
            return;
        }
        if (sala.estadoTurno !== 'comprando') {
            if(socket) socket.emit('erroJogo', 'Você já comprou cartas nesta rodada. Faça um descarte.');
            return;
        }
        
        if (sala.jogo.monte.length === 0) {
            if (!garantirMonteDisponivel(sala)) {
                if(socket) socket.emit('erroJogo', 'O monte e os mortos acabaram!');
                return; 
            }
        }
    
        const cartaOriginal = sala.jogo.monte.pop();
        if(!cartaOriginal) return; 
        
        // ✅ CORREÇÃO: Puxa o morto para o monte IMEDIATAMENTE após pegar a última carta
        if (sala.jogo.monte.length === 0) {
            garantirMonteDisponivel(sala);
        }
        
        sala.jogo[`maoJogador${idx + 1}`].push(cartaOriginal);
        higienizarMaoComTresVermelhos(sala, idx);
        
        sala.estadoTurno = 'descartando';
        
        // Destaca no visual
        io.to(sala.jogadores[idx]).emit('cartaComprada', { cartaId: cartaOriginal.id }); 
        broadcastEstado(sala);
    },

comprarLixo: (sala, idx, dados, socket) => {
        if (sala.vez !== idx || sala.estadoTurno !== 'comprando') return;
        if (sala.jogo.lixo.length === 0) return;

        // 1. Identifica o topo exato
        const topo = sala.jogo.lixo[sala.jogo.lixo.length - 1];
        sala.jogo.obrigacaoTopoLixo = topo.id;
        
        // 2. Identifica e bloqueia temporariamente o "resto" do lixo
        const restoDoLixo = sala.jogo.lixo.slice(0, sala.jogo.lixo.length - 1);
        sala.jogo.cartasBloqueadasLixo = restoDoLixo.map(c => c.id);

        sala.jogo[`maoJogador${idx + 1}`].push(...sala.jogo.lixo);
        sala.jogo.lixo = [];
        
        sala.estadoTurno = 'descartando';
        broadcastEstado(sala);
    },
    
baixarJogo: (sala, idx, dados, socket) => {
        if (sala.vez !== idx) {
            if(socket) socket.emit('erroJogo', 'Não é a sua vez de jogar!');
            return; 
        }
        if (sala.estadoTurno !== 'descartando') {
            if(socket) socket.emit('erroJogo', 'Você precisa comprar antes de baixar jogos!');
            return;
        }

        const mao = sala.jogo[`maoJogador${idx + 1}`];
        let cartas = dados.ids ? dados.ids.map(id => mao.find(c => c.id === id)).filter(Boolean) : [];

        if (cartas.length === 0) return;

        // --- A MÁQUINA DE ESTADOS DO LIXO ---
        if (sala.jogo.obrigacaoTopoLixo) {
            const obId = sala.jogo.obrigacaoTopoLixo;
            
            // Regra 1: OBRIGATÓRIO ter a carta exata do topo
            const usouCartaObrigatoria = cartas.some(c => c.id === obId);
            if (!usouCartaObrigatoria) {
                if(socket) socket.emit('erroJogo', 'AÇÃO BLOQUEADA: Você é obrigado a baixar um jogo contendo a carta comprada do topo do lixo primeiro!');
                return;
            }

            // Regra 2: PROIBIDO usar o resto do lixo para justificar a compra
            if (sala.jogo.cartasBloqueadasLixo && sala.jogo.cartasBloqueadasLixo.length > 0) {
                const tentouUsarLixoBloqueado = cartas.some(c => sala.jogo.cartasBloqueadasLixo.includes(c.id));
                if (tentouUsarLixoBloqueado) {
                    if(socket) socket.emit('erroJogo', 'AÇÃO BLOQUEADA: Você não pode usar as outras cartas que vieram no lixo para justificar a compra. Use apenas a carta do topo com as cartas que já estavam com você!');
                    return;
                }
            }

            // Se passou pelas travas, a obrigação foi cumprida com excelência!
            sala.jogo.obrigacaoTopoLixo = null;
            sala.jogo.cartasBloqueadasLixo = []; // Libera as outras cartas para uso normal
        }    

        const idEquipe = idx % 2;
        let jogoAlvo = (dados.indexJogoMesa !== null && dados.indexJogoMesa >= 0) 
                       ? sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa] : [];
        let jogoFinal = [...jogoAlvo, ...cartas];

        if (validarJogo(jogoFinal)) {
            
            // --- NOVA VALIDAÇÃO: TRAVA DE BATIDA SEM CANASTRA ---
            const jaPegouMorto = sala.jogo.equipePegouMorto[idEquipe];
            const temMortoDisponivel = sala.jogo.morto1.length > 0 || sala.jogo.morto2.length > 0;
            const cartasRestantes = mao.length - cartas.length;

            // Simula como a mesa vai ficar para saber se essa jogada forma uma canastra
            let jogosMesaSimulado = [...sala.jogo.jogosNaMesa[idEquipe]];
            if (dados.indexJogoMesa !== null && dados.indexJogoMesa >= 0) {
                jogosMesaSimulado[dados.indexJogoMesa] = jogoFinal;
            } else {
                jogosMesaSimulado.push(jogoFinal);
            }
            const teraCanastra = temCanastra(jogosMesaSimulado);

            // Se a equipe não tem canastra e não tem como pegar um morto
            if ((jaPegouMorto || !temMortoDisponivel) && !teraCanastra) {
                if (cartasRestantes === 0) {
                    if(socket) socket.emit('erroJogo', 'Ação Inválida: Você precisa ter pelo menos uma canastra para bater direto.');
                    return; // Aborta a jogada
                }
                if (cartasRestantes === 1) {
                    if(socket) socket.emit('erroJogo', 'Ação Inválida: Você não pode baixar este jogo pois ficaria com apenas 1 carta e seria obrigado a bater sem ter canastra no descarte.');
                    return; // Aborta a jogada
                }
            }
            // ----------------------------------------------------

            if (sala.jogo.obrigacaoTopoLixo) {
                const obId = sala.jogo.obrigacaoTopoLixo;
                if (cartas.some(c => c.id === obId)) {
                    sala.jogo.obrigacaoTopoLixo = null; 
                }
            }

            cartas.forEach(carta => {
                const index = mao.findIndex(m => m.id === carta.id);
                if(index !== -1) mao.splice(index, 1);
            });
            
            jogoFinal = ordenarJogoMesa(jogoFinal);
            
            if (dados.indexJogoMesa !== null && dados.indexJogoMesa >= 0) {
                sala.jogo.jogosNaMesa[idEquipe][dados.indexJogoMesa] = jogoFinal;
            } else {
                sala.jogo.jogosNaMesa[idEquipe].push(jogoFinal);
            }
            
            if (mao.length === 0) {
                const temMortoDispAtualizado = sala.jogo.morto1.length > 0 || sala.jogo.morto2.length > 0;
                if (!sala.jogo.equipePegouMorto[idEquipe] && temMortoDispAtualizado) entregarMorto(sala, idx);
                else if (temCanastra(sala.jogo.jogosNaMesa[idEquipe])) encerrarPartida(sala, idEquipe);
            }
            
            broadcastEstado(sala);
        } else {
            if(socket) socket.emit('erroJogo', 'Jogo inválido. Verifique trincas e sequências.');
        }
    },

descartarCarta: (sala, idx, cartaIdOuIndex, socket) => {
        if (sala.vez !== idx) return;
        const mao = sala.jogo[`maoJogador${idx + 1}`];
        
        let indexCarta;
        if (typeof cartaIdOuIndex === 'string') {
            indexCarta = mao.findIndex(c => c.id === cartaIdOuIndex);
        } else {
            indexCarta = cartaIdOuIndex;
        }

        if (indexCarta === -1 || !mao[indexCarta]) {
            if(socket) socket.emit('erroJogo', 'Carta não encontrada para descartar!');
            return;
        }

        if (sala.jogo.obrigacaoTopoLixo) {
            const obId = sala.jogo.obrigacaoTopoLixo;
            const cartaAindaNaMao = mao.find(c => c.id === obId);

            if (cartaAindaNaMao) {
                if(socket) socket.emit('erroJogo', `Você precisa baixar a carta comprada do lixo antes de descartar qualquer carta!`);
                return;
            } else {
                sala.jogo.obrigacaoTopoLixo = null; 
            }
        }

        const carta = mao.splice(indexCarta, 1)[0];
        sala.jogo.lixo.push(carta);
        
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

        // ✅ CORREÇÃO: Encerra o jogo no momento do descarte se o monte e os mortos esgotaram
        if (sala.jogo.monte.length === 0 && sala.jogo.morto1.length === 0 && sala.jogo.morto2.length === 0) {
            console.log(`[FIM DE JOGO] O monte esgotou na sala ${sala.id}`);
            encerrarPartida(sala, -1); // -1 informa à função de placar que ninguém recebe os 100 pontos de batida
            return;
        }

        // LIMPEZA COMPLETA: Sem re-compra, o turno passa invariavelmente.
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

// --- FUNÇÃO DE ENCERRAMENTO E CÁLCULO BLINDADA ---

function calcularPontuacaoSegura(sala, idEquipeBateu) {
    const res = {
        detalhes: {
            p1: { ptsBatida: 0, ptsMorto: 0, ptsCanastrasLimpas: 0, ptsCanastrasSujas: 0, pts3Vermelhos: 0, ptsCartasMao: 0, ptsCartasMesa: 0, total: 0 },
            p2: { ptsBatida: 0, ptsMorto: 0, ptsCanastrasLimpas: 0, ptsCanastrasSujas: 0, pts3Vermelhos: 0, ptsCartasMao: 0, ptsCartasMesa: 0, total: 0 }
        },
        placar: { p1: 0, p2: 0 }
    };

    const equipes = [0, 1]; // Equipe 0 (P1/P3) e Equipe 1 (P2/P4)

    equipes.forEach(idEq => {
        const chave = idEq === 0 ? 'p1' : 'p2';
        const d = res.detalhes[chave];
        
        // 1. Pontos de Batida (Só aplica se alguém bateu E foi essa equipe)
        if (idEquipeBateu !== -1 && idEquipeBateu === idEq) {
            d.ptsBatida = 100;
        }

        // 2. Pontos de Morto (Se pegou é 0, se não pegou paga -100)
        // OBS: Se o morto acabou e ninguém pegou, quem não pegou paga -100 igual.
        if (!sala.jogo.equipePegouMorto[idEq]) {
            d.ptsMorto = -100;
        }

        // 3. Canastras e Cartas na Mesa
        sala.jogo.jogosNaMesa[idEq].forEach(jogo => {
            // Canastras
            if (jogo.length >= 7) {
                const temCuringa = jogo.some(c => c.face === '2'); // Simplificado
                const ehLimpa = !temCuringa; 
                if (ehLimpa) d.ptsCanastrasLimpas += 200;
                else d.ptsCanastrasSujas += 100;
            }
            
            // Soma valor das cartas na mesa
            jogo.forEach(c => {
                d.ptsCartasMesa += getValorCarta(c);
            });
        });

        // 4. 3 Vermelhos
        sala.jogo.tresVermelhos[idEq].forEach(c => {
            d.pts3Vermelhos += 100; // Ou o valor que você usa na sua regra
        });

        // 5. Desconto das Cartas na Mão (Sobra)
        // Jogadores da equipe: 0 e 2 para Eq0, 1 e 3 para Eq1
        const idxJogadores = idEq === 0 ? [0, 2] : [1, 3];
        idxJogadores.forEach(idx => {
            // Se foi o jogador que bateu, a mão está vazia (0 pontos), então não desconta
            const mao = sala.jogo[`maoJogador${idx+1}`];
            if (mao) {
                mao.forEach(c => {
                    d.ptsCartasMao -= getValorCarta(c);
                });
            }
        });

        // Total da Rodada
        d.total = d.ptsBatida + d.ptsMorto + d.ptsCanastrasLimpas + d.ptsCanastrasSujas + d.pts3Vermelhos + d.ptsCartasMesa + d.ptsCartasMao;
    });

    // Atualiza Placar Geral (Acumulado)
    // Se não tiver placar anterior, assume 0
    const placarAntigo = sala.placarGlobal || { p1: 0, p2: 0 };
    res.placar.p1 = placarAntigo.p1 + res.detalhes.p1.total;
    res.placar.p2 = placarAntigo.p2 + res.detalhes.p2.total;
    
    // Salva na sala para a próxima rodada (opcional, se for manter a sala)
    sala.placarGlobal = res.placar;

    return res;
}

function getValorCarta(c) {
    if (!c) return 0;
    if (c.face === '3' && (c.naipe === 'copas' || c.naipe === 'ouros' || c.naipe === 'HEARTS' || c.naipe === 'DIAMONDS')) return 0; // 3 Vermelho na mão/mesa não vale ponto normal, vale bonus
    if (c.face === '2') return 10; // Curinga vale 10 (ou 20 dependendo da regra, aqui pus 10 padrão mesa)
    if (c.face === 'J' || c.face === 'Q' || c.face === 'K' || c.face === '10' || c.face === '8' || c.face === '9') return 10;
    if (c.face === 'A') return 15;
    return 5; // 3 a 7
}

function encerrarPartida(sala, idEquipeBateu) {
    console.log(`[FIM] Encerrando partida na sala ${sala.id}. Batida: ${idEquipeBateu}`);
    
    try {
        const resultado = calcularPontuacaoSegura(sala, idEquipeBateu);
        io.to(sala.id).emit('fimDeJogo', resultado);
        console.log("Resultado enviado com sucesso.");
        
        // Limpa o jogo da memória para evitar travamentos, mas mantém a sala e jogadores
        sala.jogo = null;
        sala.vez = 0;
    } catch (e) {
        console.error("ERRO FATAL AO CALCULAR PONTOS:", e);
        // Em último caso, destrava o cliente
        io.to(sala.id).emit('erroJogo', 'Fim de jogo (Erro no cálculo de pontos). Reiniciando...');
        sala.jogo = null;
    }
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

function registrarLog(sala, acao, idJogador, dadosPayload) {
    if (!sala) return;
    
    const timestamp = new Date().toISOString(); // Ex: 2026-02-19T20:45:00.000Z
    const estadoTurno = sala.estadoTurno || 'indefinido';
    const vezAtual = sala.vez;
    
    const entradaLog = {
        hora: timestamp,
        jogadorIdx: idJogador,
        vezEraDo: vezAtual,
        faseTurno: estadoTurno,
        comando: acao,
        payload: dadosPayload
    };
    
    sala.logAcoes.push(entradaLog);
    
    // Opcional: Imprime no console do servidor em tempo real para você monitorar
    console.log(`[LOG ${sala.id}] J${idJogador} -> ${acao}`, dadosPayload);
}

io.on('connection', (socket) => {
    socket.on('loginAnonimo', n => {
        socket.usuarioLogado = { email: `anon_${socket.id}`, nome: n, anonimo: true };
        socket.emit('loginSucesso', socket.usuarioLogado);
    });

// --- LÓGICA DE SALA COM RECONEXÃO BLINDADA ---
    socket.on('entrarSala', idSolicitado => {
        if (!socket.usuarioLogado) return; 

        const uid = socket.usuarioLogado.id;
        const idSala = (idSolicitado === 'treino') ? `treino-${uid}` : idSolicitado;
        
        socket.join(idSala); 
        socket.salaAtual = idSala;
        
        // Se a sala não existe, cria (Zera tudo)
        if (!salas[idSala]) {
            console.log(`[SALA] Criando nova estrutura para sala: ${idSala}`);
salas[idSala] = { 
    id: idSala, 
    jogadores: [null,null,null,null], 
    donos: [null,null,null,null], 
    usuarios: [null,null,null,null], 
    jogo: null, 
    vez: 0,
    logAcoes: [] // A NOSSA CAIXA PRETA
};
        }
        
        const s = salas[idSala];
        
        // 1. Tenta achar o usuário pelo UID Persistente (Recuperação de Cadeira)
        let slot = s.usuarios.findIndex(u => u && u.id === uid);
        
        if (slot !== -1) {
            console.log(`[RECONEXÃO] O jogador ${socket.usuarioLogado.nome} (Slot ${slot}) voltou! Atualizando socket...`);
            // Atualiza apenas o socket da conexão atual, mantendo o resto intacto
            s.donos[slot] = socket.id;
            s.jogadores[slot] = socket.id;
        } else {
            // Jogador Novo na sala
            slot = s.donos.indexOf(null);
            if(slot !== -1) { 
                console.log(`[ENTRADA] Novo jogador ${socket.usuarioLogado.nome} ocupou o Slot ${slot}`);
                s.donos[slot] = socket.id; 
                s.jogadores[slot] = socket.id;
                s.usuarios[slot] = socket.usuarioLogado;
            }
        }
        
        // 2. Preenche Bots apenas nos buracos vazios (sem sobrescrever ninguém)
        if(idSala.startsWith('treino-')) { 
            for(let i=0; i<4; i++) {
                // Só coloca bot se NÃO tiver usuário registrado ali
                if(!s.usuarios[i]) { 
                    s.donos[i] = `BOT-${i}`; 
                    s.jogadores[i] = `BOT-${i}`; 
                    s.usuarios[i] = { id: `BOT-${i}`, nome: `Bot ${i+1}` }; 
                }
            }
        }
        
        // 3. DECISÃO CRÍTICA: Recuperar ou Iniciar?
        if (s.jogo) {
            // SE O JOGO JÁ EXISTE, NÃO INICIE OUTRO! APENAS ENVIE O ESTADO.
            console.log(`[ESTADO] Enviando mesa atual para ${socket.usuarioLogado.nome} (Sem reiniciar)`);
            socket.emit('estadoJogo', s);
        } else if (s.usuarios.every(u => u !== null)) {
            // Só inicia novo jogo se a sala estiver cheia E o jogo for nulo
            console.log(`[NOVO JOGO] Sala cheia e sem jogo ativo. Iniciando partida...`);
            iniciarNovaRodada(s);
        }
    });

socket.on('jogada', (dados) => {
        // A TRAVA ANTI-SILÊNCIO: Se o servidor perdeu a referência da sala deste socket
        if (!socket.salaAtual || !salas[socket.salaAtual]) {
            if(socket) socket.emit('erroJogo', 'Sua conexão oscilou e a sincronia foi perdida. Pressione F5 para atualizar e voltar exatamente de onde parou!');
            return;
        }

        const s = salas[socket.salaAtual];
        if (!s || !s.jogo) return;
        
        const meuIndex = s.jogadores.indexOf(socket.id);
        
        // Se o index for -1, ele não achou seu socket na lista de jogadores
        if (meuIndex === -1) {
             if(socket) socket.emit('erroJogo', 'Erro de identificação na cadeira. Pressione F5.');
             return;
        }
        
        if (dados.acao === 'comprarMonte') gameActions.comprarDoMonte(s, meuIndex, socket);
        else if (dados.acao === 'comprarLixo') gameActions.comprarLixo(s, meuIndex, null, socket);
        else if (dados.acao === 'baixarJogo') gameActions.baixarJogo(s, meuIndex, dados.dados, socket);
        else if (dados.acao === 'descartar') {
            const val = dados.dados.id ? dados.dados.id : dados.dados.index;
            gameActions.descartarCarta(s, meuIndex, val, socket);
        }
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






