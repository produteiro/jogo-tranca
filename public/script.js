const socket = io();
let meuId = null;
let meuIndex = -1;
let turnoAtivo = false;
let cartasSelecionadas = [];

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
        // Tenta reconexão automática ou login anônimo rápido
        socket.emit('loginAnonimo', JSON.parse(sessao).nome);
    }
};

function fazerLogin() { alert("Use o botão jogar como visitante por enquanto."); }
function jogarAnonimo() { 
    const nome = 'Visitante-' + Math.floor(Math.random()*1000);
    socket.emit('loginAnonimo', nome); 
    // Feedback visual imediato
    const btn = document.querySelector('button[onclick="jogarAnonimo()"]');
    if(btn) btn.innerText = "Entrando...";
}

socket.on('loginSucesso', (user) => {
    console.log("Login OK:", user);
    localStorage.setItem('tranca_sessao', JSON.stringify(user));
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('lobby').style.display = 'flex';
});

function entrarModoTreino() {
    console.log("Entrando na sala de treino...");
    socket.emit('entrarSala', 'treino');
    document.getElementById('lobby').innerHTML = '<h2>Entrando na partida...</h2>';
}

// --- JOGO ---
socket.on('estadoJogo', (sala) => {
    // Assim que receber estado, esconde o loading
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('mesa').style.display = 'flex';
    
    atualizarMesa(sala);
});

function atualizarMesa(sala) {
    // Descobre quem sou eu
    meuIndex = sala.jogadores.findIndex(id => id === socket.id);
    if (meuIndex === -1 && sala.donos) meuIndex = sala.donos.findIndex(id => id === socket.id);
    
    // Se não me achei, não faço nada (ou sou espectador)
    if (meuIndex === -1) return;

    turnoAtivo = (sala.vez === meuIndex);
    const estado = sala.estadoTurno;
    
    // 1. ATUALIZA HEADER
    const infoJogo = document.getElementById('info-jogo');
    if (infoJogo) {
        if (turnoAtivo) {
            infoJogo.innerText = `SUA VEZ (${estado === 'comprando' ? 'COMPRE' : 'JOGUE'})`;
            infoJogo.style.color = '#f1c40f';
        } else {
            infoJogo.innerText = `VEZ DE: ${sala.jogadores[sala.vez]}`;
            infoJogo.style.color = '#fff';
        }
    }

    // 2. ATUALIZA MONTE E LIXO
    const elMonte = document.getElementById('monte'); // Pode ser #monte ou #qtd-monte
    if(elMonte && sala.jogo.monte.length === 0) elMonte.style.opacity = '0.5';
    else if(elMonte) elMonte.style.opacity = '1';

    const divLixo = document.getElementById('lixo');
    if (divLixo) {
        divLixo.innerHTML = '';
        if (sala.jogo.lixo.length > 0) {
            const topo = sala.jogo.lixo[sala.jogo.lixo.length - 1];
            divLixo.innerHTML = `<div class="carta"><img src="${getImgUrl(topo)}"></div>`;
        } else {
            divLixo.innerHTML = '<div style="color:rgba(255,255,255,0.2); font-size:10px;">LIXO</div>';
        }
        
        // Clique Lixo
        divLixo.onclick = () => {
            if (!turnoAtivo) return;
            if (estado === 'comprando') socket.emit('jogada', { acao: 'comprarLixo', dados: {} });
            else if (cartasSelecionadas.length === 1) {
                socket.emit('jogada', { acao: 'descartar', dados: { index: cartasSelecionadas[0] } });
                cartasSelecionadas = [];
            }
        };
    }
    
    // Clique Monte
    if(elMonte) elMonte.onclick = () => {
        if (turnoAtivo && estado === 'comprando') socket.emit('jogada', { acao: 'comprarMonte', dados: {} });
    };

    // 3. RENDERIZA MINHA MÃO
    const mao = sala.jogo[`maoJogador${meuIndex + 1}`];
    renderizarMinhaMao(mao);

    // 4. RENDERIZA JOGOS NA MESA
    const idEq = meuIndex % 2;
    renderizarJogos('area-jogos-expostos', sala.jogo.jogosNaMesa[idEq], true); // Meus jogos
    
    // Se tiver área separada para adversários, renderize aqui. 
    // No layout novo parece ser tudo na mesma área ou não especificado, 
    // mas vamos garantir a lógica:
    
    // 5. MÃOS ADVERSÁRIAS (Contagem)
    atualizarAdversarios(sala);
}

function renderizarMinhaMao(cartas) {
    const div = document.querySelector('.area-cartas-relativa');
    if(!div) return;
    div.innerHTML = '';
    
    cartas.forEach((c, i) => {
        const el = document.createElement('div');
        el.className = 'carta';
        if (cartasSelecionadas.includes(i)) el.classList.add('selecionada');
        el.innerHTML = `<img src="${getImgUrl(c)}">`;
        el.onclick = (e) => { e.stopPropagation(); toggleSelecao(i); };
        div.appendChild(el);
    });
}

function toggleSelecao(i) {
    if (cartasSelecionadas.includes(i)) cartasSelecionadas = cartasSelecionadas.filter(x => x !== i);
    else cartasSelecionadas.push(i);
    
    // Re-renderiza só para atualizar classe CSS
    const sala = window.ultimoEstadoSala; // Se tivermos salvo. Se não, espera prox update.
    // Hack rápido: atualiza classes direto no DOM para não depender de state global
    document.querySelectorAll('.area-cartas-relativa .carta').forEach((el, idx) => {
        if(cartasSelecionadas.includes(idx)) el.classList.add('selecionada');
        else el.classList.remove('selecionada');
    });
}

function renderizarJogos(idDiv, jogos, ehMeu) {
    const div = document.getElementsByClassName(idDiv)[0]; // Pega pela classe se ID falhar
    if(!div) return;
    div.innerHTML = ''; // Limpa
    
    jogos.forEach((jogo, idxJogo) => {
        const grupo = document.createElement('div');
        grupo.className = 'grupo-baixado';
        
        // Clique para encaixar
        if(ehMeu) {
            grupo.onclick = () => {
                if(turnoAtivo && cartasSelecionadas.length > 0) {
                    socket.emit('jogada', { acao: 'baixarJogo', dados: { indices: cartasSelecionadas, indexJogoMesa: idxJogo }});
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

function atualizarAdversarios(sala) {
    // Logica simples: conta cartas e atualiza badges se existirem
    const idxP = (meuIndex + 2) % 4;
    const idxE = (meuIndex + 3) % 4;
    const idxD = (meuIndex + 1) % 4;
    
    const setQtd = (id, qtd) => {
        const el = document.getElementById(id);
        if(el) el.innerText = qtd; // Atualiza texto se for badge
        // Ou desenha versos se for div container (lógica antiga)
        const divMao = document.getElementById('mao-' + id.replace('info-', '')); // ex: mao-topo
        if(divMao) {
             divMao.innerHTML = '';
             for(let k=0; k<qtd; k++) {
                 const card = document.createElement('div');
                 card.className = 'carta-miniatura';
                 divMao.appendChild(card);
             }
        }
    };
    
    setQtd('info-topo', sala.jogo[`maoJogador${idxP+1}`].length);
    setQtd('info-esq', sala.jogo[`maoJogador${idxE+1}`].length);
    setQtd('info-dir', sala.jogo[`maoJogador${idxD+1}`].length);
}

// AÇÕES DA BARRA
function acaoBaixar() {
    if(turnoAtivo && cartasSelecionadas.length >= 3) {
        socket.emit('jogada', { acao: 'baixarJogo', dados: { indices: cartasSelecionadas, indexJogoMesa: null }});
        cartasSelecionadas = [];
    } else {
        alert("Selecione pelo menos 3 cartas.");
    }
}

function acaoDescartar() {
    if(turnoAtivo && cartasSelecionadas.length === 1) {
        socket.emit('jogada', { acao: 'descartar', dados: { index: cartasSelecionadas[0] }});
        cartasSelecionadas = [];
    } else {
        alert("Selecione 1 carta para descartar.");
    }
}

function acaoLimpar() { cartasSelecionadas = []; renderizarMinhaMao([]); /* Força refresh visual se possível ou espera server */ }
function acaoOrdenar() { socket.emit('jogada', { acao: 'ordenar', dados: {} }); }

function pedirReset() {
    if(confirm("Reiniciar jogo?")) {
        console.log("Enviando pedido de reset...");
        socket.emit('resetJogo');
    }
}

function fazerLogout() { localStorage.removeItem('tranca_sessao'); location.reload(); }

// Eventos globais de botão (se usar onclick no HTML)
window.acaoBaixar = acaoBaixar;
window.acaoDescartar = acaoDescartar;
window.acaoLimpar = acaoLimpar;
window.acaoOrdenar = acaoOrdenar;
window.pedirReset = pedirReset;
window.fazerLogout = fazerLogout;
window.jogarAnonimo = jogarAnonimo;
