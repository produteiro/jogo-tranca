let userId = localStorage.getItem('tranca_userId');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('tranca_userId', userId);
}

// AQUI ESTAVA O PROBLEMA: Esta linha deve aparecer apenas UMA vez
const socket = io(); 

let meuIdNoJogo = null;
let vezAtual = null;
let estadoTurno = 'aguardando';
let cartasSelecionadas = [];
let minhaMaoLocal = [];
let cartaDestaque = null;
let usuarioLogado = null;

socket.on('connect', () => {
    const usuarioSalvo = localStorage.getItem('tranca_usuario');
    if (usuarioSalvo) {
        const usuario = JSON.parse(usuarioSalvo);
        if (!usuario.anonimo) {
            socket.emit('reentrarJogo', usuario);
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

function fazerLogout() { localStorage.removeItem('tranca_usuario'); window.location.href = window.location.href; }

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

socket.on('estadoAbsoluto', d => { configurarEstadoJogo(d); mostrarMesa(); });

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
    if (d.jogosNaMesa) d.jogosNaMesa.forEach((jogosEquipe, idEquipe) => { if (jogosEquipe) jogosEquipe.forEach((cartas, idxJogo) => { renderizarJogoMesa(idEquipe, cartas, idxJogo); }); });
    atualizarLixoVisual(d.lixoTopo); 
    atualizarMonteVisual(d.topoMonte, d.qtdMonte); 
    atualizarPlacarVisual(d.placar); 
    atualizarStatus();
}

function obterUrlCarta(f, n) {
    if (!f || !n) return '';
    const m = { 'copas': 'H', 'ouros': 'D', 'paus': 'C', 'espadas': 'S' };
    return `https://deckofcardsapi.com/static/img/${f === '10' ? '0' : f}${m[n]}.png`;
}

function obterClasseVerso(origem) {
    if (origem === 'vermelho') return 'carta-verso verso-vermelho';
    return 'carta-verso verso-azul';
}

function obterElementoMao(idJogador) {
    if (idJogador === meuIdNoJogo) return document.getElementById('minha-mao');
    const diff = (idJogador - meuIdNoJogo + 4) % 4;
    if (diff === 1) return document.getElementById('mao-esquerda');
    if (diff === 2) return document.getElementById('mao-topo');
    if (diff === 3) return document.getElementById('mao-direita');
    return document.body;
}

function mostrarBalao(idJogador, msg) {
    const area = document.getElementById('area-baloes'); 
    const balao = document.createElement('div');
    balao.className = 'balao-fala';
    balao.innerText = msg;
    let posRelativa = 'balao-eu';
    if (idJogador !== meuIdNoJogo) {
        const diff = (idJogador - meuIdNoJogo + 4) % 4;
        if (diff === 1) posRelativa = 'balao-esq';
        if (diff === 2) posRelativa = 'balao-topo';
        if (diff === 3) posRelativa = 'balao-dir';
    } else {
        balao.classList.add('balao-eu');
    }
    balao.classList.add(posRelativa);
    area.appendChild(balao);
    setTimeout(() => {
        balao.style.opacity = '0';
        setTimeout(() => balao.remove(), 500);
    }, 4000);
}

function renderizarCartas(cartas) {
    const div = document.getElementById('minha-mao');
    if (!div) return;
    div.innerHTML = "";
    if (!cartas || !Array.isArray(cartas)) return;
    if (cartas.length >= 11) div.classList.add('mao-cheia'); else div.classList.remove('mao-cheia');
    cartas.forEach((c, i) => {
        const cd = document.createElement('div');
        let isDestaque = false;
        if (cartaDestaque) {
            if (c.id && cartaDestaque.id) isDestaque = (c.id === cartaDestaque.id);
            else isDestaque = (c.face === cartaDestaque.face && c.naipe === cartaDestaque.naipe);
        }
        cd.id = `carta-mao-${i}`;
        let classes = 'carta';
        if (isDestaque) classes += ' nova-carta';
        if (cartasSelecionadas.includes(i)) classes += ' selecionada';
        cd.className = classes;
        cd.onclick = () => {
            const p = cartasSelecionadas.indexOf(i);
            if (p > -1) cartasSelecionadas.splice(p, 1); else cartasSelecionadas.push(i);
            renderizarCartas(cartas);
        };
        const img = document.createElement('img');
        img.src = obterUrlCarta(c.face, c.naipe);
        cd.appendChild(img); div.appendChild(cd);
    });
}

function renderizarMaosAdversarios(maosCount) {
    if (!maosCount || meuIdNoJogo === null) return;
    const idsDivs = ['mao-esquerda', 'mao-topo', 'mao-direita'];
    const idsInfos = ['info-esq', 'info-topo', 'info-dir'];
    for (let i = 1; i <= 3; i++) {
        const idxReal = (meuIdNoJogo + i) % 4;
        const div = document.getElementById(idsDivs[i-1]);
        if (div) {
            div.innerHTML = "";
            const count = maosCount[idxReal] || 0;
            for (let j = 0; j < count; j++) {
                const card = document.createElement('div');
                card.className = "carta-miniatura"; 
                div.appendChild(card);
            }
        }
        const divInfo = document.getElementById(idsInfos[i-1]);
        if (divInfo) divInfo.innerText = `Bot ${idxReal+1} (${maosCount[idxReal]})`;
    }
}

function renderizarMortos(estado) {
    const m1 = document.getElementById('morto1');
    const m2 = document.getElementById('morto2');
    if (m1) { m1.style.display = estado.morto1 ? 'block' : 'none'; m1.className = "pilha-morto " + obterClasseVerso('azul'); }
    if (m2) { m2.style.display = estado.morto2 ? 'block' : 'none'; m2.className = "pilha-morto cruzado " + obterClasseVerso('vermelho'); }
}

function adicionarTresVermelhoNaMesa(idJogador, c) {
    const minhaEquipe = meuIdNoJogo % 2;
    const equipeDeles = idJogador % 2;
    const containerId = (minhaEquipe === equipeDeles) ? 'meus-jogos' : 'jogos-adversarios';
    const container = document.getElementById(containerId);
    const jaTem = Array.from(container.querySelectorAll('img')).some(i => i.src.includes(obterUrlCarta(c.face, c.naipe)));
    if(jaTem) return;
    const div = document.createElement('div');
    div.className = 'carta tres-vermelho-bonus';
    const img = document.createElement('img');
    img.src = obterUrlCarta(c.face, c.naipe);
    div.appendChild(img);
    container.insertBefore(div, container.children[1] || null);
}

function comprarDoMonte() { 
    if (vezAtual === meuIdNoJogo && estadoTurno === 'comprando') {
        socket.emit('comprarCarta'); 
    } else {
        const m = document.getElementById('monte');
        m.style.transform = "translateX(5px)";
        setTimeout(() => m.style.transform = "translateX(-5px)", 100);
        setTimeout(() => m.style.transform = "translateX(0)", 200);
    }
}

function responderDecisao(aceitou) { document.getElementById('modal-decisao').style.display = 'none'; socket.emit('responderPrimeiraCarta', aceitou); }
function tentarBaixarJogo(idxMesa = null) { if (vezAtual === meuIdNoJogo && cartasSelecionadas.length > 0) { socket.emit('baixarJogo', { indices: cartasSelecionadas, indexJogoMesa: idxMesa }); cartasSelecionadas = []; } }
function interagirComLixo() {
    if (vezAtual !== meuIdNoJogo) return;
    if (estadoTurno === 'comprando') {
        const lixo = document.getElementById('lixo');
        if (lixo.classList.contains('trancado')) { alert("Lixo TRANCADO com 3 Preto! Compre do monte."); return; }
        socket.emit('comprarLixo', []); 
        cartasSelecionadas = [];
    } else if (estadoTurno === 'descartando') {
        if (cartasSelecionadas.length === 1) {
            socket.emit('descartarCarta', cartasSelecionadas[0]);
            cartasSelecionadas = [];
        } else { alert("Selecione exatamente 1 carta para descartar!"); }
    }
}
function pedirReset() { if(confirm("Reiniciar partida?")) socket.emit('reiniciarPartida'); }
function jogarNovamente() { socket.emit('reiniciarPartida'); }

function alternarOrdenacao() { 
    const btn = document.querySelector('.btn-icone[title="Ordenar Cartas"]');
    if(btn) { btn.style.transform = "rotate(180deg)"; setTimeout(() => { btn.style.transform = "rotate(0deg)"; }, 300); }
    socket.emit('alternarOrdenacao'); 
    cartasSelecionadas = []; 
}

function atualizarStatus() {
    const info = document.getElementById('info-jogo');
    const monte = document.getElementById('monte');
    const lixo = document.getElementById('lixo');
    if(monte) monte.classList.remove('ativo-brilhando');
    if(lixo) lixo.classList.remove('ativo-brilhando');
    if (vezAtual === meuIdNoJogo) {
        info.innerText = "SUA VEZ! JOGUE AGORA"; 
        info.style.color = "#f1c40f";
        if (estadoTurno === 'comprando') {
            if(monte) monte.classList.add('ativo-brilhando');
            if(lixo) lixo.classList.add('ativo-brilhando');
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
function fecharModalFim() { document.getElementById('modal-fim').style.display = 'none'; }

socket.on('animacaoJogada', (dados) => {});
socket.on('receberChat', (dados) => {
    const msgs = document.getElementById('chat-msgs'); const div = document.createElement('div');
    if (dados.sistema) { div.style.color = "#f1c40f"; div.style.fontStyle = "italic"; div.style.textAlign = "center"; div.innerText = dados.msg; } else { div.style.background = "#444"; div.style.padding = "5px"; div.style.borderRadius = "5px"; div.innerText = dados.msg; if (dados.idJogador === meuIdNoJogo) div.style.background = "#2980b9"; mostrarBalao(dados.idJogador, dados.msg); }
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
});
socket.on('decisaoPrimeiraCarta', (carta) => { const modal = document.getElementById('modal-decisao'); const divCarta = document.getElementById('carta-decisao'); divCarta.innerHTML = ""; const img = document.createElement('img'); img.src = obterUrlCarta(carta.face, carta.naipe); img.style.width = "100%"; img.style.height = "100%"; img.style.borderRadius = "6px"; divCarta.appendChild(img); modal.style.display = 'flex'; });
socket.on('cartaComprada', d => { 
    minhaMaoLocal = d.mao; cartaDestaque = d.cartaNova; estadoTurno = 'descartando'; 
    renderizarCartas(minhaMaoLocal);
    atualizarStatus();
});
socket.on('atualizarPlacar', d => atualizarPlacarVisual(d));
socket.on('atualizarContadores', d => {
    const badgeMonte = document.getElementById('qtd-monte'); if(badgeMonte) badgeMonte.innerText = d.monte;
    const badgeLixo = document.getElementById('qtd-lixo'); if(badgeLixo) badgeLixo.innerText = d.lixo;
});
socket.on('maoAtualizada', d => { minhaMaoLocal = d.mao; renderizarCartas(minhaMaoLocal); });
socket.on('vocePegouMorto', () => { alert("VOCÊ PEGOU O MORTO!"); });
socket.on('mudancaVez', d => { vezAtual = d.vez; estadoTurno = d.estado; cartasSelecionadas = []; cartaDestaque = null; atualizarStatus(); });
socket.on('atualizarMaosCount', d => renderizarMaosAdversarios(d));
socket.on('atualizarMortos', d => renderizarMortos(d));
socket.on('atualizarLixo', d => atualizarLixoVisual(d));
socket.on('lixoLimpo', () => { document.getElementById('carta-lixo').innerHTML = ""; document.getElementById('lixo').classList.remove('trancado'); });
socket.on('tresVermelhoRevelado', d => adicionarTresVermelhoNaMesa(d.idJogador, d.carta));
socket.on('mesaAtualizada', d => { const cont = obterContainerJogo(d.idJogador); const g = criarGrupoElemento(d.idJogador, cont.querySelectorAll('.grupo-baixado').length); d.cartas.forEach(c => adicionarCartaAoGrupo(g, c)); cont.appendChild(g); atualizarVisualCanastra(g, d.cartas); });
socket.on('jogoAtualizado', d => { const cont = obterContainerJogo(d.idJogador); const g = cont.querySelectorAll('.grupo-baixado')[d.indexJogo]; if (g) { g.innerHTML = ""; d.cartas.forEach(c => adicionarCartaAoGrupo(g, c)); atualizarVisualCanastra(g, d.cartas); } });
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
    localStorage.removeItem('tranca_salaAtual');
});

function obterContainerJogo(idJogador) { const minhaEquipe = meuIdNoJogo % 2; const equipeDeles = idJogador % 2; const alvo = (minhaEquipe === equipeDeles) ? 'meus-jogos' : 'jogos-adversarios'; return document.getElementById(alvo); }
function criarGrupoElemento(idJogador, index) { const g = document.createElement('div'); g.className = 'grupo-baixado'; const minhaEquipe = meuIdNoJogo % 2; const equipeDeles = idJogador % 2; if (minhaEquipe === equipeDeles) { g.onclick = (e) => { e.stopPropagation(); tentarBaixarJogo(index); }; } return g; }
function adicionarCartaAoGrupo(grupo, c) { const div = document.createElement('div'); div.className = 'carta'; const img = document.createElement('img'); img.src = obterUrlCarta(c.face, c.naipe); div.appendChild(img); grupo.appendChild(div); }
function atualizarVisualCanastra(grupoDiv, cartas) {
    grupoDiv.classList.remove('canastra-limpa', 'canastra-suja');
    if (cartas.length >= 7) {
        const temCuringa = cartas.some(c => c.face === '2');
        if (temCuringa) grupoDiv.classList.add('canastra-suja');
        else grupoDiv.classList.add('canastra-limpa');
    }
}
function renderizarJogoMesa(idEquipe, cartas, idxJogo) { 
    const cont = obterContainerJogo(idEquipe); 
    const g = criarGrupoElemento(idEquipe, idxJogo);
    cartas.forEach(c => adicionarCartaAoGrupo(g, c));
    atualizarVisualCanastra(g, cartas);
    cont.appendChild(g); 
}
