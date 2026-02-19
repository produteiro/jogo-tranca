const socket = io();
let meuIndex = -1;
let cartasSelecionadas = [];
let turnoAtivo = false;
let ultimaCartaCompradaId = null;
let ultimoEstadoSala = null;

const mapaNaipes = { 'copas': 'H', 'ouros': 'D', 'paus': 'C', 'espadas': 'S' };

function getImgUrl(c) {
    if (!c) return '';
    let f = c.face === '10' ? '0' : c.face;
    let n = mapaNaipes[c.naipe.toLowerCase()] || c.naipe[0];
    return `https://deckofcardsapi.com/static/img/${f}${n}.png`;
}

// --- LOGIN ---
window.onload = function() {
    const sessao = localStorage.getItem('tranca_sessao');
    if (sessao) {
        try {
            const user = JSON.parse(sessao);
            if(user && user.nome) socket.emit('loginAnonimo', user.nome);
        } catch(e) { console.error(e); }
    }
    
    // Garantia de Bind nos botões globais (caso o HTML não tenha onclick)
    const btnDescartar = document.getElementById('btn-descartar');
    if(btnDescartar) btnDescartar.onclick = acaoDescartar;
    
    const btnBaixar = document.getElementById('btn-baixar-jogo');
    if(btnBaixar) btnBaixar.onclick = acaoBaixar;
};

function jogarAnonimo() {
    const nome = 'Visitante-' + Math.floor(Math.random()*1000);
    socket.emit('loginAnonimo', nome);
}

function fazerLogin() { alert("Use o botão jogar como visitante."); }
function fazerLogout() { localStorage.removeItem('tranca_sessao'); location.reload(); }
function entrarModoTreino() { socket.emit('entrarSala', 'treino'); }
function pedirReset() { if(confirm("Reiniciar?")) socket.emit('resetJogo'); }

socket.on('loginSucesso', (user) => {
    localStorage.setItem('tranca_sessao', JSON.stringify(user));
    document.getElementById('tela-login').style.display = 'none';
    const lobby = document.getElementById('lobby');
    if(lobby) lobby.style.display = 'flex';
    else {
        document.getElementById('mesa').style.display = 'flex';
        socket.emit('entrarSala', 'treino');
    }
});

socket.on('estadoJogo', (sala) => {
    ultimoEstadoSala = sala;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('mesa').style.display = 'flex';
    document.getElementById('barra-ferramentas').style.display = 'flex';
    atualizarMesa(sala);
});

socket.on('cartaComprada', (dados) => {
    ultimaCartaCompradaId = dados.cartaId;
});

function atualizarMesa(sala) {
    if (!sala || !sala.jogo) return;

    meuIndex = sala.jogadores.findIndex(id => id === socket.id);
    if (meuIndex === -1 && sala.donos) meuIndex = sala.donos.findIndex(id => id === socket.id);
    if (meuIndex === -1) meuIndex = 0;

    turnoAtivo = (sala.vez === meuIndex);
    const estado = sala.estadoTurno;

    // Header
    const info = document.getElementById('info-jogo');
    if(info) {
        const nomeVez = turnoAtivo ? "SUA VEZ" : `VEZ DE: ${sala.jogadores[sala.vez] || 'BOT'}`;
        info.innerText = `${nomeVez} (${estado === 'comprando' ? 'COMPRAR' : 'JOGAR'})`;
        info.style.color = turnoAtivo ? '#f1c40f' : '#fff';
    }

    // 1. Placar com Ícone de Morto (Novo)
    atualizarPlacarComIndicadores(sala);

    // 2. Mesa, Lixo e Mortos Visuais (Novo)
    atualizarMonte(sala);
    atualizarLixo(sala, estado);
    atualizarVisualMortos(sala); // <-- Chama a função corrigida

    // Adversários
    const contagemMaos = sala.maosCount || [0,0,0,0];
    const idxDireita  = (meuIndex + 1) % 4;
    const idxTopo     = (meuIndex + 2) % 4;
    const idxEsquerda = (meuIndex + 3) % 4;
    
    desenharMaoAdversario('mao-direita', contagemMaos[idxDireita]);
    desenharMaoAdversario('mao-topo', contagemMaos[idxTopo]);
    desenharMaoAdversario('mao-esquerda', contagemMaos[idxEsquerda]);

    // Mão e Jogos
    renderizarMinhaMao(sala.jogo[`maoJogador${meuIndex+1}`]);

    const idEq = meuIndex % 2;
    renderizarJogos('meus-jogos', sala.jogo.jogosNaMesa[idEq], true);
    renderizarJogos('jogos-adversarios', sala.jogo.jogosNaMesa[(idEq + 1) % 2], false);
    
    renderizarTresVermelhos(sala);
    atualizarBotoesAcao(estado);
}

function atualizarMonte(sala) {
    const elMonte = document.getElementById('monte');
    const badge = document.getElementById('qtd-monte');
    const qtd = sala.jogo.monte.length;
    if(badge) badge.innerText = qtd;
    
    if (elMonte) {
        elMonte.style.opacity = (qtd === 0) ? '0.3' : '1';
        elMonte.classList.remove('ativo-brilhando');
        elMonte.onclick = null;
        if (turnoAtivo && sala.estadoTurno === 'comprando' && qtd > 0) {
            elMonte.classList.add('ativo-brilhando');
            elMonte.onclick = () => socket.emit('jogada', { acao: 'comprarMonte', dados: {} });
        }
    }
}

// --- CORREÇÃO PRINCIPAL: Permitir clique no lixo vazio para descarte ---
function atualizarLixo(sala, estado) {
    const divLixo = document.getElementById('carta-lixo');
    const areaLixo = document.getElementById('lixo');
    const badge = document.getElementById('qtd-lixo');
    const qtd = sala.jogo.lixo.length;
    if(badge) badge.innerText = qtd;
    
    divLixo.innerHTML = '';
    areaLixo.classList.remove('ativo-brilhando');
    
    // Configura o visual
    if (qtd > 0) {
        const topo = sala.jogo.lixo[qtd - 1];
        divLixo.innerHTML = `<div class="carta"><img src="${getImgUrl(topo)}"></div>`;
        if (turnoAtivo && estado === 'comprando') areaLixo.classList.add('ativo-brilhando');
    } else {
        divLixo.innerHTML = '<div style="color:rgba(255,255,255,0.2); font-size:12px;">LIXO</div>';
    }

    // Configura a interação (O bug estava aqui: não definia onclick se qtd == 0)
    areaLixo.onclick = () => {
        if (!turnoAtivo) return;
        
        console.log('👆 Clique no Lixo. Estado:', estado, 'Qtd:', qtd);

        if (estado === 'comprando') {
            if (qtd > 0) socket.emit('jogada', { acao: 'comprarLixo', dados: {} });
        } else if (estado === 'descartando') {
            // Permite descarte mesmo se o lixo estiver vazio
            acaoDescartar();
        }
    };
    
    // Cursor pointer se puder interagir
    if (turnoAtivo && (estado === 'descartando' || (estado === 'comprando' && qtd > 0))) {
        areaLixo.style.cursor = 'pointer';
    } else {
        areaLixo.style.cursor = 'default';
    }
}

function renderizarMinhaMao(cartas) {
    const div = document.getElementById('minha-mao');
    if(!div) return;
    div.innerHTML = '';
    cartas.forEach((c, i) => {
        const el = document.createElement('div');
        el.className = 'carta';
        if (cartasSelecionadas.includes(i)) el.classList.add('selecionada');
        if (c.id === ultimaCartaCompradaId) el.classList.add('nova-carta');
        el.innerHTML = `<img src="${getImgUrl(c)}">`;
        el.onclick = (e) => { e.stopPropagation(); toggleSelecao(i); };
        div.appendChild(el);
    });
}

function toggleSelecao(i) {
    if (cartasSelecionadas.includes(i)) cartasSelecionadas = cartasSelecionadas.filter(x=>x!==i);
    else cartasSelecionadas.push(i);
    renderizarMinhaMao(ultimoEstadoSala.jogo[`maoJogador${meuIndex+1}`]);
    atualizarBotoesAcao(ultimoEstadoSala.estadoTurno);
}

function renderizarJogos(idDiv, jogos, ehMeu) {
    const div = document.getElementById(idDiv);
    if (!div) return;
    
    // Mantém a marca d'água se existir
    const watermark = div.querySelector('.watermark');
    div.innerHTML = '';
    if (watermark) div.appendChild(watermark);
    
    if (!jogos) return;
    
    jogos.forEach((jogo, idxJogo) => {
        const grupo = document.createElement('div');
        grupo.className = 'grupo-baixado'; // O CSS cuida do layout horizontal
        
        if (ehMeu && turnoAtivo) {
            grupo.style.cursor = 'pointer';
            grupo.title = "Clique para adicionar cartas a este jogo";
            grupo.onclick = (e) => {
                e.stopPropagation();
                if (cartasSelecionadas.length > 0) {
                    const mao = ultimoEstadoSala?.jogo?.[`maoJogador${meuIndex + 1}`];
                    if (!mao) return;
                    
                    const ids = cartasSelecionadas.map(idx => mao[idx]?.id).filter(Boolean);
                    
                    socket.emit('jogada', { 
                        acao: 'baixarJogo', 
                        dados: { ids: ids, indexJogoMesa: idxJogo } 
                    });
                    
                    cartasSelecionadas = [];
                    atualizarVisualSelecao();
                }
            };
        }

        jogo.forEach(c => {
            const card = document.createElement('div');
            card.className = 'carta';
            card.innerHTML = `<img src="${getImgUrl(c)}">`;
            grupo.appendChild(card);
        });
        
        div.appendChild(grupo);
    });
}

function renderizarTresVermelhos(sala) {
    if(!sala.jogo.tresVermelhos) return;
    const desenhar = (idDiv, cartas) => {
        const div = document.getElementById(idDiv);
        if(!div || cartas.length === 0) return;
        const grp = document.createElement('div');
        grp.className = 'grupo-baixado tres-vermelhos-grupo';
        grp.style.border = '2px dashed #e74c3c';
        cartas.forEach(c => {
            const el = document.createElement('div');
            el.className = 'carta tres-vermelho-bonus';
            el.innerHTML = `<img src="${getImgUrl(c)}">`;
            grp.appendChild(el);
        });
        div.prepend(grp);
    };
    desenhar('meus-jogos', sala.jogo.tresVermelhos[meuIndex%2]);
    desenhar('jogos-adversarios', sala.jogo.tresVermelhos[(meuIndex+1)%2]);
}

function desenharMaoAdversario(idDiv, qtd) {
    const div = document.getElementById(idDiv);
    if(!div) return;
    Array.from(div.children).forEach(c => { if(c.classList.contains('carta-miniatura')) c.remove(); });
    for(let i=0; i<qtd; i++) {
        const c = document.createElement('div');
        c.className = 'carta-miniatura';
        div.appendChild(c);
    }
}

function atualizarBotoesAcao(estado) {
    const btnBaixar = document.getElementById('btn-baixar-jogo');
    const btnDescartar = document.getElementById('btn-descartar');
    const btnLimpar = document.getElementById('btn-limpar-selecao');
    
    if(!btnBaixar) return;
    btnBaixar.style.display = 'none';
    btnDescartar.style.display = 'none';
    btnLimpar.style.display = 'none';
    
    if(!turnoAtivo) return;
    
    if(cartasSelecionadas.length > 0) btnLimpar.style.display = 'inline-block';
    
    if(estado === 'descartando') {
        if(cartasSelecionadas.length >= 3) btnBaixar.style.display = 'inline-block';
        if(cartasSelecionadas.length === 1) btnDescartar.style.display = 'inline-block';
    }
}

// Ações Globais
window.acaoDescartar = function() {
    if (!turnoAtivo) {
        console.log("❌ Tentativa de descarte fora da vez.");
        return;
    }
    
    if (cartasSelecionadas.length !== 1) {
        alert("Selecione EXATAMENTE 1 carta para descartar.");
        return;
    }
    
    const indexCarta = cartasSelecionadas[0];
    const mao = ultimoEstadoSala?.jogo?.[`maoJogador${meuIndex + 1}`];
    
    if (!mao || !mao[indexCarta]) {
        console.error('❌ Carta não encontrada na mão');
        return;
    }
    
    const cartaId = mao[indexCarta].id;
    console.log(`🗑️ Enviando descarte: Index ${indexCarta} → ID ${cartaId}`);
    
    socket.emit('jogada', { 
        acao: 'descartar', 
        dados: { id: cartaId } 
    });
    
    cartasSelecionadas = [];
    ultimaCartaCompradaId = null;
    
    const btnDescartar = document.getElementById('btn-descartar');
    if(btnDescartar) btnDescartar.style.display = 'none';
};

window.acaoBaixar = function() {
    if(cartasSelecionadas.length < 3) return alert("Selecione 3+ cartas");
    
    const mao = ultimoEstadoSala?.jogo?.[`maoJogador${meuIndex + 1}`];
    if (!mao) return;
    
    const ids = cartasSelecionadas.map(idx => mao[idx]?.id).filter(Boolean);
    
    console.log('📥 Baixando jogo com IDs:', ids);
    
    socket.emit('jogada', { 
        acao: 'baixarJogo', 
        dados: { 
            ids: ids, 
            indexJogoMesa: null 
        } 
    });
    
    cartasSelecionadas = [];
};

window.acaoLimpar = function() { cartasSelecionadas = []; renderizarMinhaMao(ultimoEstadoSala.jogo[`maoJogador${meuIndex+1}`]); atualizarBotoesAcao(ultimoEstadoSala.estadoTurno); };
window.acaoOrdenar = function() { socket.emit('jogada', { acao: 'ordenar', dados: {} }); };
window.pedirReset = function() { if(confirm('Reiniciar?')) socket.emit('resetJogo'); };
window.fazerLogout = function() { localStorage.removeItem('tranca_sessao'); location.reload(); };
window.jogarAnonimo = jogarAnonimo;
window.fazerLogin = fazerLogin;
window.entrarModoTreino = entrarModoTreino;

// Aliases para onclick no HTML
window.tentarBaixarJogo = window.acaoBaixar;
window.descartarCartaSelecionadas = window.acaoDescartar;
window.limparSelecao = window.acaoLimpar;
window.alternarOrdenacao = window.acaoOrdenar;

// Chat
window.toggleChat = function() {
    const chat = document.getElementById('janela-chat');
    chat.style.display = (chat.style.display === 'none') ? 'flex' : 'none';
};
window.enviarMensagem = function() {
    const input = document.getElementById('chat-input');
    if(input && input.value.trim()) {
        socket.emit('enviarChat', input.value.trim());
        input.value = '';
    }
};

socket.on('receberChat', (dados) => {
    const div = document.getElementById('chat-msgs');
    if(div) {
        const p = document.createElement('div');
        if(dados.sistema) { p.style.color = '#f1c40f'; p.innerText = dados.msg; }
        else { p.innerHTML = `<strong>${dados.nome}:</strong> ${dados.msg}`; }
        div.appendChild(p);
        div.scrollTop = div.scrollHeight;
    }
});

socket.on('fimDeJogo', (dados) => {
    console.log('🏁 FIM DE JOGO:', dados);
    const modal = document.getElementById('modal-fim');
    if (!modal) return;
    
    modal.style.display = 'flex';
    
    const preencher = (prefixo, d) => {
        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.innerText = val;
        };

        if (!d) return;

        setTxt(prefixo + '-batida', d.ptsBatida || 0);
        setTxt(prefixo + '-morto', d.ptsMorto || 0);
        setTxt(prefixo + '-limpa', d.ptsCanastrasLimpas || 0);
        setTxt(prefixo + '-suja', d.ptsCanastrasSujas || 0);
        setTxt(prefixo + '-3ver', d.pts3Vermelhos || 0);
        
        const totalCartas = (d.ptsCartasMao || 0) + (d.ptsCartasMesa || 0);
        setTxt(prefixo + '-cartas', totalCartas);
    };

    if (dados.detalhes) {
        preencher('p1', dados.detalhes.p1);
        preencher('p2', dados.detalhes.p2);
    }
    
    if (dados.placar) {
        const elTotalP1 = document.getElementById('p1-total');
        const elTotalP2 = document.getElementById('p2-total');
        if(elTotalP1) elTotalP1.innerText = dados.placar.p1;
        if(elTotalP2) elTotalP2.innerText = dados.placar.p2;
    }
});

function atualizarVisualSelecao() {
    if (!ultimoEstadoSala || meuIndex === -1) return;
    renderizarMinhaMao(ultimoEstadoSala.jogo[`maoJogador${meuIndex+1}`]);
    atualizarBotoesAcao(ultimoEstadoSala.estadoTurno);
}

function jogarNovamente() {
    console.log('🔄 Iniciando nova partida...');
    const modalFim = document.getElementById('modal-fim');
    if (modalFim) modalFim.style.display = 'none';
    
    meuIndex = -1;
    turnoAtivo = false;
    cartasSelecionadas = [];
    ultimoEstadoSala = null;
    
    socket.emit('resetJogo');
}
window.jogarNovamente = jogarNovamente;

// --- MELHORIA 1: VISUAL DO MORTO (Corrigido ID 'area-mortos') ---
function atualizarVisualMortos(sala) {
    // Busca pelo ID correto que está no seu HTML
    const divMortos = document.getElementById('area-mortos');
    if (!divMortos) return;

    // Limpa o conteúdo estático (as divs antigas morto1/morto2 somem aqui)
    divMortos.innerHTML = ''; 

    // Se Morto 1 ainda existe no servidor
    if (sala.jogo.morto1 && sala.jogo.morto1.length > 0) {
        const imgM1 = document.createElement('img');
        imgM1.src = 'https://deckofcardsapi.com/static/img/back.png';
        imgM1.className = 'carta-morto';
        // Posicionamento visual
        imgM1.style.cssText = 'width: 70px; position: absolute; left: 10px; top: 10px; border-radius: 5px; box-shadow: 2px 2px 5px black;';
        divMortos.appendChild(imgM1);
    }

    // Se Morto 2 ainda existe no servidor
    if (sala.jogo.morto2 && sala.jogo.morto2.length > 0) {
        const imgM2 = document.createElement('img');
        imgM2.src = 'https://deckofcardsapi.com/static/img/back.png';
        imgM2.className = 'carta-morto';
        // Cruzado/Rotacionado visualmente
        imgM2.style.cssText = 'width: 70px; position: absolute; left: 25px; top: 5px; transform: rotate(90deg); border-radius: 5px; box-shadow: 2px 2px 5px black;';
        divMortos.appendChild(imgM2);
    }
}

// --- MELHORIA 2: PLACAR COM INDICADOR DE QUEM PEGOU O MORTO ---
function atualizarPlacarComIndicadores(sala) {
    if (!sala.placarCalculado) return;

    const idMinhaEquipe = meuIndex % 2; 
    const idEquipeAdv = (idMinhaEquipe + 1) % 2;

    const ptsNos = (idMinhaEquipe === 0) ? sala.placarCalculado.p1.total : sala.placarCalculado.p2.total;
    const ptsEles = (idMinhaEquipe === 0) ? sala.placarCalculado.p2.total : sala.placarCalculado.p1.total;

    // Verifica status do morto
    const nosPegamosMorto = sala.jogo.equipePegouMorto[idMinhaEquipe];
    const elesPegaramMorto = sala.jogo.equipePegouMorto[idEquipeAdv];

    // Ícone de "Check" verde se pegou
    const icone = ' <span style="color:#2ecc71; font-size:16px; margin-left:5px;" title="Pegou o morto">✅</span>';

    // Atualiza HTML
    const elNos = document.getElementById('pts-nos');
    const elEles = document.getElementById('pts-eles');
    
    if(elNos) elNos.innerHTML = ptsNos + (nosPegamosMorto ? icone : '');
    if(elEles) elEles.innerHTML = ptsEles + (elesPegaramMorto ? icone : '');
}

// --- MELHORIA: VISUAL DO MORTO EM CRUZ CENTRALIZADA ---
function atualizarVisualMortos(sala) {
    const divMortos = document.getElementById('area-mortos');
    if (!divMortos) return;

    divMortos.innerHTML = ''; 

    // Estilo base comum para centralizar absolutamente
    const estiloBase = 'width: 75px; position: absolute; left: 50%; top: 50%; border-radius: 6px; box-shadow: 2px 2px 8px rgba(0,0,0,0.6); transition: all 0.3s ease;';

    // Morto 1: Vertical (Fundo)
    if (sala.jogo.morto1 && sala.jogo.morto1.length > 0) {
        const imgM1 = document.createElement('img');
        imgM1.src = 'https://deckofcardsapi.com/static/img/back.png';
        imgM1.className = 'carta-morto';
        // Centraliza exato no meio
        imgM1.style.cssText = `${estiloBase} transform: translate(-50%, -50%); z-index: 1;`;
        divMortos.appendChild(imgM1);
    }

    // Morto 2: Horizontal (Topo, Cruzado)
    if (sala.jogo.morto2 && sala.jogo.morto2.length > 0) {
        const imgM2 = document.createElement('img');
        imgM2.src = 'https://deckofcardsapi.com/static/img/back.png';
        imgM2.className = 'carta-morto';
        // Centraliza e rotaciona 90 graus
        imgM2.style.cssText = `${estiloBase} transform: translate(-50%, -50%) rotate(90deg); z-index: 2;`;
        divMortos.appendChild(imgM2);
    }
}

