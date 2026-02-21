const { encontrarTrincas, encontrarSequencias, verificarSeEncaixa, ehTresVermelho, temCanastra } = require('./logicaJogo');

// Função auxiliar para evitar que o bot fique preso com 1 carta sem poder bater
function vaiserTravaDeMao(sala, idEquipe, qtdCartasGastas, maoTotal) {
    const jaPegouMorto = sala.jogo.equipePegouMorto[idEquipe];
    const temCanastraFechada = temCanastra(sala.jogo.jogosNaMesa[idEquipe]);
    
    // Se tem obrigação do lixo, ele não tem escolha a não ser baixar o jogo
    if (sala.jogo.obrigacaoTopoLixo) return false;

    if (!jaPegouMorto) return false; 
    if (temCanastraFechada) return false; 

    const sobras = maoTotal - qtdCartasGastas;
    return sobras < 2;
}

// REGRA DA VIDÊNCIA: Simula se a carta do topo serve e RETORNA OS IDs EXATOS
function planejarJogadaLixo(mao, cartaTopo, jogosMesa) {
    // 1. O topo encaixa perfeitamente em um jogo que já está na mesa?
    if (jogosMesa) {
        for (let i = 0; i < jogosMesa.length; i++) {
            if (verificarSeEncaixa(jogosMesa[i], cartaTopo)) {
                return { tipo: 'mesa', ids: [cartaTopo.id], mesaIdx: i };
            }
        }
    }

    // 2. O topo forma um jogo novo na mão? (Simulando a mão)
    const maoSimulada = [...mao, cartaTopo];
    
    // Procura Trincas
    const trincas = encontrarTrincas(maoSimulada);
    for (let indices of trincas) {
        const cartasJogo = indices.map(i => maoSimulada[i]);
        // Verifica se a carta do topo faz parte desta trinca encontrada
        if (cartasJogo.some(c => c.id === cartaTopo.id)) {
            return { tipo: 'novo', ids: cartasJogo.map(c => c.id), mesaIdx: null };
        }
    }

    // Procura Sequências
    const sequencias = encontrarSequencias(maoSimulada);
    for (let indices of sequencias) {
        const cartasJogo = indices.map(i => maoSimulada[i]);
        if (cartasJogo.some(c => c.id === cartaTopo.id)) {
            return { tipo: 'novo', ids: cartasJogo.map(c => c.id), mesaIdx: null };
        }
    }

    return null; // A vidência diz que não tem jogo. O Bot é proibido de comprar o lixo.
}

function jogarTurnoBot(sala, indiceBot, funcoes) {
    console.log(`[BOT ${indiceBot}] Iniciando turno...`);
    let planoObrigatorio = null;

    // --- ETAPA 1: COMPRAR ---
    setTimeout(() => {
        try {
            const maoInicial = sala.jogo[`maoJogador${indiceBot + 1}`];
            const idEquipe = indiceBot % 2;
            let comprouLixo = false;

            if (sala.jogo.lixo.length > 0) {
                const cartaTopo = sala.jogo.lixo[sala.jogo.lixo.length - 1];
                const trancado = cartaTopo.face === '3' && (cartaTopo.naipe === 'paus' || cartaTopo.naipe === 'espadas');

                if (!trancado) {
                    // O Bot planeja a jogada antes de tocar no lixo
                    const plano = planejarJogadaLixo(maoInicial, cartaTopo, sala.jogo.jogosNaMesa[idEquipe]);

                    if (plano) {
                        console.log(`[BOT ${indiceBot}] A vidência funcionou. Comprando Lixo com plano. IDs: [${plano.ids}]`);
                        planoObrigatorio = plano; 
                        funcoes.comprarLixo(sala, indiceBot, [], null);
                        comprouLixo = true;
                    }
                }
            }

            if (!comprouLixo) {
                funcoes.comprarDoMonte(sala, indiceBot, null);
            }

        } catch (e) { console.error(`Erro Bot Compra:`, e); }

        // --- ETAPA 2: BAIXAR JOGOS ---
        setTimeout(() => {
            try {
                const idEquipe = indiceBot % 2;

                // 1. PRIORIDADE ABSOLUTA: CUMPRIR LIXO (SE COMPROU)
                if (sala.jogo.obrigacaoTopoLixo && planoObrigatorio) {
                    console.log(`[BOT ${indiceBot}] Executando o plano do Lixo com prioridade absoluta.`);
                    // O Bot agora envia os IDs EXATOS, como o servidor humano exige
                    funcoes.baixarJogo(sala, indiceBot, { 
                        ids: planoObrigatorio.ids, 
                        indexJogoMesa: planoObrigatorio.mesaIdx 
                    }, null);
                } 
                else if (sala.jogo.obrigacaoTopoLixo) {
                    console.warn(`[BOT ${indiceBot}] Erro Crítico: Tem obrigação, mas o plano sumiu!`);
                }

                // 2. JOGADAS NORMAIS LIVRES (Apenas se a obrigação do lixo não existir mais)
                // Atualiza a mão pois a jogada anterior pode ter removido cartas
                const maoAtualizada = sala.jogo[`maoJogador${indiceBot + 1}`];
                
                if (!sala.jogo.obrigacaoTopoLixo) {
                    const trincas = encontrarTrincas(maoAtualizada);
                    const sequencias = encontrarSequencias(maoAtualizada);
                    let novosJogos = [...trincas, ...sequencias];

                    if (novosJogos.length > 0) {
                        novosJogos.sort((a, b) => b.length - a.length); // Tenta o maior jogo primeiro
                        const jogoParaBaixar = novosJogos[0]; // Isso aqui é um array de índices
                        
                        if (!vaiserTravaDeMao(sala, idEquipe, jogoParaBaixar.length, maoAtualizada.length)) {
                            // A CORREÇÃO MÁGICA: Converte os índices encontrados em IDs antes de mandar para o servidor
                            const idsParaBaixar = jogoParaBaixar.map(i => maoAtualizada[i].id);
                            
                            console.log(`[BOT ${indiceBot}] Baixando jogo normal livre da mão.`);
                            funcoes.baixarJogo(sala, indiceBot, { ids: idsParaBaixar, indexJogoMesa: null }, null);
                        }
                    }
                }

            } catch (e) { console.error(`Erro Bot Baixar:`, e); }

            // --- ETAPA 3: DESCARTAR ---
            setTimeout(() => {
                try {
                    const maoFinal = sala.jogo[`maoJogador${indiceBot + 1}`];
                    
                    // SEGURANÇA FINAL: Se por um milagre ele ainda tem obrigação, ele é proibido de descartar
                    if (sala.jogo.obrigacaoTopoLixo) {
                        console.log(`[BOT ${indiceBot}] Bloqueado pela obrigação. Turno pulado.`);
                        return;
                    }

                    if (maoFinal && maoFinal.length > 0) {
                        realizarDescarteInteligente(sala, indiceBot, funcoes, maoFinal);
                    }
                } catch (e) { console.error(`Erro Bot Descarte:`, e); }
            }, 1500);

        }, 1500);
    }, 1000);
}

function realizarDescarteInteligente(sala, indiceBot, funcoes, mao) {
    const idEquipe = indiceBot % 2;
    const idEquipeAdversaria = (idEquipe + 1) % 2;
    const jogosAdversarios = sala.jogo.jogosNaMesa[idEquipeAdversaria] || [];

    let candidatos = mao.map((carta, index) => {
        let score = 0;
        if (carta.face === '3' && (carta.naipe === 'paus' || carta.naipe === 'espadas')) score += 1000;
        if (carta.face === '2') score -= 500;
        
        jogosAdversarios.forEach(jogoAdv => {
            if (verificarSeEncaixa(jogoAdv, carta)) {
                score -= 50; 
                if (jogoAdv.length === 6) score -= 200; 
                if (jogoAdv.length >= 7) score -= 20; 
            }
        });
        
        const pares = mao.filter(c => c.face === carta.face).length;
        if (pares === 1) score += 10; 
        
        return { index, score };
    });

    candidatos.sort((a, b) => b.score - a.score);
    const indexDescarte = candidatos[0].index;

    if (indexDescarte !== undefined && indexDescarte >= 0) {
        funcoes.descartarCarta(sala, indiceBot, indexDescarte, null);
    }
}

module.exports = { jogarTurnoBot };
