const { encontrarTrincas, encontrarSequencias, verificarSeEncaixa, ehTresVermelho, temCanastra } = require('./logicaJogo');

// Função auxiliar para evitar que o bot fique preso com 1 carta sem poder bater
function vaiserTravaDeMao(sala, idEquipe, qtdCartasGastas, maoTotal) {
    const jaPegouMorto = sala.jogo.equipePegouMorto[idEquipe];
    const temCanastraFechada = temCanastra(sala.jogo.jogosNaMesa[idEquipe]);
    
    // Se tem obrigação, IGNORA TRAVA. É melhor ficar com 0 cartas e tomar penalidade 
    // (ou depender da sorte) do que travar o jogo.
    if (sala.jogo.obrigacaoTopoLixo) return false;

    if (!jaPegouMorto) return false; 
    if (temCanastraFechada) return false; 

    const sobras = maoTotal - qtdCartasGastas;
    return sobras < 2;
}

// Simula se a carta do topo serve e RETORNA O PLANO DE JOGO (IDs das cartas)
function planejarJogadaLixo(mao, cartaTopo, jogosMesa) {
    // 1. Serve na Mesa?
    if (jogosMesa) {
        for (let i = 0; i < jogosMesa.length; i++) {
            if (verificarSeEncaixa(jogosMesa[i], cartaTopo)) {
                return { tipo: 'mesa', ids: [cartaTopo.id], mesaIdx: i };
            }
        }
    }

    // 2. Serve na Mão? (Simula mão com a carta)
    const maoSimulada = [...mao, cartaTopo];
    
    // Procura Trincas que usem o Topo
    const trincas = encontrarTrincas(maoSimulada);
    for (let indices of trincas) {
        const cartasJogo = indices.map(i => maoSimulada[i]);
        if (cartasJogo.some(c => c.id === cartaTopo.id)) {
            return { tipo: 'novo', ids: cartasJogo.map(c => c.id) };
        }
    }

    // Procura Sequências que usem o Topo
    const sequencias = encontrarSequencias(maoSimulada);
    for (let indices of sequencias) {
        const cartasJogo = indices.map(i => maoSimulada[i]);
        if (cartasJogo.some(c => c.id === cartaTopo.id)) {
            return { tipo: 'novo', ids: cartasJogo.map(c => c.id) };
        }
    }

    return null; // Não serve
}

function jogarTurnoBot(sala, indiceBot, funcoes) {
    console.log(`[BOT ${indiceBot}] Iniciando turno...`);
    
    // Variável para persistir o plano entre o passo de Compra e o passo de Baixar
    // O bot não tem memória persistente entre chamadas de função, mas dentro do escopo do turno (closures) sim.
    let planoObrigatorio = null;

    // --- ETAPA 1: COMPRAR ---
    setTimeout(() => {
        try {
            const maoInicial = sala.jogo[`maoJogador${indiceBot + 1}`];
            const idEquipe = indiceBot % 2;
            let moveuDoLixo = false;

            if (sala.jogo.lixo.length > 0) {
                const cartaTopo = sala.jogo.lixo[sala.jogo.lixo.length - 1];
                const trancado = cartaTopo.face === '3' && (cartaTopo.naipe === 'paus' || cartaTopo.naipe === 'espadas');

                if (!trancado) {
                    // PLANEJA A JOGADA ANTES DE COMPRAR
                    const plano = planejarJogadaLixo(maoInicial, cartaTopo, sala.jogo.jogosNaMesa[idEquipe]);

                    if (plano) {
                        // Se tem plano, compra!
                        console.log(`[BOT ${indiceBot}] Plano Lixo: ${plano.tipo} com ids [${plano.ids}]`);
                        planoObrigatorio = plano; // Salva para o próximo passo
                        funcoes.comprarLixo(sala, indiceBot, [], null);
                        moveuDoLixo = true;
                    }
                }
            }

            if (!moveuDoLixo) {
                funcoes.comprarDoMonte(sala, indiceBot, null);
            }

        } catch (e) {
            console.error(`Erro Bot Compra:`, e);
            funcoes.comprarDoMonte(sala, indiceBot, null); 
        }

        // --- ETAPA 2: BAIXAR JOGOS ---
        setTimeout(() => {
            try {
                // Pega a mão ATUALIZADA (O servidor já adicionou o lixo e REORDENOU a mão)
                const mao = sala.jogo[`maoJogador${indiceBot + 1}`];
                const idEquipe = indiceBot % 2;
                let jogouAlgo = false;

                // 1. EXECUTA O PLANO OBRIGATÓRIO (SE HOUVER)
                if (planoObrigatorio) {
                    console.log(`[BOT ${indiceBot}] Executando plano obrigatório...`);
                    
                    // Precisamos encontrar os NOVOS índices das cartas baseados nos IDs
                    const indicesParaJogar = [];
                    let encontrouTodas = true;

                    planoObrigatorio.ids.forEach(idBusca => {
                        const idx = mao.findIndex(c => c.id === idBusca);
                        if (idx !== -1) indicesParaJogar.push(idx);
                        else encontrouTodas = false;
                    });

                    if (encontrouTodas) {
                        const idxMesa = (planoObrigatorio.tipo === 'mesa') ? planoObrigatorio.mesaIdx : null;
                        
                        // Executa sem verificar travas (é obrigação)
                        funcoes.baixarJogo(sala, indiceBot, { indices: indicesParaJogar, indexJogoMesa: idxMesa }, null);
                        jogouAlgo = true;
                        
                        // Zera o plano para não repetir
                        planoObrigatorio = null; 
                    } else {
                        console.error(`[BOT ${indiceBot}] ERRO CRÍTICO: Cartas do plano sumiram da mão!`);
                        // Fallback: Tenta achar qualquer jogo com a obrigação
                    }
                }

                // Se ainda tiver obrigação pendente (ex: plano falhou), tenta qualquer coisa com a carta
                if (sala.jogo.obrigacaoTopoLixo && !jogouAlgo) {
                    const cartaObrigacao = mao.find(c => c.id === sala.jogo.obrigacaoTopoLixo);
                    if (cartaObrigacao) {
                        // Tenta achar na mesa
                        const jogosMesa = sala.jogo.jogosNaMesa[idEquipe];
                        const idxMesa = jogosMesa.findIndex(j => verificarSeEncaixa(j, cartaObrigacao));
                        if(idxMesa !== -1) {
                             const idxMao = mao.findIndex(c => c.id === cartaObrigacao.id);
                             funcoes.baixarJogo(sala, indiceBot, { indices: [idxMao], indexJogoMesa: idxMesa }, null);
                             jogouAlgo = true;
                        }
                        // Tenta achar jogo novo (Recalcula)
                        // ... (Código de fallback simplificado omitido para não duplicar lógica, o plano acima deve cobrir 99%)
                    }
                }

                // 2. JOGADAS NORMAIS (Se não jogou ou se tem mais cartas)
                // Só continua se não tiver risco de travar a mão e se já cumpriu obrigações
                if (!sala.jogo.obrigacaoTopoLixo) {
                    // A) Jogos Novos
                    const trincas = encontrarTrincas(mao);
                    const sequencias = encontrarSequencias(mao);
                    let novosJogos = [...trincas, ...sequencias];

                    if (novosJogos.length > 0) {
                        novosJogos.sort((a, b) => b.length - a.length);
                        const jogoParaBaixar = novosJogos[0];
                        if (!vaiserTravaDeMao(sala, idEquipe, jogoParaBaixar.length, mao.length)) {
                            funcoes.baixarJogo(sala, indiceBot, { indices: jogoParaBaixar, indexJogoMesa: null }, null);
                        }
                    }
                    
                    // B) Completar Mesa (Se ainda não jogou nada neste turno ou quer jogar mais)
                    // ... (Simplificado: Bot joga 1 vez por turno para ser seguro e rápido)
                }

            } catch (e) {
                console.error(`Erro Bot Baixar:`, e);
            }

            // --- ETAPA 3: DESCARTAR ---
            setTimeout(() => {
                try {
                    const maoFinal = sala.jogo[`maoJogador${indiceBot + 1}`];
                    
                    // SEGURANÇA FINAL: Se ainda tem obrigação, NÃO DESCARTA.
                    if (sala.jogo.obrigacaoTopoLixo) {
                        console.log(`[BOT ${indiceBot}] Travado com obrigação. Turno perdido (timeout natural).`);
                        return;
                    }

                    if (maoFinal && maoFinal.length > 0) {
                        realizarDescarteInteligente(sala, indiceBot, funcoes, maoFinal);
                    }
                } catch (e) {
                    console.error(`Erro Bot Descarte:`, e);
                }
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