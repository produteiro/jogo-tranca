const ordemValores = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const ordemSequencia = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]; // 2 entra como curinga ou natural

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

// Função visual para organizar a mesa (coloca curingas no fim ou lugar certo)
function ordenarJogoMesa(cartas) {
    // Separa curingas (2) de cartas normais
    const curingas = cartas.filter(c => c.face === '2');
    const normais = cartas.filter(c => c.face !== '2');

    if (normais.length === 0) return cartas; // Só tem 2 (raro, mas possível em testes)

    // Tenta identificar o naipe predominante
    const naipe = normais[0].naipe;
    const ehSequenciaPura = normais.every(c => c.naipe === naipe);

    if (ehSequenciaPura) {
        // Ordena as normais
        normais.sort((a, b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));
        
        // Se tiver curinga, precisamos ver se algum curinga é, na verdade, um 2 do mesmo naipe (natural)
        const jogoFinal = [];
        let curingasRestantes = [...curingas];

        // Se houver um buraco onde cabe um 2 natural, usamos ele
        // Lógica simplificada para visualização: Coloca Sequencia + Curingas no final
        // (Isso evita erros visuais. A validação lógica já foi feita antes)
        return [...normais, ...curingas];
    }
    
    // Se for trinca (lavadeira), apenas agrupa
    return [...normais, ...curingas];
}

function prepararPartida() {
    const naipes = ['copas', 'ouros', 'paus', 'espadas'];
    const faces = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']; 
    let baralho = [];
    let id = 1;
    ['azul', 'vermelho'].forEach(cor => {
        naipes.forEach(naipe => {
            faces.forEach(face => {
                // Pontuação Tranca: A=15, 2=10, 8-K=10, 3-7=5
                let pts = (face === 'A') ? 15 : (face === '2' || ['8','9','10','J','Q','K'].includes(face)) ? 10 : 5;
                if (face === '3') pts = 5; // 3 vale 5 (exceto se for vermelho sozinho, tratado na contagem)
                baralho.push({ id: id++, face, naipe, pontos: pts, origem: cor });
            });
        });
    });
    baralho = embaralhar(baralho);
    return {
        monte: baralho, lixo: [],
        maoJogador1: ordenarMaoServer(baralho.splice(0, 11)),
        maoJogador2: ordenarMaoServer(baralho.splice(0, 11)),
        maoJogador3: ordenarMaoServer(baralho.splice(0, 11)),
        maoJogador4: ordenarMaoServer(baralho.splice(0, 11)),
        morto1: baralho.splice(0, 11), morto2: baralho.splice(0, 11),
        tresVermelhos: [[], []], jogosNaMesa: [[], []], equipePegouMorto: [false, false],
        obrigacaoTopoLixo: null, idsMaoAntesDaCompra: null,
        preferenciasOrdenacao: { 0: 'naipe', 1: 'naipe', 2: 'naipe', 3: 'naipe' }
    };
}

function verificarSeEncaixa(jogo, carta) {
    return validarJogo([...jogo, carta]);
}

function verificarPossibilidadeCompra(mao, topo, jogosMesa) {
    // 1. Verifica se encaixa em jogos existentes
    if (jogosMesa.some(j => verificarSeEncaixa(j, topo))) return true;
    
    // 2. Verifica se forma jogo novo com cartas da mão
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

// --- CORAÇÃO DA VALIDAÇÃO (CORRIGIDO) ---
function validarJogo(cartas) {
    if (cartas.length < 3) return false;
    
    // Regra Tranca: Não pode trincas de 3 em hipótese alguma
    if (cartas.some(c => c.face === '3') && cartas.every(c => c.face === '3')) return false;

    // 1. TENTATIVA DE TRINCA (Lavadeira) - Mesma face, naipes diferentes
    // (Ignorando 2 como curinga por um momento para checar a "intenção")
    const facesNormais = cartas.filter(c => c.face !== '2').map(c => c.face);
    const uniqueFaces = [...new Set(facesNormais)];
    
    // Se só tem 1 tipo de face (ex: tudo Rei) e não é vazio
    if (uniqueFaces.length === 1 && facesNormais.length > 0) {
        const curingas = cartas.filter(c => c.face === '2');
        if (curingas.length > 1) return false; // Trincas aceitam no máximo 1 curinga
        
        // Verifica naipes (não pode repetir naipe em trinca)
        const naipesNormais = cartas.filter(c => c.face !== '2').map(c => c.naipe);
        const naipesUnicos = [...new Set(naipesNormais)];
        if (naipesUnicos.length !== naipesNormais.length) return false; 
        
        return true;
    }

    // 2. TENTATIVA DE SEQUÊNCIA (Mesmo naipe)
    // Precisamos lidar com o fato de que um '2' pode ser o curinga OU a carta natural (2,3,4)
    
    const cartasNormais = cartas.filter(c => c.face !== '2');
    const cartasDois = cartas.filter(c => c.face === '2');
    
    if (cartasNormais.length === 0) return false; // Só tem 2? Não pode.

    // Verifica se todas as normais são do mesmo naipe
    const naipeAlvo = cartasNormais[0].naipe;
    if (cartasNormais.some(c => c.naipe !== naipeAlvo)) return false; // Naipes misturados

    // Agora o teste difícil: Tentar encaixar os 2s
    // Um 2 do mesmo naipe PODE ser natural. Qualquer outro 2 É curinga.
    
    const doisDoNaipe = cartasDois.filter(c => c.naipe === naipeAlvo);
    const doisOutros = cartasDois.filter(c => c.naipe !== naipeAlvo);
    
    // Função auxiliar para testar buracos
    const testarSequenciaLogica = (listaNormais, qtdCuringas) => {
        if (qtdCuringas > 1) return false; // Máximo 1 curinga

        // Ordena pelo valor lógico (3..A)
        listaNormais.sort((a, b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));
        
        let buracos = 0;
        for (let i = 0; i < listaNormais.length - 1; i++) {
            const idxAtual = ordemSequencia.indexOf(listaNormais[i].face);
            const idxProx = ordemSequencia.indexOf(listaNormais[i+1].face);
            
            const diff = idxProx - idxAtual;
            if (diff === 0) return false; // Carta repetida (ex: 4 e 4)
            if (diff > 1) buracos += (diff - 1);
        }
        
        // O número de buracos deve ser coberto exatamente pelos curingas?
        // Na verdade, o curinga cobre 1 buraco. Se sobrar curinga, ele vai na ponta.
        // Se faltar curinga, falha.
        return buracos <= qtdCuringas;
    };

    // CENÁRIO A: Usar todos os 2 do naipe como cartas NATURAIS
    // Curingas disponíveis = apenas os 2 de outros naipes
    if (testarSequenciaLogica([...cartasNormais, ...doisDoNaipe], doisOutros.length)) {
        return true;
    }

    // CENÁRIO B: Usar UM 2 do naipe como CURINGA (apenas se não houver outro curinga externo)
    // Isso é necessário se tivermos 3, 4, 5 de Ouros e um 2 de Ouros, mas queremos usar o 2 como curinga
    // (embora matematicamente seja melhor usar como 2, às vezes a ponta exige)
    if (doisDoNaipe.length > 0 && doisOutros.length === 0) {
        // Pega um 2 do naipe para ser curinga
        const umDoisViraCuringa = doisDoNaipe[0];
        const restoDoisNaturais = doisDoNaipe.slice(1);
        
        // Curingas disponíveis = 1 (o que escolhemos)
        if (testarSequenciaLogica([...cartasNormais, ...restoDoisNaturais], 1)) {
            return true;
        }
    }

    return false;
}

function temCanastra(jogos) {
    // Canastra é jogo com 7 ou mais cartas
    return jogos.some(j => j.length >= 7);
}

function calcularPlacarParcial(sala) {
    const calc = (eq) => {
        let pts = 0;
        sala.jogo.jogosNaMesa[eq].forEach(jogo => {
            // Soma pontos das cartas
            pts += jogo.reduce((acc, c) => acc + c.pontos, 0);
            
            // Bônus de Canastra
            if (jogo.length >= 7) {
                const temCuringa = jogo.some(c => c.face === '2');
                // Em Tranca/Buraco: Canastra Limpa (sem 2) = 200, Suja (com 2) = 100
                // EXCEÇÃO: Se a canastra tem um 2 que é do mesmo naipe e encaixa na sequencia (limpa), 
                // a lógica visual pode marcar como suja se não formos cuidadosos.
                // Simplificação: Se tem face '2', considera suja para pontuação padrão.
                // (Para ser "Limpa Real" com 2, precisaria verificar se o 2 é natural, mas a regra comum diz: usou 2 vira suja, exceto se for sequencia exata A-2-3 sem buraco)
                pts += temCuringa ? 100 : 200; 
            }
        });
        
        // Bônus/Penalidade 3 Vermelho
        // Se tiver canastra, soma. Se não, subtrai.
        const temC = temCanastra(sala.jogo.jogosNaMesa[eq]);
        const qtd3 = sala.jogo.tresVermelhos[eq].length;
        pts += qtd3 * (temC ? 100 : -100);
        
        return { total: pts };
    };
    return { p1: calc(0), p2: calc(1) };
}

function calcularResultadoFinal(sala, eqBateu) {
    const parcial = calcularPlacarParcial(sala);
    
    const bonusBatida = (eq) => (eq === eqBateu ? 100 : 0);
    const punicaoMorto = (eq) => (!sala.jogo.equipePegouMorto[eq] ? -100 : 0);

    return { 
        placar: { 
            p1: parcial.p1.total + bonusBatida(0) + punicaoMorto(0), 
            p2: parcial.p2.total + bonusBatida(1) + punicaoMorto(1) 
        },
        detalhes: { 
            p1: { 
                ptsBatida: bonusBatida(0), 
                ptsMorto: punicaoMorto(0), 
                ptsCartasMesa: parcial.p1.total, 
                // Detalhes extras podem ser calculados se necessário
                ptsCanastrasLimpas: 0, 
                ptsCanastrasSujas: 0, 
                pts3Vermelhos: 0, 
                ptsCartasMao: 0 
            },
            p2: { 
                ptsBatida: bonusBatida(1), 
                ptsMorto: punicaoMorto(1), 
                ptsCartasMesa: parcial.p2.total, 
                ptsCartasMao: 0 
            } 
        }
    };
}

// Pequenas funções auxiliares de detecção para bots
function encontrarTrincas(mao) { return []; } // Implementar se quiser bots inteligentes
function encontrarSequencias(mao) { return []; } // Implementar se quiser bots inteligentes

module.exports = { 
    prepararPartida, validarJogo, verificarSeEncaixa, separarTresVermelhos, 
    ehTresVermelho, ordenarMaoServer, ordenarJogoMesa, temCanastra, 
    calcularResultadoFinal, calcularPlacarParcial, verificarPossibilidadeCompra,
    encontrarTrincas, encontrarSequencias 
};
