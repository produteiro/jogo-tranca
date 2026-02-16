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
        io.to(sala.id).emit('estadoJogo', sala);
        
        // Atualizações pontuais para animações
        io.to(sala.id).emit('atualizarMaosCount', getContagemMaos(sala));
        const placar = calcularPlacarParcial(sala);
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
                io.to(sala.id).emit('receberChat', { idJogador: -1, msg: `Jogador ${idxJogador+1} trocou 3 Vermelho.`, sistema: true });
            });
            
            mao = novaMao;
            
            // Repor cartas
            for(let i=0; i<tresEncontrados.length; i++){
                if (garantirMonteDisponivel(sala)) {
                    mao.push(sala.jogo.monte.pop());
                    trocou = true;
                }
            }
            loop++;
        }
        
        if (trocou) {
            sala.jogo[`maoJogador${idxJogador + 1}`] = ordenarMaoServer(mao, 'naipe');
        }
    } catch (e) { console.error("Erro higienizar:", e); }
};

const iniciarNovaRodada = (sala) => {
    console.log(`[SALA ${sala.id}] Iniciando nova rodada...`);
    sala.jogo = prepararPartida();
    sala.vez = 0; // Começa sempre pelo Jogador 1 (Dono da sala) para evitar confusão no início
    sala.estadoTurno = 'comprando';
    sala.jogo.primeiraCompra = true;
    sala.jogo.primeiraCompraJogador = sala.vez;

    // Higieniza mãos iniciais
    for(let i=0; i<4; i++) higienizarMaoComTresVermelhos(sala, i);

    io.to(sala.id).emit('statusJogo', { msg: "--- NOVA PARTIDA INICIADA ---" });
    broadcastEstado(sala);
    
    // Se o jogador 1 for Bot (modo treino), ele joga. Se for humano, espera.
    verificarVezBot(sala);
};

// --- AÇÕES DO JOGO ---
// --- AÇÕES ---
const gameActions = {
    comprarDoMonte: (sala, idx) => {
        if (sala.vez !== idx || sala.estadoTurno !== 'comprando') return;
        
        // Verifica disponibilidade antes
        if (sala.jogo.monte.length === 0) {
            if (!garantirMonteDisponivel(sala)) return; // Fim de jogo real se não tiver morto
        }
        
        const ehPrimeira = sala.jogo.primeiraCompra && sala.jogo.primeiraCompraJogador === idx;
        const carta = sala.jogo.monte.pop();
        
        // CORREÇÃO 3: Repõe IMEDIATAMENTE se zerou após o saque
        if (sala.jogo.monte.length === 0) {
            garantirMonteDisponivel(sala);
        }
        
        sala.jogo[`maoJogador${idx + 1}`].push(carta);
        higienizarMaoComTresVermelhos(sala, idx);
        
        sala.estadoTurno = 'descartando';
        if (ehPrimeira) sala.jogo.permitirRecompra = true;
        
        io.to(sala.jogadores[idx]).emit('cartaComprada', { cartaId: carta.id }); 
        
        broadcastEstado(sala);
    },
    
    // ... (mantenha comprarLixo, baixarJogo e descartar iguais, apenas certifique-se que higienizarMaoComTresVermelhos abaixo também tem a correção)
    comprarLixo: (sala, idx) => {
        if (sala.vez !== idx || sala.estadoTurno !== 'comprando') return;
        if (sala.jogo.lixo.length === 0) return;
        
        const cartaTopo = sala.jogo.lixo[sala.jogo.lixo.length-1];
        if (cartaTopo.face === '3' && (['paus','espadas'].includes(cartaTopo.naipe))) return;
        
        const mao = sala.jogo[`maoJogador${idx + 1}`];
        const jogosMesa = sala.jogo.jogosNaMesa[idx%2];
        
        if (verificarPossibilidadeCompra(mao, cartaTopo, jogosMesa)) {
            const lixo = sala.jogo.lixo.splice(0);
            sala.jogo[`maoJogador${idx+1}`] = mao.concat(lixo);
            sala.jogo.obrigacaoTopoLixo = cartaTopo.id;
            
            higienizarMaoComTresVermelhos(sala, idx);
            sala.estadoTurno = 'descartando';
            sala.jogo.primeiraCompra = false;
            
            broadcastEstado(sala);
        }
    },
    
    baixarJogo: (sala, idx, dados) => {
       // ... (seu código atual de baixarJogo, sem alterações necessárias) ...
       if (sala.vez !== idx) return;
       const mao = sala.jogo[`maoJogador${idx+1}`];
       const cartas = dados.indices.map(i => mao[i]);
       
       if (sala.jogo.obrigacaoTopoLixo) {
           if (!cartas.some(c => c.id === sala.jogo.obrigacaoTopoLixo)) return;
           sala.jogo.obrigacaoTopoLixo = null;
       }

       let jogoFinal = [...cartas];
       const idEq = idx % 2;
       
       if (dados.indexJogoMesa !== null) {
           const alvo = sala.jogo.jogosNaMesa[idEq][dados.indexJogoMesa];
           jogoFinal = [...alvo, ...cartas];
       }

       if (validarJogo(jogoFinal)) {
           dados.indices.sort((a,b)=>b-a).forEach(i => mao.splice(i,1));
           jogoFinal = ordenarJogoMesa(jogoFinal);
           
           if (dados.indexJogoMesa !== null) sala.jogo.jogosNaMesa[idEq][dados.indexJogoMesa] = jogoFinal;
           else sala.jogo.jogosNaMesa[idEq].push(jogoFinal);
           
           if (mao.length === 0) {
               if (!sala.jogo.equipePegouMorto[idEq]) entregarMorto(sala, idx);
               else if (temCanastra(sala.jogo.jogosNaMesa[idEq])) encerrarPartida(sala, idEq);
           }
           broadcastEstado(sala);
       }
    },

    descartar: (sala, idx, indexCarta) => {
        // ... (seu código atual de descartar, sem alterações necessárias) ...
        if (sala.vez !== idx || sala.jogo.obrigacaoTopoLixo) return;
        const mao = sala.jogo[`maoJogador${idx+1}`];
        const carta = mao.splice(indexCarta, 1)[0];
        sala.jogo.lixo.push(carta);

        if (sala.jogo.permitirRecompra) {
            sala.jogo.permitirRecompra = false;
            sala.jogo.primeiraCompra = false;
            sala.estadoTurno = 'comprando';
            broadcastEstado(sala);
            verificarVezBot(sala);
            return;
        }

        if (mao.length === 0) {
             const idEq = idx%2;
             if (!sala.jogo.equipePegouMorto[idEq]) entregarMorto(sala, idx);
             else {
                 if (temCanastra(sala.jogo.jogosNaMesa[idEq])) encerrarPartida(sala, idEq);
                 else {
                     mao.push(carta); sala.jogo.lixo.pop(); 
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

// Também precisamos atualizar a função auxiliar para garantir que a troca de 3 vermelho não zere o monte sem repor
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
                // Verifica se tem carta para repor
                if (sala.jogo.monte.length === 0) garantirMonteDisponivel(sala);
                
                if (sala.jogo.monte.length > 0) {
                    mao.push(sala.jogo.monte.pop());
                    trocou = true;
                    
                    // Verifica novamente após retirar
                    if (sala.jogo.monte.length === 0) garantirMonteDisponivel(sala);
                }
            }
            loop++;
        }
        if (trocou) sala.jogo[`maoJogador${idx + 1}`] = ordenarMaoServer(mao, 'naipe');
    } catch (e) { console.error(e); }
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
    
    // Limpa o jogo mas mantém a sala
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
    // Login
    socket.on('loginAnonimo', n => {
        socket.usuarioLogado = { email: `anon_${socket.id}`, nome: n, anonimo: true };
        socket.emit('loginSucesso', socket.usuarioLogado);
    });

    socket.on('enviarChat', (msg) => {
        // Pega o nome do usuário da sessão ou usa o ID
        const nome = socket.usuarioLogado ? socket.usuarioLogado.nome : `Jogador ${socket.id.substr(0,4)}`;
        // Reenvia para todos na sala
        io.to(socket.salaAtual).emit('receberChat', { nome: nome, msg: msg });
    });

    socket.on('entrarSala', id => {
        socket.join(id); 
        socket.salaAtual = id;
        
        if (!salas[id]) {
            salas[id] = { id, jogadores: [null,null,null,null], donos: [null,null,null,null], usuarios: [null,null,null,null], jogo: null, vez: 0 };
        }
        
        const s = salas[id];
        let slot = s.donos.indexOf(null);
        
        // Se já sou dono/jogador, reconecta no meu slot
        if (s.donos.includes(socket.id)) slot = s.donos.indexOf(socket.id);
        
        if(slot !== -1) { 
            s.donos[slot] = socket.id; 
            s.jogadores[slot] = socket.id;
            s.usuarios[slot] = socket.usuarioLogado;
        }
        
        if(id === 'treino') { 
            for(let i=0; i<4; i++) if(!s.donos[i]) { s.donos[i] = `BOT-${i}`; s.jogadores[i] = `BOT-${i}`; }
        }
        
        // Se a sala está cheia e não tem jogo, inicia
        if(s.donos.every(d => d !== null) && !s.jogo) {
            iniciarNovaRodada(s);
        } else if (s.jogo) {
            // Se já tem jogo, envia o estado atual para quem reconectou
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

    // CORREÇÃO DO RESET
    socket.on('resetJogo', () => {
        const s = salas[socket.salaAtual];
        if(s) {
            console.log("Reset solicitado pelo jogador.");
            s.jogo = null; // Mata o jogo atual
            iniciarNovaRodada(s); // Força novo início
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Rodando na porta ${PORT}`));


