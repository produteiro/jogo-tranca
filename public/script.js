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
            if(user.nome) socket.emit('loginAnonimo', user.nome);
        } catch(e) { console.error(e); }
    }
};

function jogarAnonimo() {
    const nomeInput = document.getElementById('input-nome'); // Caso tenha input no HTML antigo
    const nome = nomeInput ? nomeInput.value : 'Visitante-' + Math.floor(Math.random()*1000);
    socket.emit('loginAnonimo', nome);
}

function fazerLogin() { alert("Use o botão Jogar como Anônimo."); }
function fazerLogout() { localStorage.removeItem('tranca_sessao'); location.reload(); }
function entrarModoTreino() { socket.emit('entrarSala', 'treino'); }
function pedirReset() { if(confirm('Reiniciar?')) socket.emit('resetJogo'); }

socket.on('loginSucesso', (user) => {
    localStorage.setItem('tranca_sessao', JSON.stringify(user));
    document.getElementById('tela-login').style.display = 'none';
    
    // Se tiver lobby, mostra lobby, senão vai direto (depende do seu HTML atual)
    const lobby = document.getElementById('lobby');
    if(lobby) lobby.style.display = 'flex';
    else {
        document.getElementById('mesa').style.display = 'flex';
        socket.emit('entrarSala', 'treino');
    }
});

// --- ESTADO DO JOGO ---
socket.on('estadoJogo', (sala) => {
    ultimoEstadoSala = sala;
    const lobby = document.getElementById('lobby');
    if(lobby) lobby.style.display = 'none';
    document.getElementById('mesa').style.display = 'flex';
    atualizarMesa(sala);
});

socket.on('cartaComprada', (dados) => {
    ultimaCartaCompradaId = dados.cartaId;
});

// --- RENDERIZAÇÃO PRINCIPAL ---
function atualizarMesa(sala) {
    // Identifica o jogador
    meuIndex = sala.jogadores.findIndex(id => id === socket.id);
    if (meuIndex === -1 && sala.donos) meuIndex = sala.donos.findIndex(id => id === socket.id);
    if (meuIndex === -1) return;

    turnoAtivo = (sala.vez === meuIndex);
    const estado = sala.estadoTurno;

    // 1. INFO SUPERIOR
    const textoStatus = turnoAtivo 
        ? `SUA VEZ (${estado === 'comprando' ? 'COMPRE' : 'JOGUE'})` 
        : `VEZ DE: ${sala.jogadores[sala.vez]}`;
    const info = document.getElementById('info-jogo');
    if(info) {
        info.innerText = textoStatus;
        info.style.color = turnoAtivo ? '#f1c40f' : '#fff';
    }

    // 2. PLACAR (Corrigido para evitar [object Object])
    if (sala.placarCalculado) {
        const elNos = document.getElementById('pts-nos');
        const elEles = document.getElementById('pts-eles');
        const souTimeP1 = (meuIndex % 2 === 0);
        
        const ptsNos = souTimeP1 ? sala.placarCalculado.p1.total : sala.placarCalculado.p2.total;
        const ptsEles = souTimeP1 ? sala.placarCalculado.p2.total : sala.placarCalculado.p1.total;

        if (elNos) elNos.innerText = ptsNos;
        if (elEles) elEles.innerText = ptsEles;
    }

    // 3. MONTE
    atualizarMonte(sala);

    // 4. LIXO (Comportamento duplo: Comprar ou Descartar)
    atualizarLixo(sala, estado);

    // 5. MÃOS ADVERSÁRIAS
    const idxP = (meuIndex + 2) % 4;
    const idxE = (meuIndex + 3) % 4;
    const idxD = (meuIndex + 1) % 4;
    const counts = sala.maosCount || [0,0,0,0];
    
    desenharMaoAdversario('mao-topo', counts[idxP]);
    desenharMaoAdversario('mao-esquerda', counts[idxE]);
    desenharMaoAdversario('mao-direita', counts[idxD]);

    // 6. MINHA MÃO
    renderizarMinhaMao(sala.jogo[`maoJogador${meuIndex+1}`]);

    // 7. JOGOS NA MESA
    const divJogosMeus = document.getElementById('meus-jogos');
    const divJogosEles = document.getElementById('jogos-adversarios');
    
    const timeMeu = meuIndex % 2;
    const timeEles = (meuIndex + 1) % 2;

    renderizarJogos('meus-jogos', sala.jogo.jogosNaMesa[timeMeu], true);
    renderizarJogos('jogos-adversarios', sala.jogo.jogosNaMesa[timeEles], false);

    // 8. 3 VERMELHOS (Correção visual do placar)
    renderizarTresVermelhos(sala);

    // 9. MORTOS (Esconde se vazio)
    const m1 = document.getElementById('morto1');
    const m2 = document.getElementById('morto2');
    if(m1) m1.style.display = (sala.jogo.morto1 && sala.jogo.morto1.length > 0) ? 'block' : 'none';
    if(m2) m2.style.display = (sala.jogo.morto2 && sala.jogo.morto2.length > 0) ? 'block' : 'none';
}

// --- FUNÇÕES DE COMPONENTES ---

function atualizarMonte(sala) {
    const elMonte = document.getElementById('monte');
    const badge = document.getElementById('qtd-monte');
    const qtd = sala.jogo.monte.length;
    
    if (badge) badge.innerText = qtd;
    
    if (elMonte) {
        elMonte.style.opacity = (qtd === 0) ? '0.3' : '1';
        elMonte.style.cursor = (qtd === 0) ? 'not-allowed' : 'pointer';
        elMonte.classList.remove('ativo-brilhando');
        elMonte.onclick = null;

        if (turnoAtivo && sala.estadoTurno === 'comprando' && qtd > 0) {
            elMonte.classList.add('ativo-brilhando');
        }

        if (qtd > 0) {
            elMonte.onclick = () => {
                socket.emit('jogada', { acao: 'comprarMonte', dados: {} });
            };
        }
    }
}

function atualizarLixo(sala, estado) {
    const divLixo = document.getElementById('carta-lixo');
    const areaLixo = document.getElementById('lixo');
    const badge = document.getElementById('qtd-lixo');
    
    if (!divLixo || !areaLixo) return;
    
    const qtd = sala.jogo.lixo.length;
    if (badge) badge.innerText = qtd;
    
    divLixo.innerHTML = '';
    areaLixo.onclick = null;
    areaLixo.classList.remove('ativo-brilhando');

    // Lógica de Clique (Compra ou Descarte)
    areaLixo.onclick = () => {
        if (!turnoAtivo) return;

        if (estado === 'comprando' && qtd > 0) {
            socket.emit('jogada', { acao: 'comprarLixo', dados: {} });
        }
        else if (estado === 'descartando') {
            if (cartasSelecionadas.length === 1) {
                socket.emit('jogada', { acao: 'descartar', dados: { index: cartasSelecionadas[0] } });
                cartasSelecionadas = [];
                atualizarVisualSelecao();
            } else {
                alert("Selecione 1 carta para descartar.");
            }
        }
    };

    if (qtd > 0) {
        const topo = sala.jogo.lixo[qtd - 1];
        const cartaDiv = document.createElement('div');
        cartaDiv.className = 'carta';
        cartaDiv.innerHTML = `<img src="${getImgUrl(topo)}">`;
        divLixo.appendChild(cartaDiv);
        
        if (turnoAtivo && estado === 'comprando') {
            areaLixo.classList.add('ativo-brilhando');
        }
    } else {
        divLixo.innerHTML = '<div style="color:rgba(255,255,255,0.2); font-size:12px; padding:10px;">LIXO</div>';
    }
}

function renderizarMinhaMao(cartas) {
    const div = document.querySelector('.area-cartas-relativa') || document.getElementById('minha-mao');
    if(!div) return;
    div.innerHTML = '';
    
    cartas.forEach((c, i) => {
        const el = document.createElement('div');
        el.className = 'carta';
        if (cartasSelecionadas.includes(i)) el.classList.add('selecionada');
        if (c.id === ultimaCartaCompradaId) el.classList.add('nova-carta');

        el.innerHTML = `<img src="${getImgUrl(c)}">`;
        el.onclick = (e) => {
            e.stopPropagation();
            if (cartasSelecionadas.includes(i)) cartasSelecionadas = cartasSelecionadas.filter(x=>x!==i);
            else cartasSelecionadas.push(i);
            atualizarVisualSelecao();
        };
        div.appendChild(el);
    });
}

function atualizarVisualSelecao() {
    const div = document.querySelector('.area-cartas-relativa') || document.getElementById('minha-mao');
    if(div) {
        const cartas = div.getElementsByClassName('carta');
        for(let i=0; i<cartas.length; i++) {
            if(cartasSelecionadas.includes(i)) cartas[i].classList.add('selecionada');
            else cartas[i].classList.remove('selecionada');
        }
    }
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
        
        if (jogo.length >= 7) {
            const temCuringa = jogo.some(c => c.face === '2' && c.naipe !== jogo[0].naipe); 
            grupo.classList.add(temCuringa ? 'canastra-suja' : 'canastra-limpa');
        }
        
        if (ehMeu && turnoAtivo) {
            grupo.style.cursor = 'pointer';
            grupo.onclick = (e) => {
                e.stopPropagation();
                if (cartasSelecionadas.length > 0) {
                    socket.emit('jogada', { 
                        acao: 'baixarJogo', 
                        dados: { indices: cartasSelecionadas, indexJogoMesa: idxJogo } 
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
    if (!sala.jogo.tresVermelhos) return;
    const idEq = meuIndex % 2;
    const adversarioEq = (idEq + 1) % 2;
    
    const desenhar = (containerId, cartas) => {
        const div = document.getElementById(containerId);
        if (!div || !cartas || cartas.length === 0) return;
        if (div.querySelector('.tres-vermelhos-grupo')) return;

        const grupo = document.createElement('div');
        grupo.className = 'grupo-baixado tres-vermelhos-grupo';
        grupo.style.border = '2px dashed #e74c3c';
        grupo.title = "3 Vermelhos";

        cartas.forEach(c => {
            const el = document.createElement('div');
            el.className = 'carta tres-vermelho-bonus'; 
            el.innerHTML = `<img src="${getImgUrl(c)}">`;
            grupo.appendChild(el);
        });
        // Insere logo após a marca d'água se existir, ou no começo
        const watermark = div.querySelector('.watermark');
        if (watermark) watermark.insertAdjacentElement('afterend', grupo);
        else div.prepend(grupo);
    };

    desenhar('meus-jogos', sala.jogo.tresVermelhos[idEq]);
    desenhar('jogos-adversarios', sala.jogo.tresVermelhos[adversarioEq]);
}

function desenharMaoAdversario(idDiv, qtd) {
    const div = document.querySelector(`#${idDiv} .cartas-container`) || document.getElementById(idDiv);
    if(!div) return;
    
    // Limpa apenas as cartas, mantém o label se existir
    const cartasAntigas = div.querySelectorAll('.carta-miniatura');
    cartasAntigas.forEach(c => c.remove());
    
    // Se o div for o container direto (estrutura antiga vs nova), ajusta
    const containerReal = div.classList.contains('cartas-container') ? div : div;

    for(let i=0; i<qtd; i++) {
        const c = document.createElement('div');
        c.className = 'carta-miniatura';
        containerReal.appendChild(c);
    }
}

// --- AÇÕES GLOBAIS ---
window.acaoBaixar = () => {
    if (!turnoAtivo) return;
    if (cartasSelecionadas.length < 3) return alert("Selecione pelo menos 3 cartas.");
    
    socket.emit('jogada', { 
        acao: 'baixarJogo', 
        dados: { indices: cartasSelecionadas, indexJogoMesa: null } 
    });
    cartasSelecionadas = [];
    atualizarVisualSelecao();
};

// Aliases para botões antigos ou chamadas diretas
window.tentarBaixarJogo = window.acaoBaixar;
window.descartarCartaSelecionadas = () => {
    if(cartasSelecionadas.length !== 1) return alert("Selecione 1 carta.");
    socket.emit('jogada', { acao: 'descartar', dados: { index: cartasSelecionadas[0] } });
    cartasSelecionadas = [];
    atualizarVisualSelecao();
};
window.limparSelecao = () => { 
    cartasSelecionadas = []; 
    atualizarVisualSelecao(); 
};
window.alternarOrdenacao = () => socket.emit('jogada', { acao: 'ordenar', dados: {} });

// --- CHAT ---
window.toggleChat = () => {
    const chat = document.getElementById('janela-chat');
    if (!chat) return;
    if (chat.style.display === 'flex') {
        chat.style.display = 'none';
    } else {
        chat.style.display = 'flex';
        const input = document.getElementById('chat-input');
        if(input) setTimeout(() => input.focus(), 100);
    }
};

window.enviarMensagem = () => {
    const input = document.getElementById('chat-input');
    if (input && input.value.trim()) {
        socket.emit('enviarChat', input.value.trim());
        input.value = '';
    }
};

socket.on('receberChat', (dados) => {
    const div = document.getElementById('chat-msgs');
    if (div) {
        const p = document.createElement('div');
        p.style.marginBottom = '5px';
        if (dados.sistema) {
            p.style.color = '#f1c40f';
            p.innerText = dados.msg;
        } else {
            p.innerHTML = `<strong style="color:#3498db">${dados.nome}:</strong> ${dados.msg}`;
        }
        div.appendChild(p);
        div.scrollTop = div.scrollHeight;
    }
});

socket.on('fimDeJogo', (dados) => {
    const modal = document.getElementById('modal-fim');
    if(modal) modal.style.display = 'flex';
    
    if(document.getElementById('p1-total')) {
        document.getElementById('p1-total').innerText = dados.placar.p1;
        document.getElementById('p2-total').innerText = dados.placar.p2;
    }
});

// Expor funções globais
window.jogarAnonimo = jogarAnonimo;
window.fazerLogin = fazerLogin;
window.fazerLogout = fazerLogout;
window.entrarModoTreino = entrarModoTreino;
window.pedirReset = pedirReset;
