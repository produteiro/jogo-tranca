let userId = localStorage.getItem('tranca_userId');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('tranca_userId', userId);
}

const socket = io(); 

let meuIdNoJogo = null;
let vezAtual = null;
let estadoTurno = 'aguardando';
let cartasSelecionadas = [];
let minhaMaoLocal = [];
let cartaDestaque = null;
let usuarioLogado = null;
let estadoJogoSalvo = null; // Para recuperar estado após refresh

// ==========================================
// 🆕 SISTEMA DE RECUPERAÇÃO DE ESTADO
// ==========================================

function salvarEstadoLocal() {
    if (!meuIdNoJogo || meuIdNoJogo === null) return;
    
    const estado = {
        meuIdNoJogo,
        vezAtual,
        estadoTurno,
        minhaMaoLocal,
        timestamp: Date.now()
    };
    
    localStorage.setItem('tranca_estado_jogo', JSON.stringify(estado));
}

function tentarRecuperarEstado() {
    const estadoSalvo = localStorage.getItem('tranca_estado_jogo');
    if (!estadoSalvo) return false;
    
    try {
        const estado = JSON.parse(estadoSalvo);
        
        // Verifica se o estado não é muito antigo (max 1 hora)
        const umahora = 60 * 60 * 1000;
        if (Date.now() - estado.timestamp > umahora) {
            localStorage.removeItem('tranca_estado_jogo');
            return false;
        }
        
        estadoJogoSalvo = estado;
        console.log('✅ Estado recuperado do localStorage');
        return true;
    } catch (e) {
        console.error('Erro ao recuperar estado:', e);
        return false;
    }
}

// Salva estado sempre que mudar algo importante
function autoSalvarEstado() {
    setTimeout(() => salvarEstadoLocal(), 100);
}

socket.on('connect', () => {
    const usuarioSalvo = localStorage.getItem('tranca_usuario');
    if (usuarioSalvo) {
        const usuario = JSON.parse(usuarioSalvo);
        if (!usuario.anonimo) {
            socket.emit('reentrarJogo', usuario);
            socket.usuarioLogado = usuario;
            
            // Tenta recuperar estado do jogo
            if (tentarRecuperarEstado()) {
                socket.emit('solicitarEstadoAtual');
            }
        } else {
            localStorage.removeItem('tranca_usuario');
            mostrarTelaLogin();
        }
    } else {
        mostrarTelaLogin();
    }
});

socket.on('reentradaSucesso', () => { usuarioLogado = JSON.parse(localStorage.getItem('tranca_usuario')); });
socket.on('reentradaErro', () => { const usuarioSalvo = localStorage.getItem('tranca_usuario'); if (usuarioSalvo) { usuarioLogado = JSON.parse(usuarioSalvo); mostrarLobby(); } else { mostrarTelaLogin(); } });

function mostrarTelaLogin() {
    document.getElementById('tela-login').style.display = 'flex';
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('mesa').style.display = 'none';
    document.getElementById('modal-fim').style.display = 'none';
}

function mostrarLobby() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('lobby').style.display = 'flex';
    document.getElementById('mesa').style.display = 'none';
    document.getElementById('modal-fim').style.display = 'none';
    if(usuarioLogado) document.getElementById('boas-vindas').innerText = `Olá, ${usuarioLogado.nome}!`;
    const btn = document.getElementById('btn-jogar-bot');
    if(btn) btn.innerText = "Jogar vs Bots";
}

function mostrarMesa() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('mesa').style.display = 'flex';
    document.getElementById('barra-ferramentas').style.display = 'flex'; 
    document.getElementById('janela-chat').style.display = 'none';
}

function fazerLogout() { 
    localStorage.removeItem('tranca_usuario');
    localStorage.removeItem('tranca_estado_jogo');
    window.location.href = window.location.href; 
}

let modoRegistro = false;
function alternarFormulario() {
    modoRegistro = !modoRegistro;
    const nomeInput = document.getElementById('nome');
    const titulo = document.getElementById('titulo-form');
    const btn = document.getElementById('btn-acao-login');
    const toggle = document.querySelector('.link-toggle');
    if (modoRegistro) {
        nomeInput.style.display = 'block';
        titulo.innerText = "Criar Conta";
        btn.innerText = "CADASTRAR";
        toggle.innerText = "Já tenho conta";
    } else {
        nomeInput.style.display = 'none';
        titulo.innerText = "Login";
        btn.innerText = "ENTRAR";
        toggle.innerText = "Criar nova conta";
    }
}

function fazerLogin() {
    const email = document.getElementById('email').value;
    const senha = document.getElementById('senha').value;
    const nome = document.getElementById('nome').value;
    if (!email || !senha) return alert("Preencha e-mail e senha!");
    if (modoRegistro) {
        if (!nome) return alert("Preencha seu nome!");
        socket.emit('registro', { email, senha, nome });
    } else {
        socket.emit('login', { email, senha });
    }
}

function jogarAnonimo() {
    const random = Math.floor(1000 + Math.random() * 9000); 
    const nick = `*anonimo${random}`;
    socket.emit('loginAnonimo', nick);
}

socket.on('loginSucesso', (usuario) => {
    usuarioLogado = usuario;
    socket.usuarioLogado = usuario;
    if (!usuario.anonimo) localStorage.setItem('tranca_usuario', JSON.stringify(usuario));
    mostrarLobby();
});

socket.on('erroLogin', (msg) => { document.getElementById('msg-erro').innerText = msg; if(msg === "Você precisa estar logado!") mostrarTelaLogin(); });

function entrarModoTreino() {
    const btn = document.getElementById('btn-jogar-bot');
    if(btn) btn.innerText = "Carregando...";
    setTimeout(() => { if(document.getElementById('mesa').style.display === 'none') btn.innerText = "Jogar vs Bots"; }, 5000);
    socket.emit('entrarSala', 'treino');
}

socket.on('estadoAbsoluto', d => { configurarEstadoJogo(d); mostrarMesa(); autoSalvarEstado(); });

socket.on('inicioPartida', d => {
    document.getElementById('meus-jogos').innerHTML = '<div class="watermark">SEUS JOGOS</div>';
    document.getElementById('jogos-adversarios').innerHTML = '<div class="watermark">JOGOS ADVERSÁRIOS</div>';
    document.getElementById('carta-lixo').innerHTML = '';
    document.getElementById('lixo').classList.remove('trancado');
    document.getElementById('pts-nos').innerText = "0";
    document.getElementById('pts-eles').innerText = "0";
    meuIdNoJogo = d.idNoJogo;
    minhaMaoLocal = d.mao;
    vezAtual = d.vezInicial; 
    estadoTurno = 'comprando';
    renderizarCartas(minhaMaoLocal);
    renderizarMaosAdversarios(d.maosCount);
    renderizarMortos({ morto1: true, morto2: true });
    atualizarMonteVisual(d.topoMonte, d.qtdMonte);
    if (d.tresVermelhos) d.tresVermelhos.forEach((cartas, idEquipe) => { if (cartas) cartas.forEach(c => adicionarTresVermelhoNaMesa(idEquipe, c)); });
    mostrarMesa();
    atualizarStatus();
    autoSalvarEstado();
});

function configurarEstadoJogo(d) {
    meuIdNoJogo = d.seuIndice; 
    vezAtual = d.vez; 
    estadoTurno = d.estadoTurno; 
    minhaMaoLocal = d.suaMao || []; 
    renderizarCartas(minhaMaoLocal); 
    renderizarMaosAdversarios(d.maosCount); 
    renderizarMortos(d.mortos);
    document.getElementById('meus-jogos').innerHTML = '<div class="watermark">SEUS JOGOS</div>'; 
    document.getElementById('jogos-adversarios').innerHTML = '<div class="watermark">JOGOS ADVERSÁRIOS</div>';
    if (d.tresVermelhos) d.tresVermelhos.forEach((cartas, idEquipe) => { if (cartas) cartas.forEach(c => adicionarTresVermelhoNaMesa(idEquipe, c)); });
    if (d.jogosNaMesa) d.jogosNaMesa.forEach((jogosEquipe, idEquipe) => { if (jogosEquipe) jogosEquipe.forEach((cartas, idxJogo) => { renderizarJogoMesaManual(idEquipe, cartas, idxJogo); }); });
    atualizarLixoVisual(d.lixoTopo); 
    atualizarMonteVisual(d.topoMonte, d.qtdMonte); 
    atualizarPlacarVisual(d.placar); 
    atualizarStatus(); 
    autoSalvarEstado();
}

function obterUrlCarta(face, naipe) { 
    if (!face || !naipe) {
        console.error('Carta inválida:', face, naipe);
        return 'https://deckofcardsapi.com/static/img/back.png';
    }
    
    const mapeamentoNaipes = {
        'copas': 'H',
        'ouros': 'D', 
        'paus': 'C',
        'espadas': 'S'
    };
    
    const faceAPI = face === '10' ? '0' : face;
    const naipeAPI = mapeamentoNaipes[naipe.toLowerCase()];
    
    if (!naipeAPI) {
        console.error('Naipe inválido:', naipe);
        return 'https://deckofcardsapi.com/static/img/back.png';
    }
    
    return `https://deckofcardsapi.com/static/img/${faceAPI}${naipeAPI}.png`;
}

// ==========================================
// 🆕 RENDERIZAÇÃO MELHORADA DE CARTAS
// ==========================================

function renderizarCartas(mao) {
    const cont = document.getElementById('minha-mao');
    if (!cont) return;
    cont.innerHTML = "";
    
    console.log('🎴 Renderizando mão:', mao);
    
    mao.forEach((c, i) => {
        if (!c) {
            console.error('❌ Carta nula no índice', i);
            return;
        }
        
        const div = document.createElement('div');
        div.className = 'carta';
        
        // Adiciona classe de selecionada se estiver no array
        if (cartasSelecionadas.includes(i)) {
            div.classList.add('selecionada');
        }
        
        // Destaque para carta recém comprada
        if (cartaDestaque && c.id === cartaDestaque.id) {
            div.classList.add('nova-carta');
        }
        
        const img = document.createElement('img'); 
        const url = obterUrlCarta(c.face, c.naipe);
        img.src = url;
        
        img.onerror = () => {
            console.error('❌ Falha ao carregar:', url, 'Carta:', c);
        };
        
        div.appendChild(img);
        
        // 🆕 CLIQUE AGORA SÓ SELECIONA/DESELECIONA
        div.onclick = () => cliqueNaCarta(i);
        
        cont.appendChild(div);
    });
}

// 🆕 FUNÇÃO DE CLIQUE CORRIGIDA - NÃO DESCARTA AUTOMATICAMENTE
function cliqueNaCarta(i) {
    // Se não for minha vez, não faz nada
    if (vezAtual !== meuIdNoJogo) {
        return;
    }
    
    // MODO DESCARTE: Clique descarta a carta
    if (estadoTurno === 'descartando' && cartasSelecionadas.length === 0) {
        // Confirma descarte
        if (confirm(`Descartar ${minhaMaoLocal[i].face} de ${minhaMaoLocal[i].naipe}?`)) {
            descartarCarta(i);
        }
        return;
    }
    
    // MODO SELEÇÃO: Clique adiciona/remove da seleção
    const idx = cartasSelecionadas.indexOf(i);
    if (idx !== -1) {
        // Já está selecionada - remove
        cartasSelecionadas.splice(idx, 1);
    } else {
        // Não está selecionada - adiciona
        cartasSelecionadas.push(i);
    }
    
    // Re-renderiza para mostrar seleção
    renderizarCartas(minhaMaoLocal);
}

function renderizarMaosAdversarios(counts) {
    const renderizarMaoLateral = (containerId, qtd) => {
        const c = document.getElementById(containerId);
        if (!c) return;
        const cartasExistentes = c.querySelectorAll('.carta-miniatura');
        if (cartasExistentes.length === qtd) return;
        c.innerHTML = "";
        for (let i = 0; i < qtd; i++) { 
            const div = document.createElement('div'); 
            div.className = 'carta-miniatura'; 
            c.appendChild(div); 
        }
    };
    if (counts) {
        renderizarMaoLateral('mao-esquerda', counts[1] || 0);
        renderizarMaoLateral('mao-direita', counts[3] || 0);
        renderizarMaoLateral('mao-topo', counts[2] || 0);
    }
}

function renderizarMortos(info) {
    const m1 = document.getElementById('morto1'); const m2 = document.getElementById('morto2');
    if (m1 && info.morto1 !== undefined) m1.style.display = info.morto1 ? 'block' : 'none';
    if (m2 && info.morto2 !== undefined) m2.style.display = info.morto2 ? 'block' : 'none';
}

function adicionarTresVermelhoNaMesa(idJogador, carta) {
    const minhaEquipe = meuIdNoJogo % 2; const equipeDeles = idJogador % 2;
    const alvo = (minhaEquipe === equipeDeles) ? 'meus-jogos' : 'jogos-adversarios';
    const cont = document.getElementById(alvo);
    if (!cont) return;
    const div = document.createElement('div'); div.className = 'carta tres-vermelho-bonus';
    const img = document.createElement('img'); img.src = obterUrlCarta(carta.face, carta.naipe);
    div.appendChild(img); cont.appendChild(div);
}

function comprarDoMonte() { 
    if (vezAtual === meuIdNoJogo && estadoTurno === 'comprando') {
        cartasSelecionadas = []; // Limpa seleção
        socket.emit('comprarCarta'); 
    }
}

function interagirComLixo() { 
    if (vezAtual === meuIdNoJogo && estadoTurno === 'comprando') {
        cartasSelecionadas = []; // Limpa seleção
        socket.emit('comprarLixo'); 
    }
}

// 🆕 BOTÕES DE AÇÃO PARA BAIXAR JOGO OU DESCARTAR
function tentarBaixarJogo(indexJogoMesa = null) {
    if (vezAtual !== meuIdNoJogo) return;
    
    if (cartasSelecionadas.length === 0) {
        alert("Selecione cartas clicando nelas!");
        return;
    }
    
    if (cartasSelecionadas.length < 3 && indexJogoMesa === null) { 
        alert("Selecione ao menos 3 cartas para criar novo jogo!"); 
        return; 
    }
    
    socket.emit('baixarJogo', { indices: cartasSelecionadas, indexJogoMesa });
    cartasSelecionadas = [];
    renderizarCartas(minhaMaoLocal);
}

function descartarCartaSelecionadas() {
    if (vezAtual !== meuIdNoJogo) return;
    if (estadoTurno !== 'descartando') return;
    
    if (cartasSelecionadas.length !== 1) {
        alert("Selecione APENAS 1 carta para descartar!");
        return;
    }
    
    descartarCarta(cartasSelecionadas[0]);
    cartasSelecionadas = [];
}

function descartarCarta(i) {
    if (vezAtual !== meuIdNoJogo) return;
    if (estadoTurno !== 'descartando') return;
    socket.emit('descartarCarta', i);
}

function atualizarStatus() {
    const info = document.getElementById('info-jogo');
    const monte = document.getElementById('monte');
    const lixo = document.getElementById('lixo');
    if(monte) monte.classList.remove('ativo-brilhando');
    if(lixo) lixo.classList.remove('ativo-brilhando');
    
    if (vezAtual === meuIdNoJogo) {
        if (estadoTurno === 'comprando') {
            info.innerText = "COMPRE DO MONTE OU LIXO"; 
            info.style.color = "#f1c40f";
            if(monte) monte.classList.add('ativo-brilhando');
            if(lixo) lixo.classList.add('ativo-brilhando');
        } else if (estadoTurno === 'descartando') {
            info.innerText = "BAIXE JOGOS OU DESCARTE 1 CARTA";
            info.style.color = "#2ecc71";
        } else {
            info.innerText = "SUA VEZ!";
            info.style.color = "#f1c40f";
        }
    } else {
        info.innerText = `AGUARDANDO JOGADOR ${vezAtual + 1}...`; 
        info.style.color = "#888";
    }
}

function atualizarPlacarVisual(placar) {
    if (!placar) return;
    document.getElementById('pts-nos').innerText = placar.p1;
    document.getElementById('pts-eles').innerText = placar.p2;
}

function atualizarMonteVisual(topoMonte, qtd) {
    const badge = document.getElementById('qtd-monte');
    if (badge && qtd !== undefined) badge.innerText = qtd;
    const m = document.getElementById('monte');
    if (qtd <= 0) m.style.visibility = 'hidden'; else m.style.visibility = 'visible';
}

function atualizarLixoVisual(carta) {
    const l = document.getElementById('carta-lixo');
    if (!l) return;
    l.innerHTML = "";
    if (carta) {
        const div = document.createElement('div'); div.className = "carta"; const img = document.createElement('img'); img.src = obterUrlCarta(carta.face, carta.naipe);
        div.appendChild(img); l.appendChild(div);
        const areaLixo = document.getElementById('lixo');
        if (carta.face === '3' && (carta.naipe === 'paus' || carta.naipe === 'espadas')) { areaLixo.classList.add('trancado'); areaLixo.title = "TRANCADO 🔒"; } 
        else { areaLixo.classList.remove('trancado'); areaLixo.title = "Pegar Lixo"; }
    } else { const areaLixo = document.getElementById('lixo'); areaLixo.classList.remove('trancado'); }
}

function toggleChat() { 
    const chat = document.getElementById('janela-chat'); 
    const badge = document.querySelector('.badge-chat'); 
    if (chat.style.display === 'flex') { chat.style.display = 'none'; } else { chat.style.display = 'flex'; badge.style.display = 'none'; const msgs = document.getElementById('chat-msgs'); msgs.scrollTop = msgs.scrollHeight; } 
}

function enviarMensagem() { const input = document.getElementById('chat-input'); const msg = input.value.trim(); if (msg) { socket.emit('enviarChat', msg); input.value = ""; } }

function pedirReset() {
    if (confirm("Tem certeza que deseja reiniciar a partida?")) {
        socket.emit('reiniciarPartida');
        localStorage.removeItem('tranca_estado_jogo');
    }
}

function alternarOrdenacao() {
    socket.emit('alternarOrdenacao');
}

function jogarNovamente() {
    document.getElementById('modal-fim').style.display = 'none';
    localStorage.removeItem('tranca_estado_jogo');
    socket.emit('reiniciarPartida');
}

function responderDecisao(aceita) {
    const modal = document.getElementById('modal-decisao');
    modal.style.display = 'none';
    socket.emit('decisaoLixo', aceita);
}

function abrirRanking() {
    socket.emit('buscarRanking');
}

socket.on('rankingAtualizado', (ranking) => {
    const modal = document.getElementById('modal-ranking');
    const lista = document.getElementById('lista-ranking');
    lista.innerHTML = '';
    
    ranking.forEach((jogador, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding:8px;">${idx + 1}</td>
            <td style="padding:8px;">${jogador.nome}${jogador.premium ? ' 👑' : ''}</td>
            <td style="padding:8px;">${jogador.vitorias}</td>
            <td style="padding:8px;">${jogador.pontos}</td>
        `;
        lista.appendChild(tr);
    });
    
    modal.style.display = 'flex';
});

function mostrarBalao(idJogador, msg) {
    const areaBaloes = document.getElementById('area-baloes');
    if (!areaBaloes) return;
    
    const balao = document.createElement('div');
    balao.className = 'balao-fala';
    balao.innerText = msg;
    
    if (idJogador === meuIdNoJogo) {
        balao.style.bottom = '200px';
        balao.style.left = '50%';
        balao.style.transform = 'translateX(-50%)';
    } else if (idJogador === ((meuIdNoJogo + 1) % 4)) {
        balao.style.left = '100px';
        balao.style.top = '50%';
        balao.style.transform = 'translateY(-50%)';
    } else if (idJogador === ((meuIdNoJogo + 2) % 4)) {
        balao.style.top = '150px';
        balao.style.left = '50%';
        balao.style.transform = 'translateX(-50%)';
    } else if (idJogador === ((meuIdNoJogo + 3) % 4)) {
        balao.style.right = '100px';
        balao.style.top = '50%';
        balao.style.transform = 'translateY(-50%)';
    }
    
    areaBaloes.appendChild(balao);
    
    setTimeout(() => {
        balao.style.animation = 'fadeOut 0.3s';
        setTimeout(() => balao.remove(), 300);
    }, 3000);
}

socket.on('animacaoJogada', (dados) => {});
socket.on('receberChat', (dados) => {
    const msgs = document.getElementById('chat-msgs'); const div = document.createElement('div');
    if (dados.sistema) { div.style.color = "#f1c40f"; div.style.fontStyle = "italic"; div.style.textAlign = "center"; div.innerText = dados.msg; } else { div.style.background = "#444"; div.style.padding = "5px"; div.style.borderRadius = "5px"; div.innerText = dados.msg; if (dados.idJogador === meuIdNoJogo) div.style.background = "#2980b9"; if (dados.idJogador !== undefined && dados.idJogador !== -1) mostrarBalao(dados.idJogador, dados.msg); }
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
});

socket.on('decisaoPrimeiraCarta', (carta) => { const modal = document.getElementById('modal-decisao'); const divCarta = document.getElementById('carta-decisao'); divCarta.innerHTML = ""; const img = document.createElement('img'); img.src = obterUrlCarta(carta.face, carta.naipe); img.style.width = "100%"; img.style.height = "100%"; img.style.borderRadius = "6px"; divCarta.appendChild(img); modal.style.display = 'flex'; });

socket.on('cartaComprada', d => { 
    minhaMaoLocal = d.mao; 
    cartaDestaque = d.cartaNova; 
    estadoTurno = 'descartando'; 
    cartasSelecionadas = []; // Limpa seleção ao comprar
    renderizarCartas(minhaMaoLocal);
    atualizarStatus();
    autoSalvarEstado();
});

socket.on('atualizarPlacar', d => { atualizarPlacarVisual(d); autoSalvarEstado(); });
socket.on('atualizarContadores', d => {
    const badgeMonte = document.getElementById('qtd-monte'); if(badgeMonte) badgeMonte.innerText = d.monte;
    const badgeLixo = document.getElementById('qtd-lixo'); if(badgeLixo) badgeLixo.innerText = d.lixo;
});
socket.on('maoAtualizada', d => { minhaMaoLocal = d.mao; renderizarCartas(minhaMaoLocal); autoSalvarEstado(); });
socket.on('vocePegouMorto', () => { alert("VOCÊ PEGOU O MORTO!"); });
socket.on('mudancaVez', d => { 
    vezAtual = d.vez; 
    estadoTurno = d.estado; 
    cartasSelecionadas = []; 
    cartaDestaque = null; 
    atualizarStatus(); 
    autoSalvarEstado();
});
socket.on('atualizarMaosCount', d => renderizarMaosAdversarios(d));
socket.on('atualizarMortos', d => renderizarMortos(d));
socket.on('atualizarLixo', d => { atualizarLixoVisual(d); autoSalvarEstado(); });
socket.on('lixoLimpo', () => { document.getElementById('carta-lixo').innerHTML = ""; document.getElementById('lixo').classList.remove('trancado'); });
socket.on('tresVermelhoRevelado', d => adicionarTresVermelhoNaMesa(d.idJogador, d.carta));

socket.on('mesaAtualizada', d => { 
    const cont = obterContainerJogo(d.idJogador); 
    
    if (d.index !== null && d.index >= 0) {
        const grupos = cont.querySelectorAll('.grupo-baixado');
        const grupoExistente = grupos[d.index];
        if (grupoExistente) {
            grupoExistente.innerHTML = "";
            d.cartas.forEach(c => adicionarCartaAoGrupo(grupoExistente, c));
            atualizarVisualCanastra(grupoExistente, d.cartas);
            const minhaEquipe = meuIdNoJogo % 2;
            const equipeDeles = d.idJogador % 2;
            if (minhaEquipe === equipeDeles) {
                grupoExistente.onclick = (e) => { e.stopPropagation(); tentarBaixarJogo(d.index); };
            }
        }
    } else {
        const novoIndex = cont.querySelectorAll('.grupo-baixado').length;
        const g = criarGrupoElemento(d.idJogador, novoIndex);
        d.cartas.forEach(c => adicionarCartaAoGrupo(g, c));
        cont.appendChild(g); 
        atualizarVisualCanastra(g, d.cartas); 
    }
    autoSalvarEstado();
});

socket.on('statusJogo', d => { const msgs = document.getElementById('chat-msgs'); if(msgs) { const div = document.createElement('div'); div.style.color = "#f1c40f"; div.innerText = d.msg; msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight; } });
socket.on('erroJogo', msg => alert(msg));

socket.on('fimDeJogo', d => {
    const modal = document.getElementById('modal-fim');
    const titulo = document.getElementById('titulo-vitoria');
    const minhaEquipe = meuIdNoJogo % 2;
    const venceuEq1 = d.placar.p1 > d.placar.p2;
    const euGanhei = (venceuEq1 && minhaEquipe === 0) || (!venceuEq1 && minhaEquipe === 1);
    if (euGanhei) { titulo.innerText = "VOCÊ VENCEU!"; titulo.style.color = "#2ecc71"; } else { titulo.innerText = "VOCÊ PERDEU"; titulo.style.color = "#e74c3c"; }
    document.getElementById('p1-batida').innerText = d.detalhes.p1.ptsBatida;
    document.getElementById('p1-morto').innerText = d.detalhes.p1.ptsMorto;
    document.getElementById('p1-limpa').innerText = d.detalhes.p1.ptsCanastrasLimpas;
    document.getElementById('p1-suja').innerText = d.detalhes.p1.ptsCanastrasSujas;
    document.getElementById('p1-3ver').innerText = d.detalhes.p1.pts3Vermelhos;
    document.getElementById('p1-cartas').innerText = d.detalhes.p1.ptsCartasMesa + d.detalhes.p1.ptsCartasMao;
    document.getElementById('p1-total').innerText = d.placar.p1;
    document.getElementById('p2-batida').innerText = d.detalhes.p2.ptsBatida;
    document.getElementById('p2-morto').innerText = d.detalhes.p2.ptsMorto;
    document.getElementById('p2-limpa').innerText = d.detalhes.p2.ptsCanastrasLimpas;
    document.getElementById('p2-suja').innerText = d.detalhes.p2.ptsCanastrasSujas;
    document.getElementById('p2-3ver').innerText = d.detalhes.p2.pts3Vermelhos;
    document.getElementById('p2-cartas').innerText = d.detalhes.p2.ptsCartasMesa + d.detalhes.p2.ptsCartasMao;
    document.getElementById('p2-total').innerText = d.placar.p2;
    modal.style.display = 'flex';
    localStorage.removeItem('tranca_estado_jogo');
});

function obterContainerJogo(idJogador) { const minhaEquipe = meuIdNoJogo % 2; const equipeDeles = idJogador % 2; const alvo = (minhaEquipe === equipeDeles) ? 'meus-jogos' : 'jogos-adversarios'; return document.getElementById(alvo); }

function criarGrupoElemento(idJogador, index) { 
    const g = document.createElement('div'); 
    g.className = 'grupo-baixado'; 
    const minhaEquipe = meuIdNoJogo % 2; 
    const equipeDeles = idJogador % 2; 
    if (minhaEquipe === equipeDeles) { 
        g.onclick = (e) => { e.stopPropagation(); tentarBaixarJogo(index); }; 
    } 
    return g; 
}

function adicionarCartaAoGrupo(grupo, c) { const div = document.createElement('div'); div.className = 'carta'; const img = document.createElement('img'); img.src = obterUrlCarta(c.face, c.naipe); div.appendChild(img); grupo.appendChild(div); }

function atualizarVisualCanastra(grupoDiv, cartas) {
    grupoDiv.classList.remove('canastra-limpa', 'canastra-suja');
    if (cartas.length >= 7) {
        const temCuringa = cartas.some(c => c.face === '2');
        if (temCuringa) grupoDiv.classList.add('canastra-suja');
        else grupoDiv.classList.add('canastra-limpa');
    }
}

function renderizarJogoMesaManual(idEquipe, cartas, idxJogo) { 
    const cont = obterContainerJogo(idEquipe); 
    const g = criarGrupoElemento(idEquipe, idxJogo);
    cartas.forEach(c => adicionarCartaAoGrupo(g, c));
    atualizarVisualCanastra(g, cartas);
    cont.appendChild(g); 
}
