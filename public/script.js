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
    meuIndex = sala.jogadores.findIndex(id => id === socket.id);
    if (meuIndex === -1 && sala.donos) meuIndex = sala.donos.findIndex(id => id === socket.id);
    if (meuIndex === -1) return;

    turnoAtivo = (sala.vez === meuIndex);
    const estado = sala.estadoTurno;

    const info = document.getElementById('info-jogo');
    if(info) {
        info.innerText = turnoAtivo 
            ? `SUA VEZ (${estado === 'comprando' ? 'COMPRE' : 'JOGUE'})` 
            : `VEZ DE: ${sala.jogadores[sala.vez] || 'BOT'}`;
        info.style.color = turnoAtivo ? '#f1c40f' : '#fff';
    }

    if (sala.placarCalculado) { // Assumindo server envia objeto pronto
        // Se server não enviar, precisa calcular aqui (mas o server.js novo envia)
    }

    atualizarMonte(sala);
    atualizarLixo(sala, estado);

    // Mãos Adversárias
    const idxP = (meuIndex + 2) % 4;
    const idxE = (meuIndex + 3) % 4; // Sentido horário (esquerda é anterior)
    const idxD = (meuIndex + 1) % 4; // Direita é próximo
    const counts = sala.maosCount || [0,0,0,0];
    
    desenharMaoAdversario('mao-topo', counts[idxP]);
    desenharMaoAdversario('mao-esquerda', counts[idxE]);
    desenharMaoAdversario('mao-direita', counts[idxD]);

    renderizarMinhaMao(sala.jogo[`maoJogador${meuIndex+1}`]);

    const idEq = meuIndex % 2;
    renderizarJogos('meus-jogos', sala.jogo.jogosNaMesa[idEq], true);
    renderizarJogos('jogos-adversarios', sala.jogo.jogosNaMesa[(idEq + 1) % 2], false);
    
    renderizarTresVermelhos(sala);
    
    // Atualiza Botões
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

function atualizarLixo(sala, estado) {
    const divLixo = document.getElementById('carta-lixo');
    const areaLixo = document.getElementById('lixo');
    const badge = document.getElementById('qtd-lixo');
    const qtd = sala.jogo.lixo.length;
    if(badge) badge.innerText = qtd;
    
    divLixo.innerHTML = '';
    areaLixo.classList.remove('ativo-brilhando');
    areaLixo.onclick = null;

    if (qtd > 0) {
        const topo = sala.jogo.lixo[qtd - 1];
        divLixo.innerHTML = `<div class="carta"><img src="${getImgUrl(topo)}"></div>`;
        
        areaLixo.onclick = () => {
            if (!turnoAtivo) return;
            if (estado === 'comprando') socket.emit('jogada', { acao: 'comprarLixo', dados: {} });
            else if (estado === 'descartando') acaoDescartar();
        };
        
        if (turnoAtivo && estado === 'comprando') areaLixo.classList.add('ativo-brilhando');
    } else {
        divLixo.innerHTML = '<div style="color:rgba(255,255,255,0.2); font-size:12px;">LIXO</div>';
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
    div.innerHTML = ''; 
    // Watermark se quiser manter
    
    jogos.forEach((jogo, idxJogo) => {
        const grupo = document.createElement('div');
        grupo.className = 'grupo-baixado';
        if (ehMeu && turnoAtivo) {
            grupo.onclick = () => {
                if(cartasSelecionadas.length > 0) {
                    socket.emit('jogada', { acao: 'baixarJogo', dados: { indices: cartasSelecionadas, indexJogoMesa: idxJogo }});
                    cartasSelecionadas = [];
                }
            };
        }
        jogo.forEach(c => {
            const el = document.createElement('div');
            el.className = 'carta';
            el.innerHTML = `<img src="${getImgUrl(c)}">`;
            grupo.appendChild(el);
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
    // Limpa cartas antigas (mantém info-player)
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
    if(cartasSelecionadas.length !== 1) return alert("Selecione 1 carta");
    socket.emit('jogada', { acao: 'descartar', dados: { index: cartasSelecionadas[0] } });
    cartasSelecionadas = [];
    ultimaCartaCompradaId = null;
};

window.acaoBaixar = function() {
    if(cartasSelecionadas.length < 3) return alert("Selecione 3+ cartas");
    socket.emit('jogada', { acao: 'baixarJogo', dados: { indices: cartasSelecionadas, indexJogoMesa: null } });
    cartasSelecionadas = [];
};

window.acaoLimpar = function() { cartasSelecionadas = []; renderizarMinhaMao(ultimoEstadoSala.jogo[`maoJogador${meuIndex+1}`]); atualizarBotoesAcao(ultimoEstadoSala.estadoTurno); };
window.acaoOrdenar = function() { socket.emit('jogada', { acao: 'ordenar', dados: {} }); };
window.pedirReset = function() { if(confirm('Reiniciar?')) socket.emit('resetJogo'); };
window.fazerLogout = function() { localStorage.removeItem('tranca_sessao'); location.reload(); };
window.jogarAnonimo = jogarAnonimo;
window.fazerLogin = fazerLogin;
window.entrarModoTreino = entrarModoTreino;

// Aliases
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
    const modal = document.getElementById('modal-fim');
    if(modal) {
        modal.style.display = 'flex';
        // Preencher placar final se necessário
    }
});
