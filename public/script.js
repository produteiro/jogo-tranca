const socket = io();
let meuId = null;
let meuIndex = -1;
let turnoAtivo = false;
let cartasSelecionadas = [];
let ultimaCartaCompradaId = null; // ID da carta para destaque
let ultimoEstadoSala = null; // Guarda último estado para referência

// --- MAPA DE IMAGENS ---
const mapaNaipes = { 'copas': 'H', 'ouros': 'D', 'paus': 'C', 'espadas': 'S' };

function getImgUrl(carta) {
    if (!carta) return '';
    let face = carta.face === '10' ? '0' : carta.face;
    let naipe = mapaNaipes[carta.naipe.toLowerCase()] || carta.naipe[0].toUpperCase();
    return `https://deckofcardsapi.com/static/img/${face}${naipe}.png`;
}

// --- LOGIN ---
window.onload = function() {
    const sessao = localStorage.getItem('tranca_sessao');
    if (sessao) {
        try {
            const user = JSON.parse(sessao);
            socket.emit('loginAnonimo', user.nome);
        } catch(e) {
            console.error('Erro ao recuperar sessão:', e);
        }
    }
};

function fazerLogin() { 
    alert("Use o botão jogar como visitante por enquanto."); 
}

function jogarAnonimo() { 
    const nome = 'Visitante-' + Math.floor(Math.random()*1000);
    
    // Limpa estado anterior
    meuIndex = -1;
    turnoAtivo = false;
    cartasSelecionadas = [];
    ultimoEstadoSala = null;
    ultimaCartaCompradaId = null;
    
    socket.emit('loginAnonimo', nome); 
    
    const btn = document.querySelector('button[onclick="jogarAnonimo()"]');
    if(btn) btn.innerText = "Entrando...";
}

socket.on('loginSucesso', (user) => {
    console.log("✅ Login OK:", user);
    localStorage.setItem('tranca_sessao', JSON.stringify(user));
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('lobby').style.display = 'flex';
    
    // CORREÇÃO: Garante que os botões de ferramentas apareçam
    const barra = document.getElementById('barra-ferramentas');
    if(barra) barra.style.display = 'flex';
});

function entrarModoTreino() {
    console.log("🎮 Entrando na sala de treino...");
    socket.emit('entrarSala', 'treino');
    document.getElementById('lobby').innerHTML = '<h2 style="color:#fbbf24;">Entrando na partida...</h2>';
}

// ==========================================
// 🎮 JOGO - EVENTO PRINCIPAL
// ==========================================

socket.on('estadoJogo', (sala) => {
    console.log('🎲 Estado do jogo recebido:', sala);
    
    ultimoEstadoSala = sala;
    
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('mesa').style.display = 'flex';
    
    // CORREÇÃO: Garante que os botões de ferramentas apareçam ao carregar o jogo
    const barra = document.getElementById('barra-ferramentas');
    if(barra) barra.style.display = 'flex';
    
    atualizarMesa(sala);
});

function atualizarMesa(sala) {
    if (!sala || !sala.jogo) return;

    // Descobre quem sou eu
    meuIndex = sala.jogadores.findIndex(id => id === socket.id);
    if (meuIndex === -1 && sala.donos) {
        meuIndex = sala.donos.findIndex(id => id === socket.id);
    }
    
    // Fallback para encontrar índice
    if (meuIndex === -1) {
        for (let i = 0; i < 4; i++) {
            if (sala.jogadores[i] === socket.id || sala.donos[i] === socket.id) {
                meuIndex = i;
                break;
            }
        }
        if (meuIndex === -1) meuIndex = 0;
    }
    
    turnoAtivo = (sala.vez === meuIndex);
    const estado = sala.estadoTurno;
    
    // 1. ATUALIZA HEADER
    const infoJogo = document.getElementById('info-jogo');
    if (infoJogo) {
        if (turnoAtivo) {
            if (estado === 'comprando') {
                infoJogo.innerText = 'SUA VEZ - COMPRE DO MONTE OU LIXO';
                infoJogo.style.color = '#f1c40f';
            } else {
                infoJogo.innerText = 'SUA VEZ - BAIXE JOGOS OU DESCARTE';
                infoJogo.style.color = '#2ecc71';
            }
        } else {
            // Mostra quem está jogando (Nome ou Bot)
            const nomeVez = sala.usuarios[sala.vez]?.nome || sala.jogadores[sala.vez] || `JOGADOR ${sala.vez + 1}`;
            infoJogo.innerText = `VEZ DE: ${nomeVez}`;
            infoJogo.style.color = '#888';
        }
    }

    // 2. ATUALIZA PLACAR
    atualizarPlacar(sala);

    // 3. ATUALIZA MONTE
    atualizarMonte(sala);

    // 4. ATUALIZA LIXO
    atualizarLixo(sala, estado);

    // 5. RENDERIZA MINHA MÃO
    const chaveMao = `maoJogador${meuIndex + 1}`;
    const mao = sala.jogo[chaveMao];
    if (mao && Array.isArray(mao)) {
        renderizarMinhaMao(mao);
    }

    // 6. RENDERIZA JOGOS NA MESA
    const idEq = meuIndex % 2;
    const meusJogos = sala.jogo.jogosNaMesa[idEq];
    const jogosAdversarios = sala.jogo.jogosNaMesa[(idEq + 1) % 2];
    
    renderizarJogos('meus-jogos', meusJogos, true);
    renderizarJogos('jogos-adversarios', jogosAdversarios, false);

    // 7. RENDERIZA ADVERSÁRIOS (COM CORREÇÃO DE SENTIDO)
    atualizarAdversarios(sala);
    
    // 8. ATUALIZA BOTÕES DE AÇÃO
    atualizarBotoesAcao(estado);
}

// ==========================================
// 🎴 ATUALIZAÇÃO DE ELEMENTOS VISUAIS
// ==========================================

function atualizarPlacar(sala) {
    if (!sala.jogo) return;
    
    // Usa o cálculo que vem do servidor se disponível, ou calcula local (simplificado aqui para usar o do server se houver)
    // O ideal é confiar no server, mas vamos manter a lógica visual de atualização
    
    // Para garantir sincronia com os 3 vermelhos e canastras, usamos o objeto placarCalculado se o server mandar
    if (sala.placarCalculado) {
        const idEq = meuIndex % 2;
        const souP1 = (idEq === 0);
        
        const ptsNos = souP1 ? sala.placarCalculado.p1.total : sala.placarCalculado.p2.total;
        const ptsEles = souP1 ? sala.placarCalculado.p2.total : sala.placarCalculado.p1.total;
        
        const elNos = document.getElementById('pts-nos');
        const elEles = document.getElementById('pts-eles');
        if (elNos) elNos.innerText = ptsNos;
        if (elEles) elEles.innerText = ptsEles;
    }
}

function atualizarMonte(sala) {
    const elMonte = document.getElementById('monte');
    const badge = document.getElementById('qtd-monte');
    const qtd = sala.jogo.monte.length;
    
    if (badge) badge.innerText = qtd;
    
    if (elMonte) {
        if (qtd === 0) {
            elMonte.style.opacity = '0.3';
            elMonte.style.cursor = 'not-allowed';
        } else {
            elMonte.style.opacity = '1';
            elMonte.style.cursor = 'pointer';
        }
        
        elMonte.onclick = () => {
            if (turnoAtivo && sala.estadoTurno === 'comprando' && qtd > 0) {
                socket.emit('jogada', { acao: 'comprarMonte', dados: {} });
            }
        };
        
        // Brilho no monte
        if (turnoAtivo && sala.estadoTurno === 'comprando' && qtd > 0) {
            elMonte.classList.add('ativo-brilhando');
        } else {
            elMonte.classList.remove('ativo-brilhando');
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
    
    // Reseta classes e eventos
    areaLixo.onclick = null;
    areaLixo.classList.remove('ativo-brilhando');

    if (qtd > 0) {
        const topo = sala.jogo.lixo[qtd - 1];
        const cartaDiv = document.createElement('div');
        cartaDiv.className = 'carta';
        cartaDiv.innerHTML = `<img src="${getImgUrl(topo)}">`;
        divLixo.appendChild(cartaDiv);
        
        // Lógica de Clique (Compra ou Descarte)
        areaLixo.onclick = () => {
            if (!turnoAtivo) return;

            if (estado === 'comprando') {
                socket.emit('jogada', { acao: 'comprarLixo', dados: {} });
            }
            else if (estado === 'descartando') {
                if (cartasSelecionadas.length === 1) {
                    acaoDescartar();
                } else {
                    alert("Selecione 1 carta para descartar.");
                }
            }
        };

        // Brilho se pode comprar
        if (turnoAtivo && estado === 'comprando') {
            areaLixo.classList.add('ativo-brilhando');
        }
    } else {
        divLixo.innerHTML = '<div style="color:rgba(255,255,255,0.2); font-size:12px; padding:10px;">LIXO</div>';
    }
}

function atualizarAdversarios(sala) {
    if (!sala.jogo) return;
    
    // CORREÇÃO DO SENTIDO (HORÁRIO / DIREITA)
    // Se o turno é +1, e queremos que visualmente vá para a direita:
    // Direita = Index + 1
    // Topo = Index + 2
    // Esquerda = Index + 3 (ou -1)
    
    const idxDir = (meuIndex + 1) % 4; // Próximo à Direita
    const idxTopo = (meuIndex + 2) % 4; // Parceiro à Frente
    const idxEsq = (meuIndex + 3) % 4; // Anterior à Esquerda
    
    const qtdDir = sala.jogo[`maoJogador${idxDir + 1}`]?.length || 0;
    const qtdTopo = sala.jogo[`maoJogador${idxTopo + 1}`]?.length || 0;
    const qtdEsq = sala.jogo[`maoJogador${idxEsq + 1}`]?.length || 0;
    
    // Atualiza contadores visuais
    renderizarMaoAdversario('mao-direita', qtdDir);
    renderizarMaoAdversario('mao-topo', qtdTopo);
    renderizarMaoAdversario('mao-esquerda', qtdEsq);
    
    // Atualiza nomes/info (Opcional, mas bom para saber quem é quem)
    const setNome = (id, idx) => {
        const el = document.querySelector(`#${id} .info-player`);
        if (el) {
            const nome = sala.usuarios[idx]?.nome || sala.jogadores[idx] || `BOT ${idx+1}`;
            // Abrevia se for muito longo
            el.innerText = nome.length > 8 ? nome.substr(0,8) + '...' : nome;
        }
    };
    
    setNome('mao-direita', idxDir);
    setNome('mao-topo', idxTopo);
    setNome('mao-esquerda', idxEsq);
}

function renderizarMaoAdversario(idContainer, qtd) {
    const container = document.querySelector(`#${idContainer} .cartas-container`) || document.getElementById(idContainer);
    if (!container) return;
    
    // Remove apenas as cartas, mantém info-player
    const cartas = container.querySelectorAll('.carta-miniatura');
    cartas.forEach(c => c.remove());
    
    for (let i = 0; i < qtd; i++) {
        const c = document.createElement('div');
        c.className = 'carta-miniatura';
        container.appendChild(c);
    }
}

// ==========================================
// 🃏 RENDERIZAÇÃO DE CARTAS E JOGOS
// ==========================================

function renderizarMinhaMao(cartas) {
    const div = document.getElementById('minha-mao');
    if (!div) return;
    
    div.innerHTML = '';
    
    cartas.forEach((c, i) => {
        const el = document.createElement('div');
        el.className = 'carta';
        
        if (cartasSelecionadas.includes(i)) {
            el.classList.add('selecionada');
        }
        
        // CORREÇÃO: Destaque apenas se for minha vez e a carta for a comprada
        if (turnoAtivo && ultimaCartaCompradaId && c.id === ultimaCartaCompradaId) {
            el.classList.add('nova-carta');
        }

        el.innerHTML = `<img src="${getImgUrl(c)}">`;
        el.onclick = (e) => { 
            e.stopPropagation(); 
            toggleSelecao(i); 
        };
        
        div.appendChild(el);
    });
}

function toggleSelecao(i) {
    if (cartasSelecionadas.includes(i)) {
        cartasSelecionadas = cartasSelecionadas.filter(x => x !== i);
    } else {
        cartasSelecionadas.push(i);
    }
    
    // Atualiza visual
    const divs = document.querySelectorAll('#minha-mao .carta');
    divs.forEach((el, idx) => {
        if (cartasSelecionadas.includes(idx)) el.classList.add('selecionada');
        else el.classList.remove('selecionada');
    });
    
    atualizarBotoesAcao(ultimoEstadoSala ? ultimoEstadoSala.estadoTurno : null);
}

function renderizarJogos(idDiv, jogos, ehMeu) {
    const div = document.getElementById(idDiv);
    if (!div) return;
    
    // Mantém watermark
    const watermark = div.querySelector('.watermark');
    div.innerHTML = '';
    if (watermark) div.appendChild(watermark);
    
    // Renderiza 3 vermelhos primeiro (visual)
    renderizarTresVermelhos(div, ehMeu);

    if (!jogos) return;
    
    jogos.forEach((jogo, idxJogo) => {
        const grupo = document.createElement('div');
        grupo.className = 'grupo-baixado';
        
        // Estilo de canastra
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

function renderizarTresVermelhos(containerDiv, ehMeu) {
    if (!ultimoEstadoSala || !ultimoEstadoSala.jogo.tresVermelhos) return;
    
    const idEq = ehMeu ? (meuIndex % 2) : ((meuIndex + 1) % 2);
    const cartas = ultimoEstadoSala.jogo.tresVermelhos[idEq];
    
    if (!cartas || cartas.length === 0) return;

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
    
    containerDiv.appendChild(grupo);
}

// ==========================================
// 🎮 BOTÕES DE AÇÃO
// ==========================================

function atualizarBotoesAcao(estado) {
    const btnBaixar = document.getElementById('btn-baixar-jogo');
    const btnDescartar = document.getElementById('btn-descartar');
    const btnLimpar = document.getElementById('btn-limpar-selecao');
    const qtdSel = document.getElementById('qtd-selecionadas');
    const qtdDesc = document.getElementById('qtd-descartar');
    
    if (!btnBaixar) return;
    
    const qtd = cartasSelecionadas.length;
    if (qtdSel) qtdSel.innerText = qtd;
    if (qtdDesc) qtdDesc.innerText = qtd;
    
    btnBaixar.style.display = 'none';
    btnDescartar.style.display = 'none';
    btnLimpar.style.display = 'none';
    
    if (!turnoAtivo) return;
    
    if (qtd > 0) btnLimpar.style.display = 'inline-block';
    
    if (estado === 'descartando') {
        if (qtd >= 3) btnBaixar.style.display = 'inline-block';
        if (qtd === 1) btnDescartar.style.display = 'inline-block';
    }
}

function acaoDescartar() {
    if (!turnoAtivo) {
        console.log('❌ Não é sua vez');
        return;
    }
    
    if (cartasSelecionadas.length !== 1) {
        alert("Selecione 1 carta para descartar.");
        return;
    }
    
    console.log('🗑️ Descartando carta index:', cartasSelecionadas[0]);
    
    // CORREÇÃO: Envia o formato exato que o server.js espera no ouvinte 'jogada'
    socket.emit('jogada', { 
        acao: 'descartar', 
        dados: { index: cartasSelecionadas[0] } 
    });
    
    // Limpa seleção visual imediatamente
    cartasSelecionadas = [];
    atualizarVisualSelecao();
    ultimaCartaCompradaId = null;
}

function acaoBaixar() {
    if (!turnoAtivo) return;
    if (cartasSelecionadas.length < 3) return alert("Selecione 3+ cartas");
    
    socket.emit('jogada', { 
        acao: 'baixarJogo', 
        dados: { indices: cartasSelecionadas, indexJogoMesa: null } 
    });
    cartasSelecionadas = [];
}

function acaoLimpar() { 
    cartasSelecionadas = []; 
    atualizarMesa(ultimoEstadoSala);
}

function acaoOrdenar() { 
    socket.emit('jogada', { acao: 'ordenar', dados: {} });
}

function pedirReset() {
    if (confirm("Reiniciar jogo?")) {
        socket.emit('resetJogo');
    }
}

function fazerLogout() { 
    localStorage.removeItem('tranca_sessao'); 
    location.reload(); 
}

// ==========================================
// 💬 CHAT
// ==========================================

function toggleChat() {
    const chat = document.getElementById('janela-chat');
    if (!chat) return;
    
    if (chat.style.display === 'flex') {
        chat.style.display = 'none';
    } else {
        chat.style.display = 'flex';
        const input = document.getElementById('chat-input');
        if (input) setTimeout(() => input.focus(), 100);
    }
}

function enviarMensagem() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const msg = input.value.trim();
    if (msg) {
        socket.emit('enviarChat', msg);
        input.value = '';
    }
}

// ==========================================
// 🌐 EVENTOS GLOBAIS E SOCKET
// ==========================================

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

socket.on('mudancaVez', (dados) => {
    // CORREÇÃO: Limpa destaque ao mudar a vez
    ultimaCartaCompradaId = null;
    cartasSelecionadas = [];
    
    if (ultimoEstadoSala) {
        ultimoEstadoSala.vez = dados.vez;
        ultimoEstadoSala.estadoTurno = dados.estado;
        atualizarMesa(ultimoEstadoSala);
    }
});

socket.on('cartaComprada', (dados) => {
    ultimaCartaCompradaId = dados.cartaId;
});

socket.on('erroJogo', (msg) => alert(msg));

socket.on('fimDeJogo', (dados) => {
    const modal = document.getElementById('modal-fim');
    if(modal) modal.style.display = 'flex';
    if(document.getElementById('p1-total')) {
        document.getElementById('p1-total').innerText = dados.placar.p1;
        document.getElementById('p2-total').innerText = dados.placar.p2;
    }
});

// Expor funções para o HTML
window.acaoBaixar = acaoBaixar;
window.acaoDescartar = acaoDescartar;
window.acaoLimpar = acaoLimpar;
window.acaoOrdenar = acaoOrdenar;
window.pedirReset = pedirReset;
window.fazerLogout = fazerLogout;
window.jogarAnonimo = jogarAnonimo;
window.fazerLogin = fazerLogin;
window.entrarModoTreino = entrarModoTreino;
window.toggleChat = toggleChat;
window.enviarMensagem = enviarMensagem;
// Aliases
window.tentarBaixarJogo = acaoBaixar;
window.descartarCartaSelecionadas = acaoDescartar;
window.limparSelecao = acaoLimpar;
window.alternarOrdenacao = acaoOrdenar;

