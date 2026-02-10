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

// Função visual para organizar a mesa
function ordenarJogoMesa(cartas) {
    const curingas = cartas.filter(c => c.face === '2');
    const normais = cartas.filter(c => c.face !== '2');

    if (normais.length === 0) return cartas; 

    const naipe = normais[0].naipe;
    const ehSequenciaPura = normais.every(c => c.naipe === naipe);

    if (ehSequenciaPura) {
        normais.sort((a, b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));
        return [...normais, ...curingas];
    }
    
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
                let pts = (face === 'A') ? 15 : (face === '2' || ['8','9','10','J','Q','K'].includes(face)) ? 10 : 5;
                if (face === '3') pts = 5; 
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

// --- VALIDAÇÃO INTELIGENTE ---
function validarJogo(cartas) {
    if (cartas.length < 3) return false;
    
    // Regra Tranca: Não pode trincas de 3
    if (cartas.some(c => c.face === '3') && cartas.every(c => c.face === '3')) return false;

    // 1. TENTATIVA DE TRINCA (Lavadeira)
    const facesNormais = cartas.filter(c => c.face !== '2').map(c => c.face);
    const uniqueFaces = [...new Set(facesNormais)];
    
    if (uniqueFaces.length === 1 && facesNormais.length > 0) {
        const curingas = cartas.filter(c => c.face === '2');
        if (curingas.length > 1) return false; 
        const naipesNormais = cartas.filter(c => c.face !== '2').map(c => c.naipe);
        const naipesUnicos = [...new Set(naipesNormais)];
        if (naipesUnicos.length !== naipesNormais.length) return false; 
        return true;
    }

    // 2. TENTATIVA DE SEQUÊNCIA
    const cartasNormais = cartas.filter(c => c.face !== '2');
    const cartasDois = cartas.filter(c => c.face === '2');
    
    if (cartasNormais.length === 0) return false; 

    const naipeAlvo = cartasNormais[0].naipe;
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
            if (diff === 0) return false; 
            if (diff > 1) buracos += (diff - 1);
        }
        return buracos <= qtdCuringas;
    };

    if (testarSequenciaLogica([...cartasNormais, ...doisDoNaipe], doisOutros.length)) {
        return true;
    }

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
        sala.jogo.jogosNaMesa[eq].forEach(jogo => {
            pts += jogo.reduce((acc, c) => acc + c.pontos, 0);
            if (jogo.length >= 7) {
                const temCuringa = jogo.some(c => c.face === '2');
                pts += temCuringa ? 100 : 200; 
            }
        });
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
            p1: { ptsBatida: bonusBatida(0), ptsMorto: punicaoMorto(0), ptsCartasMesa: parcial.p1.total, ptsCanastrasLimpas: 0, ptsCanastrasSujas: 0, pts3Vermelhos: 0, ptsCartasMao: 0 },
            p2: { ptsBatida: bonusBatida(1), ptsMorto: punicaoMorto(1), ptsCartasMesa: parcial.p2.total, ptsCartasMao: 0 } 
        }
    };
}

function encontrarTrincas(mao) { return []; } 
function encontrarSequencias(mao) { return []; }

module.exports = { 
    prepararPartida, validarJogo, verificarSeEncaixa, separarTresVermelhos, 
    ehTresVermelho, ordenarMaoServer, ordenarJogoMesa, temCanastra, 
    calcularResultadoFinal, calcularPlacarParcial, verificarPossibilidadeCompra,
    encontrarTrincas, encontrarSequencias 
};
