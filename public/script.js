const socket = io();

// --- SISTEMA DE SESSÃO PERSISTENTE ---
let meuUid = localStorage.getItem('tranca_uid');
if (!meuUid) {
    meuUid = 'usr_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('tranca_uid', meuUid);
}

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

// --- ESCUTADORES DO SISTEMA ---
socket.on('connect', () => {
    console.log("🔌 Conectado/Reconectado ao servidor!");
    const sessao = localStorage.getItem('tranca_sessao');
    if (sessao) {
        try {
            const user = JSON.parse(sessao);
            if(user && user.nome) {
                socket.emit('loginAnonimo', { nome: user.nome, uid: meuUid });
            }
        } catch(e) { console.error(e); }
    }
});

socket.on('erroJogo', (msg) => { 
    alert("❌ AÇÃO INVÁLIDA:\n\n" + msg); 
});

// --- FUNÇÕES DE LOGIN E NAVEGAÇÃO ---
window.jogarAnonimo = function() {
    const nome = 'Visitante-' + Math.floor(Math.random()*1000);
    socket.emit('loginAnonimo', { nome: nome, uid: meuUid });
};

socket.on('loginSucesso', (user) => {
    localStorage.setItem('tranca_sessao', JSON.stringify(user));
    document.getElementById('tela-login').style.display = 'none';
    
    const emPartidaAtiva = localStorage.getItem('tranca_sala_ativa'); 
    if (emPartidaAtiva === 'treino') {
        socket.emit('entrarSala', 'treino');
        return;
    }
    
    const lobby = document.getElementById('lobby');
    if(lobby) lobby.style.display = 'flex';
});

window.entrarModoTreino = function() { 
    localStorage.setItem('tranca_sala_ativa', 'treino'); 
    const lobby = document.getElementById('lobby');
    if(lobby) lobby.style.display = 'none';
    socket.emit('entrarSala', 'treino'); 
};

window.fazerLogout = function() { 
    localStorage.removeItem('tranca_sessao'); 
    localStorage.removeItem('tranca_sala_ativa'); 
    location.reload(); 
};
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

    const info = document.getElementById('info-jogo');
    if(info) {
        const nomeVez = turnoAtivo ? "SUA VEZ" : `VEZ DE: ${sala.jogadores[sala.vez] || 'BOT'}`;
        info.innerText = `${nomeVez} (${estado === 'comprando' ? 'COMPRAR' : 'JOGAR'})`;
        info.style.color = turnoAtivo ? '#f1c40f' : '#fff';
    }

    atualizarPlacarComIndicadores(sala);
    atualizarMonte(sala);
    atualizarLixo(sala, estado);
    atualizarVisualMortos(sala);

    const contagemMaos = sala.maosCount || [0,0,0,0];
    const idxDireita  = (meuIndex + 1) % 4;
    const idxTopo     = (meuIndex + 2) % 4;
    const idxEsquerda = (meuIndex + 3) % 4;
    
    desenharMaoAdversario('mao-direita', contagemMaos[idxDireita]);
    desenharMaoAdversario('mao-topo', contagemMaos[idxTopo]);
    desenharMaoAdversario('mao-esquerda', contagemMaos[idxEsquerda]);

    renderizarMinhaMao(sala.jogo[`maoJogador${meuIndex+1}`]);

    const idEq = meuIndex % 2;
    renderizarJogos('meus-jogos', sala.jogo.jogosNaMesa[idEq], true);
    renderizarJogos('meus-jogos', sala.jogo.jogosNaMesa[idEq], true);
    renderizarJogos('jogos-adversarios', sala.jogo.jogosNaMesa[(idEq + 1) % 2], false);
    
    // --- NOVO: CLIQUE NA ÁREA VAZIA PARA BAIXAR NOVO JOGO ---
    const divMeusJogos = document.getElementById('meus-jogos');
    if (divMeusJogos) {
        divMeusJogos.style.cursor = (turnoAtivo && estado === 'descartando' && cartasSelecionadas.length >= 3) ? 'pointer' : 'default';
        
        divMeusJogos.onclick = (e) => {
            // Garante que o clique foi na área vazia e não em um jogo que já existe (que tem seu próprio onclick)
            if (e.target === divMeusJogos || e.target.classList.contains('watermark')) {
                if (turnoAtivo && estado === 'descartando' && cartasSelecionadas.length >= 3) {
                    acaoBaixar();
                }
            }
        };
    }
    // ---------------------------------------------------------

    renderizarTresVermelhos(sala);    
}

// --- ATUALIZAÇÃO VISUAL E ATRIBUIÇÃO DOS CLIQUES ---
function atualizarMonte(sala) {
    const elMonte = document.getElementById('monte');
    const badge = document.getElementById('qtd-monte');
    const qtd = sala.jogo.monte.length;
    if(badge) badge.innerText = qtd;
    
    if (elMonte) {
        elMonte.style.opacity = (qtd === 0) ? '0.3' : '1';
        elMonte.classList.remove('ativo-brilhando');
        
        // Atribui a função de rastreio blindada
        elMonte.onclick = window.acaoComprarMonte;

        if (turnoAtivo && sala.estadoTurno === 'comprando' && qtd > 0) {
            elMonte.classList.add('ativo-brilhando');
        }
    }
}

function atualizarLixo(sala, estado) {
    const divLixo = document.getElementById('carta-lixo');
    const areaLixo = document.getElementById('lixo');
    const badge = document.getElementById('qtd-lixo');
    const qtd = sala.jogo.lixo.length;
    if(badge) badge.innerText = qtd;
    
    divLixo.innerHTML = '';
    areaLixo.classList.remove('ativo-brilhando');

    if (qtd > 0) {
        const topo = sala.jogo.lixo[qtd - 1];
        divLixo.innerHTML = `<div class="carta"><img src="${getImgUrl(topo)}"></div>`;
        if (turnoAtivo && estado === 'comprando') areaLixo.classList.add('ativo-brilhando');
    } else {
        divLixo.innerHTML = '<div style="color:rgba(255,255,255,0.2); font-size:12px;">LIXO</div>';
    }
    
    // Atribui a função de rastreio blindada
    areaLixo.onclick = window.acaoComprarLixo;
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
}

function renderizarJogos(idDiv, jogos, ehMeu) {
    const div = document.getElementById(idDiv);
    if (!div) return;
    
    const watermark = div.querySelector('.watermark');
    div.innerHTML = '';
    if (watermark) div.appendChild(watermark);
    
    if (!jogos) return;
    
    jogos.forEach((jogo, idxJogo) => {
        const grupo = document.createElement('div');
        grupo.className = 'grupo-baixado';
        
        if (ehMeu && turnoAtivo) {
            grupo.style.cursor = 'pointer';
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
        if(!div) return;
        
        div.innerHTML = ''; // Limpa a área
        
        cartas.forEach(c => {
            const el = document.createElement('div');
            el.className = 'carta-mini-header'; // Aplica a nova classe do cabeçalho
            el.innerHTML = `<img src="${getImgUrl(c)}">`;
            el.title = "3 Vermelho (100 pontos)";
            div.appendChild(el);
        });
    };

    // Identifica corretamente quem é quem no placar
    const idMinhaEquipe = meuIndex % 2;
    const idEquipeAdv = (idMinhaEquipe + 1) % 2;

    // Desenha nos novos IDs do cabeçalho
    desenhar('tres-vermelhos-nos', sala.jogo.tresVermelhos[idMinhaEquipe]);
    desenhar('tres-vermelhos-eles', sala.jogo.tresVermelhos[idEquipeAdv]);
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

function atualizarVisualMortos(sala) {
    const divMortos = document.getElementById('area-mortos');
    if (!divMortos) return;
    divMortos.innerHTML = ''; 
    const estiloBase = 'width: 75px; position: absolute; left: 50%; top: 50%; border-radius: 6px; box-shadow: 2px 2px 8px rgba(0,0,0,0.6); transition: all 0.3s ease;';

    if (sala.jogo.morto1 && sala.jogo.morto1.length > 0) {
        const imgM1 = document.createElement('img');
        imgM1.src = 'https://deckofcardsapi.com/static/img/back.png';
        imgM1.className = 'carta-morto';
        imgM1.style.cssText = `${estiloBase} transform: translate(-50%, -50%); z-index: 1;`;
        divMortos.appendChild(imgM1);
    }

    if (sala.jogo.morto2 && sala.jogo.morto2.length > 0) {
        const imgM2 = document.createElement('img');
        imgM2.src = 'https://deckofcardsapi.com/static/img/back.png';
        imgM2.className = 'carta-morto';
        imgM2.style.cssText = `${estiloBase} transform: translate(-50%, -50%) rotate(90deg); z-index: 2;`;
        divMortos.appendChild(imgM2);
    }
}

function atualizarPlacarComIndicadores(sala) {
    if (!sala.placarCalculado) return;
    const idMinhaEquipe = meuIndex % 2; 
    const idEquipeAdv = (idMinhaEquipe + 1) % 2;
    const ptsNos = (idMinhaEquipe === 0) ? sala.placarCalculado.p1.total : sala.placarCalculado.p2.total;
    const ptsEles = (idMinhaEquipe === 0) ? sala.placarCalculado.p2.total : sala.placarCalculado.p1.total;
    const nosPegamosMorto = sala.jogo.equipePegouMorto[idMinhaEquipe];
    const elesPegaramMorto = sala.jogo.equipePegouMorto[idEquipeAdv];
    const icone = ' <span style="color:#2ecc71; font-size:16px; margin-left:5px;" title="Pegou o morto">✅</span>';
    const elNos = document.getElementById('pts-nos');
    const elEles = document.getElementById('pts-eles');
    
    if(elNos) elNos.innerHTML = ptsNos + (nosPegamosMorto ? icone : '');
    if(elEles) elEles.innerHTML = ptsEles + (elesPegaramMorto ? icone : '');
}

// --- FUNÇÕES DE RASTREIO DE CLIQUE ---
window.acaoComprarMonte = function(event) {
    if(event) event.stopPropagation(); // Impede que o clique se perca
    console.log("👆 [RASTREIO] Clique no MONTE. Turno Ativo?", turnoAtivo, "| Estado:", ultimoEstadoSala?.estadoTurno);
    
    if (!turnoAtivo || !ultimoEstadoSala) return;
    
    if (ultimoEstadoSala.estadoTurno === 'comprando' && ultimoEstadoSala.jogo.monte.length > 0) {
        console.log("📥 Enviando requisição de compra do monte para o servidor...");
        socket.emit('jogada', { acao: 'comprarMonte', dados: {} });
    }
};

window.acaoComprarLixo = function(event) {
    if(event) event.stopPropagation();
    console.log("👆 [RASTREIO] Clique no LIXO. Turno Ativo?", turnoAtivo, "| Estado:", ultimoEstadoSala?.estadoTurno);
    
    if (!turnoAtivo || !ultimoEstadoSala) return;
    
    if (ultimoEstadoSala.estadoTurno === 'comprando' && ultimoEstadoSala.jogo.lixo.length > 0) {
        console.log("📥 Enviando requisição de compra do lixo para o servidor...");
        socket.emit('jogada', { acao: 'comprarLixo', dados: {} });
    } else if (ultimoEstadoSala.estadoTurno === 'descartando') {
        acaoDescartar();
    }
};

window.acaoDescartar = function() {
    if (!turnoAtivo) return;
    if (cartasSelecionadas.length !== 1) return;
    
    const indexCarta = cartasSelecionadas[0];
    const mao = ultimoEstadoSala?.jogo?.[`maoJogador${meuIndex + 1}`];
    if (!mao || !mao[indexCarta]) return;
    
    socket.emit('jogada', { 
        acao: 'descartar', 
        dados: { id: mao[indexCarta].id }
    });
    
    cartasSelecionadas = [];
    ultimaCartaCompradaId = null;
};

window.acaoBaixar = function() {
    if(cartasSelecionadas.length < 3) return alert("Selecione 3+ cartas");
    const mao = ultimoEstadoSala?.jogo?.[`maoJogador${meuIndex + 1}`];
    if (!mao) return;
    
    const ids = cartasSelecionadas.map(idx => mao[idx]?.id).filter(Boolean);
    socket.emit('jogada', { acao: 'baixarJogo', dados: { ids: ids, indexJogoMesa: null } });
    cartasSelecionadas = [];
};

window.acaoLimpar = function() { cartasSelecionadas = []; renderizarMinhaMao(ultimoEstadoSala.jogo[`maoJogador${meuIndex+1}`]);};
window.acaoOrdenar = function() { socket.emit('jogada', { acao: 'ordenar', dados: {} }); };
window.pedirReset = function() { if(confirm('Reiniciar?')) socket.emit('resetJogo'); };
window.fazerLogout = function() { localStorage.removeItem('tranca_sessao'); location.reload(); };
window.jogarAnonimo = jogarAnonimo;
window.fazerLogin = fazerLogin;
window.entrarModoTreino = entrarModoTreino;

window.tentarBaixarJogo = window.acaoBaixar;
window.descartarCartaSelecionadas = window.acaoDescartar;
window.limparSelecao = window.acaoLimpar;
window.alternarOrdenacao = window.acaoOrdenar;

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
    const modal = document.getElementById('modal-fim');
    if (!modal) return;
    modal.style.display = 'flex';
    
    const preencher = (prefixo, d) => {
        const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
        if (!d) return;
        setTxt(prefixo + '-batida', d.ptsBatida || 0);
        setTxt(prefixo + '-morto', d.ptsMorto || 0);
        setTxt(prefixo + '-limpa', d.ptsCanastrasLimpas || 0);
        setTxt(prefixo + '-suja', d.ptsCanastrasSujas || 0);
        setTxt(prefixo + '-3ver', d.pts3Vermelhos || 0);
        setTxt(prefixo + '-cartas', (d.ptsCartasMao || 0) + (d.ptsCartasMesa || 0));
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
}

window.jogarNovamente = function() {
    const modalFim = document.getElementById('modal-fim');
    if (modalFim) modalFim.style.display = 'none';
    meuIndex = -1; turnoAtivo = false; cartasSelecionadas = []; ultimoEstadoSala = null;
    socket.emit('resetJogo');
};







