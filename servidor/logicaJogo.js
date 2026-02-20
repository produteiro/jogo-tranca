const ordemValores = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const ordemSequencia = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]; // 2 entra como curinga ou natural

// ==========================================
// 🆕 GERAÇÃO DE IDS DESCRITIVOS
// ==========================================

function gerarIdCarta(face, naipe, origem) {
    // Mapeia naipes PT → EN
    const naipeMap = {
        'ouros': 'd',    // diamonds
        'copas': 'h',    // hearts
        'espadas': 's',  // spades
        'paus': 'c'      // clubs
    };
    
    // Mapeia cores PT → EN
    const corMap = {
        'vermelho': 'r', // red
        'azul': 'b'      // blue
    };
    
    const naipeCode = naipeMap[naipe] || naipe[0];
    const corCode = corMap[origem] || origem[0];
    
    return `${face}${naipeCode}${corCode}`;
}

function ordenarMaoServer(mao, modo = 'naipe') {
    if (!mao) return [];
    const maoLimpa = mao.filter(c => c !== null);
    
    return maoLimpa.sort((a, b) => {
        if (modo === 'valor') {
            const idxA = ordemValores.indexOf(a.face);
            const idxB = ordemValores.indexOf(b.face);
            if (idxA !== idxB) return idxA - idxB;
            return a.naipe.localeCompare(b.naipe);
        }
        // Modo Naipe (Padrão)
        if (a.naipe !== b.naipe) return a.naipe.localeCompare(b.naipe);
        return ordemValores.indexOf(a.face) - ordemValores.indexOf(b.face);
    });
}

function embaralhar(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ==========================================
// 🆕 ORDENAÇÃO INTELIGENTE DE JOGOS COM CORINGAS
// ==========================================
function ordenarJogoMesa(jogo) {
    if (!jogo || jogo.length <= 1) return jogo;

    // Tabela de pesos para a matemática dos buracos
    const valores = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

    // Separa os curingas ('2') das cartas normais
    const curingas = jogo.filter(c => c.face === '2');
    const normais = jogo.filter(c => c.face !== '2');

    if (normais.length === 0) return jogo; // Proteção para casos bizarros

    // Verifica se é uma TRINCA (todas as normais têm o mesmo número)
    const ehTrinca = normais.every(c => c.face === normais[0].face);
    if (ehTrinca) {
        // Se for trinca, a ordem não importa tanto, o curinga fica elegantemente no final
        return [...normais, ...curingas];
    }

    // Se é SEQUÊNCIA, primeiro ordenamos perfeitamente as cartas normais
    normais.sort((a, b) => valores[a.face] - valores[b.face]);

    if (curingas.length === 0) return normais;

    let resultado = [];
    let curingasUsados = 0;

    resultado.push(normais[0]);

    // O "Scanner de Buracos": Percorre a sequência procurando falhas numéricas
    for (let i = 1; i < normais.length; i++) {
        let valorAtual = valores[normais[i].face];
        let valorAnterior = valores[normais[i - 1].face];
        let diferenca = valorAtual - valorAnterior;

        // Encontrou um buraco! Insere o curinga exatamente no espaço vazio
        while (diferenca > 1 && curingasUsados < curingas.length) {
            resultado.push(curingas[curingasUsados]);
            curingasUsados++;
            diferenca--;
        }
        resultado.push(normais[i]);
    }

    // Se não havia buraco (ex: baixou [4, 5, 6, 2]), joga o curinga para as pontas
    while (curingasUsados < curingas.length) {
        let ultimaCarta = resultado[resultado.length - 1];
        
        // Se não bateu no teto (Ás = 14), o curinga finge ser a próxima carta maior (vai pro topo)
        if (ultimaCarta && ultimaCarta.face !== '2' && valores[ultimaCarta.face] < 14) {
            resultado.push(curingas[curingasUsados]);
        } else {
            // Se já tem um Ás no topo, o curinga finge ser a carta menor (vai pra base)
            resultado.unshift(curingas[curingasUsados]);
        }
        curingasUsados++;
    }

    return resultado;
}

function prepararPartida() {
    const naipes = ['copas', 'ouros', 'paus', 'espadas'];
    const faces = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']; 
    let baralho = [];
    
    // 1. Cria as cartas (2 Baralhos)
    ['azul', 'vermelho'].forEach(cor => {
        naipes.forEach(naipe => {
            faces.forEach(face => {
                let pts = (face === 'A') ? 15 : (face === '2' || ['8','9','10','J','Q','K'].includes(face)) ? 10 : 5;
                if (face === '3') pts = 5;
                
                baralho.push({ 
                    id: gerarIdCarta(face, naipe, cor), 
                    face, 
                    naipe, 
                    pontos: pts, 
                    origem: cor 
                });
            });
        });
    });

    // 2. Embaralha
    baralho = embaralhar(baralho);

    // 3. Inicializa o Objeto Jogo
    const jogo = {
        monte: [],
        lixo: [],
        morto1: [],
        morto2: [],
        maoJogador1: [],
        maoJogador2: [],
        maoJogador3: [],
        maoJogador4: [],
        jogosNaMesa: [[], []], 
        tresVermelhos: [[], []], 
        equipePegouMorto: [false, false],
        
        primeiraCompra: true,
        primeiraCompraJogador: -1,
        permitirRecompra: false,
        idCartaRecompra: null,
        obrigacaoTopoLixo: null,
        preferenciasOrdenacao: {} 
    };

    // 4. Distribui as Cartas
    for (let i = 0; i < 11; i++) jogo.morto1.push(baralho.pop());
    for (let i = 0; i < 11; i++) jogo.morto2.push(baralho.pop());

    for (let i = 0; i < 11; i++) {
        jogo.maoJogador1.push(baralho.pop());
        jogo.maoJogador2.push(baralho.pop());
        jogo.maoJogador3.push(baralho.pop());
        jogo.maoJogador4.push(baralho.pop());
    }
    
    jogo.lixo.push(baralho.pop());
    jogo.monte = baralho;

    // 5. CRUCIAL: Retorna o objeto
    return jogo;
}

// ... (Mantenha o resto do arquivo igual)

function verificarSeEncaixa(jogo, carta) {
    return validarJogo([...jogo, carta]);
}

function verificarPossibilidadeCompra(mao, topo, jogosMesa) {
    if (jogosMesa.some(j => verificarSeEncaixa(j, topo))) return true;
    for (let i = 0; i < mao.length; i++) {
        for (let j = i + 1; j < mao.length; j++) {
            if (validarJogo([mao[i], mao[j], topo])) return true;
        }
    }
    return false;
}

function separarTresVermelhos(mao) {
    const novaMao = [];
    const tresEncontrados = [];
    mao.forEach(c => {
        if (c.face === '3' && (c.naipe === 'copas' || c.naipe === 'ouros')) {
            tresEncontrados.push(c);
        } else {
            novaMao.push(c);
        }
    });
    return { novaMao, tresEncontrados };
}

function ehTresVermelho(c) {
    return c.face === '3' && (c.naipe === 'copas' || c.naipe === 'ouros');
}

// ==========================================
// 🆕 VALIDAÇÃO CORRIGIDA - TRINCAS SEM VERIFICAÇÃO DE NAIPE
// ==========================================
function validarJogo(cartas) {
    if (cartas.length < 3) return false;
    
    // Regra Tranca: Não pode trincas de 3
    if (cartas.some(c => c.face === '3') && cartas.every(c => c.face === '3')) return false;

    // 1. TENTATIVA DE TRINCA (Lavadeira)
    const facesNormais = cartas.filter(c => c.face !== '2').map(c => c.face);
    const uniqueFaces = [...new Set(facesNormais)];
    
    if (uniqueFaces.length === 1 && facesNormais.length > 0) {
        // É uma trinca - mesma face
        const curingas = cartas.filter(c => c.face === '2');
        
        // Máximo 1 curinga em trincas
        if (curingas.length > 1) return false;
        
        // 🆕 CORREÇÃO: REMOVIDA VERIFICAÇÃO DE NAIPES
        // Trincas podem ter cartas do MESMO naipe!
        // A regra original da Tranca permite isso.
        
        return true; // ✅ Trinca válida
    }

    // 2. TENTATIVA DE SEQUÊNCIA
    const cartasNormais = cartas.filter(c => c.face !== '2');
    const cartasDois = cartas.filter(c => c.face === '2');
    
    if (cartasNormais.length === 0) return false; 

    const naipeAlvo = cartasNormais[0].naipe;
    
    // Sequências devem ser do mesmo naipe
    if (cartasNormais.some(c => c.naipe !== naipeAlvo)) return false; 

    const doisDoNaipe = cartasDois.filter(c => c.naipe === naipeAlvo);
    const doisOutros = cartasDois.filter(c => c.naipe !== naipeAlvo);
    
    const testarSequenciaLogica = (listaNormais, qtdCuringas) => {
        if (qtdCuringas > 1) return false; 
        
        listaNormais.sort((a, b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));
        
        let buracos = 0;
        for (let i = 0; i < listaNormais.length - 1; i++) {
            const idxAtual = ordemSequencia.indexOf(listaNormais[i].face);
            const idxProx = ordemSequencia.indexOf(listaNormais[i+1].face);
            const diff = idxProx - idxAtual;
            
            if (diff === 0) return false; // Cartas duplicadas
            if (diff > 1) buracos += (diff - 1);
        }
        
        return buracos <= qtdCuringas;
    };

    // Testa com 2s do naipe como cartas naturais + curingas de outros naipes
    if (testarSequenciaLogica([...cartasNormais, ...doisDoNaipe], doisOutros.length)) {
        return true;
    }

    // 🆕 SUPORTE A A-2-3 COM DOIS CURINGAS
    // Se tiver A e 3, pode usar 2 curingas:
    // - Um como "2 natural" (fica no jogo)
    // - Outro como "substituto do buraco"
    if (doisDoNaipe.length > 0 && doisOutros.length === 0) {
        const umDoisViraCuringa = doisDoNaipe[0];
        const restoDoisNaturais = doisDoNaipe.slice(1);
        
        if (testarSequenciaLogica([...cartasNormais, ...restoDoisNaturais], 1)) {
            return true;
        }
    }
    
    return false;
}

function temCanastra(jogos) {
    return jogos.some(j => j.length >= 7);
}

function calcularPlacarParcial(sala) {
    const calc = (eq) => {
        let pts = 0;
        let canastrasLimpas = 0;
        let canastrasSujas = 0;
        
        sala.jogo.jogosNaMesa[eq].forEach(jogo => {
            pts += jogo.reduce((acc, c) => acc + c.pontos, 0);
            if (jogo.length >= 7) {
                const temCuringa = jogo.some(c => c.face === '2');
                if (temCuringa) {
                    pts += 100;
                    canastrasSujas++;
                } else {
                    pts += 200;
                    canastrasLimpas++;
                }
            }
        });
        
        const temC = temCanastra(sala.jogo.jogosNaMesa[eq]);
        const qtd3 = sala.jogo.tresVermelhos[eq].length;
        const pts3Vermelhos = qtd3 * (temC ? 100 : -100);
        pts += pts3Vermelhos;
        
        return { 
            total: pts, 
            canastrasLimpas, 
            canastrasSujas,
            pts3Vermelhos,
            pontosCartas: sala.jogo.jogosNaMesa[eq].reduce((acc, jogo) => 
                acc + jogo.reduce((sum, c) => sum + c.pontos, 0), 0)
        };
    };
    return { p1: calc(0), p2: calc(1) };
}

function calcularResultadoFinal(sala, eqBateu) {
    const parcial = calcularPlacarParcial(sala);
    const bonusBatida = (eq) => (eq === eqBateu ? 100 : 0);
    const punicaoMorto = (eq) => (!sala.jogo.equipePegouMorto[eq] ? -100 : 0);
    
    // Calcula pontos das cartas que ficaram na mão (negativos)
    const calcularPontosMao = (idxJogador1, idxJogador2) => {
        const mao1 = sala.jogo[`maoJogador${idxJogador1 + 1}`] || [];
        const mao2 = sala.jogo[`maoJogador${idxJogador2 + 1}`] || [];
        return -(mao1.reduce((acc, c) => acc + c.pontos, 0) + mao2.reduce((acc, c) => acc + c.pontos, 0));
    };
    
    const pontosMaoP1 = calcularPontosMao(0, 2); // Jogadores 1 e 3
    const pontosMaoP2 = calcularPontosMao(1, 3); // Jogadores 2 e 4
    
    return { 
        placar: { 
            p1: parcial.p1.total + bonusBatida(0) + punicaoMorto(0) + pontosMaoP1, 
            p2: parcial.p2.total + bonusBatida(1) + punicaoMorto(1) + pontosMaoP2
        },
        detalhes: { 
            p1: { 
                ptsBatida: bonusBatida(0), 
                ptsMorto: punicaoMorto(0), 
                ptsCartasMesa: parcial.p1.pontosCartas,
                ptsCanastrasLimpas: parcial.p1.canastrasLimpas * 200,
                ptsCanastrasSujas: parcial.p1.canastrasSujas * 100,
                pts3Vermelhos: parcial.p1.pts3Vermelhos,
                ptsCartasMao: pontosMaoP1
            },
            p2: { 
                ptsBatida: bonusBatida(1), 
                ptsMorto: punicaoMorto(1), 
                ptsCartasMesa: parcial.p2.pontosCartas,
                ptsCanastrasLimpas: parcial.p2.canastrasLimpas * 200,
                ptsCanastrasSujas: parcial.p2.canastrasSujas * 100,
                pts3Vermelhos: parcial.p2.pts3Vermelhos,
                ptsCartasMao: pontosMaoP2
            } 
        }
    };
}

// ==========================================
// 🆕 FUNÇÕES PARA O BOT - CORRIGIDAS
// ==========================================

function encontrarTrincas(mao) {
    const trincas = [];
    
    // Agrupa cartas por face (exceto 3 e 2)
    const grupos = {};
    mao.forEach((carta, idx) => {
        if (carta.face === '3') return; // Não pode trinca de 3
        if (carta.face === '2') return; // 2 não conta em trincas (é curinga)
        
        if (!grupos[carta.face]) grupos[carta.face] = [];
        grupos[carta.face].push(idx);
    });
    
    // Verifica cada grupo
    Object.values(grupos).forEach(indices => {
        // 🆕 CORREÇÃO: Aceita 3+ cartas da mesma face, SEM verificar naipes
        if (indices.length >= 3) {
            trincas.push(indices.slice(0, Math.min(indices.length, 4)));
        }
        
        // Também tenta com 2 cartas + 1 curinga (2)
        if (indices.length === 2) {
            // Procura um 2 (curinga)
            const idx2 = mao.findIndex((c, i) => c.face === '2' && !indices.includes(i));
            if (idx2 !== -1) {
                trincas.push([...indices, idx2]);
            }
        }
    });
    
    return trincas;
}

function encontrarSequencias(mao) {
    const sequencias = [];
    
    // Agrupa por naipe
    const gruposNaipe = { copas: [], ouros: [], paus: [], espadas: [] };
    mao.forEach((carta, idx) => {
        if (carta.face === '3') return; // 3 não entra em sequência normalmente
        gruposNaipe[carta.naipe].push({ idx, face: carta.face, carta });
    });
    
    // Para cada naipe, tenta encontrar sequências
    Object.entries(gruposNaipe).forEach(([naipe, cartas]) => {
        if (cartas.length < 3) return;
        
        // Separa 2s (curingas) de cartas normais
        const normais = cartas.filter(c => c.face !== '2');
        const doisDoNaipe = cartas.filter(c => c.face === '2');
        
        if (normais.length < 2) return;
        
        // Ordena as cartas normais
        normais.sort((a, b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));
        
        // Procura sequências de 3+ cartas
        for (let start = 0; start < normais.length - 1; start++) {
            const seq = [normais[start]];
            
            for (let i = start + 1; i < normais.length; i++) {
                const idxAtual = ordemSequencia.indexOf(seq[seq.length - 1].face);
                const idxProx = ordemSequencia.indexOf(normais[i].face);
                const diff = idxProx - idxAtual;
                
                if (diff === 1) {
                    // Sequência contínua
                    seq.push(normais[i]);
                } else if (diff === 2 && doisDoNaipe.length > 0) {
                    // Tem um buraco mas temos um 2 do mesmo naipe
                    seq.push(doisDoNaipe[0]); // Adiciona o curinga
                    seq.push(normais[i]);
                    break; // Só pode usar 1 curinga
                } else {
                    break; // Sequência quebrada
                }
            }
            
            if (seq.length >= 3) {
                sequencias.push(seq.map(c => c.idx));
            }
        }
        
        // Também tenta com curingas de outros naipes (máximo 1)
        const curingasOutros = mao
            .map((c, idx) => ({ carta: c, idx }))
            .filter(item => item.carta.face === '2' && item.carta.naipe !== naipe);
        
        if (curingasOutros.length > 0 && normais.length >= 2) {
            // Tenta adicionar curinga entre duas cartas
            for (let i = 0; i < normais.length - 1; i++) {
                const idxAtual = ordemSequencia.indexOf(normais[i].face);
                const idxProx = ordemSequencia.indexOf(normais[i + 1].face);
                const diff = idxProx - idxAtual;
                
                if (diff === 2) {
                    // Tem um buraco - pode usar curinga
                    sequencias.push([normais[i].idx, curingasOutros[0].idx, normais[i + 1].idx]);
                }
            }
        }
    });
    
    return sequencias;
}

    module.exports = { 
    prepararPartida, validarJogo, verificarSeEncaixa, separarTresVermelhos, 
    ehTresVermelho, ordenarMaoServer, ordenarJogoMesa, temCanastra, 
    calcularResultadoFinal, calcularPlacarParcial, verificarPossibilidadeCompra,
    encontrarTrincas, encontrarSequencias,
    gerarIdCarta  // ✅ Exporta a função
};





