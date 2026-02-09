const ordemValores = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const ordemSequencia = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]; // 2 fica de fora como curinga

function ordenarMaoServer(mao, modo = 'naipe') {
    if (!mao) return [];
    const maoLimpa = mao.filter(c => c !== null && c !== undefined);
    
    return maoLimpa.sort((a, b) => {
        if (modo === 'valor') {
            if (a.face !== b.face) {
                const idxA = ordemValores.indexOf(a.face);
                const idxB = ordemValores.indexOf(b.face);
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            }
            return a.naipe.localeCompare(b.naipe);
        } else {
            if (a.naipe !== b.naipe) return a.naipe.localeCompare(b.naipe);
            const idxA = ordemValores.indexOf(a.face);
            const idxB = ordemValores.indexOf(b.face);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        }
    });
}

function embaralhar(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function ordenarJogoMesa(cartas) {
    if (!cartas || cartas.length === 0) return [];
    const curingas = cartas.filter(c => c.face === '2');
    const naturais = cartas.filter(c => c.face !== '2');
    if (naturais.length === 0) return cartas;

    const naipeRef = naturais[0].naipe;
    const ehSequencia = naturais.every(c => c.naipe === naipeRef);

    if (!ehSequencia) return [...naturais, ...curingas];

    naturais.sort((a, b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));

    const resultado = [];
    let curingasUsados = 0;

    for (let i = 0; i < naturais.length; i++) {
        resultado.push(naturais[i]);
        if (i < naturais.length - 1) {
            const idxAtual = ordemSequencia.indexOf(naturais[i].face);
            const idxProx = ordemSequencia.indexOf(naturais[i+1].face);
            const gap = idxProx - idxAtual;
            if (gap === 2 && curingasUsados < curingas.length) {
                resultado.push(curingas[curingasUsados]);
                curingasUsados++;
            }
        }
    }
    while (curingasUsados < curingas.length) {
        resultado.push(curingas[curingasUsados]);
        curingasUsados++;
    }
    return resultado;
}

function prepararPartida() {
    const naipes = ['copas', 'ouros', 'paus', 'espadas'];
    const faces = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']; 
    const coresBaralhos = ['azul', 'vermelho'];
    
    let baralho = [];
    let idUnico = 1;

    coresBaralhos.forEach(cor => {
        naipes.forEach(naipe => {
            faces.forEach(face => {
                let pontos = 10;
                if (['4', '5', '6', '7'].includes(face)) pontos = 5;
                if (face === '2') pontos = 10;
                if (face === 'A') pontos = 15;
                if (face === '3') pontos = 5; 

                baralho.push({ id: idUnico++, face, naipe, pontos, origem: cor });
            });
        });
    });

    baralho = embaralhar(baralho);

    return {
        monte: baralho,
        lixo: [],
        maoJogador1: ordenarMaoServer(baralho.splice(0, 11), 'naipe'),
        maoJogador2: ordenarMaoServer(baralho.splice(0, 11), 'naipe'),
        maoJogador3: ordenarMaoServer(baralho.splice(0, 11), 'naipe'),
        maoJogador4: ordenarMaoServer(baralho.splice(0, 11), 'naipe'),
        morto1: baralho.splice(0, 11),
        morto2: baralho.splice(0, 11),
        tresVermelhos: [[], []], 
        jogosNaMesa: [[], []],
        equipePegouMorto: [false, false], 
        preferenciasOrdenacao: ['naipe', 'naipe', 'naipe', 'naipe'],
        primeiraJogada: true,
        cartaAguardandoDecisao: null,
        obrigacaoTopoLixo: null
    };
}

function verificarSeEncaixa(jogoAtual, cartaNova) {
    const jogoTeste = [...jogoAtual, cartaNova];
    return validarJogo(jogoTeste);
}

// --- LÓGICA DE COMPRA AUTOMÁTICA ---
function verificarPossibilidadeCompra(mao, cartaTopo, jogosMesa) {
    if (cartaTopo.face === '2') return true; // Curinga quase sempre serve (simplificação válida)

    // 1. Encaixa na Mesa?
    if (jogosMesa) {
        for (let jogo of jogosMesa) {
            if (verificarSeEncaixa(jogo, cartaTopo)) return true;
        }
    }

    // 2. Encaixa na Mão? (Justificativa)
    // Filtra curingas da mão para ajudar
    const curingasNaMao = mao.filter(c => c.face === '2');
    const cartasNormais = mao.filter(c => c.face !== '2');

    // A) Trinca (Pares Iguais)
    const iguais = cartasNormais.filter(c => c.face === cartaTopo.face);
    if (iguais.length >= 2) return true; // Tem 2 iguais + topo = Trinca
    if (iguais.length >= 1 && curingasNaMao.length >= 1) return true; // Tem 1 igual + 1 curinga + topo = Trinca

    // B) Sequência (Mesmo Naipe)
    const mesmoNaipe = cartasNormais.filter(c => c.naipe === cartaTopo.naipe);
    // Adiciona o topo para testar
    mesmoNaipe.push(cartaTopo);
    // Ordena
    mesmoNaipe.sort((a,b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));

    // Busca sequencia de 3 cartas diretas envolvendo o topo
    const topoIdx = ordemSequencia.indexOf(cartaTopo.face);
    let vizinhos = 0;
    
    // Verifica vizinhos diretos (ex: tem 4 e 5, topo é 6)
    // Precisamos de 2 vizinhos "conectados" ao topo para formar jogo sem curinga
    // Ou 1 vizinho + 1 curinga
    
    // Vamos usar força bruta de combinações de 3 cartas da mão + topo
    // Como a validação é rápida, testamos pares da mão + topo
    for (let i = 0; i < mao.length; i++) {
        for (let j = i + 1; j < mao.length; j++) {
            // Tenta formar jogo com 2 cartas da mão + a carta do topo
            const teste = [mao[i], mao[j], cartaTopo];
            if (validarJogo(teste)) return true;
        }
    }

    return false;
}

function ehTresVermelho(carta) {
    return carta && carta.face === '3' && (carta.naipe === 'copas' || carta.naipe === 'ouros');
}

function separarTresVermelhos(mao) {
    const tresEncontrados = [];
    const novaMao = [];
    if(!mao) return { novaMao: [], tresEncontrados: [] };
    mao.forEach(c => {
        if (ehTresVermelho(c)) tresEncontrados.push(c);
        else novaMao.push(c);
    });
    return { novaMao, tresEncontrados };
}

function validarJogo(cartas) {
    if (!cartas || cartas.length < 3) return false;
    if (cartas.some(c => c.face === '3')) return false;

    const curingas = cartas.filter(c => c.face === '2');
    const normais = cartas.filter(c => c.face !== '2');

    // Só curingas não pode (regra geral, as vezes tem variante, mas aqui bloqueamos)
    if (normais.length === 0) return false;

    const faceAlvo = normais[0].face;
    const ehTrinca = normais.every(c => c.face === faceAlvo);

    if (ehTrinca) {
        if (curingas.length > 1) return false; // Max 1 curinga em trinca
        return true;
    }

    // Validação de Sequência
    const naipeBase = normais[0].naipe;
    if (normais.some(c => c.naipe !== naipeBase)) return false; // Naipes misturados

    normais.sort((a,b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));

    let qtdCuringasDisponiveis = curingas.length;
    let usouCuringaComoWild = false;

    for (let i = 0; i < normais.length - 1; i++) {
        let indiceAtual = ordemSequencia.indexOf(normais[i].face);
        let indiceProximo = ordemSequencia.indexOf(normais[i+1].face);
        let buraco = indiceProximo - indiceAtual - 1;

        if (buraco < 0) return false; // Erro de ordenação ou duplicata
        if (buraco > 0) {
            // Tem buraco na sequencia (ex: 4 e 6)
            if (qtdCuringasDisponiveis >= buraco) {
                qtdCuringasDisponiveis -= buraco;
                if (usouCuringaComoWild) return false; // Já usou curinga pra outro buraco? (só pode 1 buraco preenchido por curinga tecnicamente, ou 1 curinga no jogo)
                // Regra Tranca: Apenas 1 curinga por jogo. 
                // Se o buraco for de 1 carta, gasta 1 curinga.
                if (buraco > 1) return false; // Buraco muito grande
                usouCuringaComoWild = true;
            } else {
                return false;
            }
        }
    }

    // Se sobrou curinga e já usou como wild no meio, não pode usar na ponta?
    // Regra simples: Max 1 curinga.
    if (curingas.length > 1) return false;
    
    return true;
}

function somarCartas(cartas) {
    return cartas.reduce((acc, c) => acc + c.pontos, 0);
}

function encontrarTrincas(mao) {
    const contagem = {};
    const jogos = [];
    mao.forEach((c, i) => {
        if (c.face !== '2' && c.face !== '3') {
            if (!contagem[c.face]) contagem[c.face] = [];
            contagem[c.face].push(i);
        }
    });
    for (let f in contagem) {
        if (contagem[f].length >= 3) jogos.push(contagem[f].slice(0, 3));
    }
    return jogos;
}

function encontrarSequencias(mao) {
    const jogos = [];
    const naipes = ['copas', 'ouros', 'paus', 'espadas'];
    const maoMapeada = mao.map((c, i) => ({ ...c, originalIndex: i }));

    naipes.forEach(naipe => {
        let cartas = maoMapeada.filter(c => c.naipe === naipe && c.face !== '2' && c.face !== '3');
        cartas.sort((a, b) => ordemSequencia.indexOf(a.face) - ordemSequencia.indexOf(b.face));

        let sequenciaAtual = [];
        for (let i = 0; i < cartas.length; i++) {
            if (sequenciaAtual.length === 0) {
                sequenciaAtual.push(cartas[i]);
            } else {
                let ultimo = sequenciaAtual[sequenciaAtual.length - 1];
                let atual = cartas[i];
                let diff = ordemSequencia.indexOf(atual.face) - ordemSequencia.indexOf(ultimo.face);

                if (diff === 1) {
                    sequenciaAtual.push(atual);
                } else if (diff > 1) {
                    if (sequenciaAtual.length >= 3) jogos.push(sequenciaAtual.map(c => c.originalIndex));
                    sequenciaAtual = [atual];
                }
            }
        }
        if (sequenciaAtual.length >= 3) jogos.push(sequenciaAtual.map(c => c.originalIndex));
    });
    return jogos;
}

function temCanastra(jogosEquipe) {
    return jogosEquipe.some(jogo => jogo.length >= 7);
}

function calcularPlacarParcial(sala) {
    const calcularParaEquipe = (idEquipe) => {
        let total = 0;
        const jogos = sala.jogo.jogosNaMesa[idEquipe];
        const tresVermelhos = sala.jogo.tresVermelhos[idEquipe];
        let possuiCanastra = false;

        let ptsCanastrasLimpas = 0;
        let ptsCanastrasSujas = 0;
        let ptsCartasMesa = 0;
        let pts3Vermelhos = 0;
        
        jogos.forEach(jogo => {
            ptsCartasMesa += somarCartas(jogo);
            if (jogo.length >= 7) {
                possuiCanastra = true;
                const temCuringa = jogo.some(c => c.face === '2');
                if (temCuringa) ptsCanastrasSujas += 100;
                else ptsCanastrasLimpas += 200;
            }
        });

        const qtdTres = tresVermelhos.length;
        if (possuiCanastra) {
            pts3Vermelhos = qtdTres * 100;
        } else {
            pts3Vermelhos = -(qtdTres * 100);
        }

        total = ptsCartasMesa + ptsCanastrasLimpas + ptsCanastrasSujas + pts3Vermelhos;

        return { 
            total, 
            detalhes: { ptsCartasMesa, ptsCanastrasLimpas, ptsCanastrasSujas, pts3Vermelhos, possuiCanastra } 
        };
    };

    return {
        p1: calcularParaEquipe(0),
        p2: calcularParaEquipe(1)
    };
}

function calcularResultadoFinal(sala, idEquipeBateu) {
    const placar = calcularPlacarParcial(sala);
    
    let p1 = placar.p1;
    let pontosMao1 = somarCartas(sala.jogo.maoJogador1) + somarCartas(sala.jogo.maoJogador3);
    let ptsBatida1 = (idEquipeBateu === 0) ? 100 : 0;
    let ptsMorto1 = (!sala.jogo.equipePegouMorto[0]) ? -100 : 0;

    p1.detalhes.ptsCartasMao = -pontosMao1;
    p1.detalhes.ptsBatida = ptsBatida1;
    p1.detalhes.ptsMorto = ptsMorto1;
    p1.total += (ptsBatida1 + ptsMorto1 - pontosMao1);

    let p2 = placar.p2;
    let pontosMao2 = somarCartas(sala.jogo.maoJogador2) + somarCartas(sala.jogo.maoJogador4);
    let ptsBatida2 = (idEquipeBateu === 1) ? 100 : 0;
    let ptsMorto2 = (!sala.jogo.equipePegouMorto[1]) ? -100 : 0;

    p2.detalhes.ptsCartasMao = -pontosMao2;
    p2.detalhes.ptsBatida = ptsBatida2;
    p2.detalhes.ptsMorto = ptsMorto2;
    p2.total += (ptsBatida2 + ptsMorto2 - pontosMao2);
    
    return {
        vencedor: p1.total > p2.total ? "Equipe 1 (Nós)" : "Equipe 2 (Eles)",
        placar: { p1: p1.total, p2: p2.total },
        detalhes: { p1: p1.detalhes, p2: p2.detalhes }
    };
}

module.exports = { 
    prepararPartida, validarJogo, verificarSeEncaixa, encontrarTrincas, encontrarSequencias, somarCartas, 
    separarTresVermelhos, ehTresVermelho, ordenarMaoServer, ordenarJogoMesa, temCanastra, 
    calcularPlacarParcial, calcularResultadoFinal, verificarPossibilidadeCompra
};