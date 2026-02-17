const socket = io();
let meuId = null;
let meuIndex = -1;
let turnoAtivo = false;
let cartasSelecionadas = [];
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
    
    // 🆕 LIMPA ESTADO ANTERIOR
    meuIndex = -1;
    turnoAtivo = false;
    cartasSelecionadas = [];
    ultimoEstadoSala = null;
    
    socket.emit('loginAnonimo', nome); 
    
    const btn = document.querySelector('button[onclick="jogarAnonimo()"]');
    if(btn) btn.innerText = "Entrando...";
}

socket.on('loginSucesso', (user) => {
    console.log("✅ Login OK:", user);
    localStorage.setItem('tranca_sessao', JSON.stringify(user));
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('lobby').style.display = 'flex';
    
    // Mostra barra de ferramentas
    const barra = document.getElementById('barra-ferramentas');
    if(barra) barra.style.display = 'flex';
});

// Adicione em qualquer lugar do script.js junto com os outros socket.on
socket.on('receberChat', (dados) => {
    const divMsgs = document.getElementById('chat-msgs');
    if (divMsgs) {
        const p = document.createElement('p');
        // Se for mensagem do sistema (ex: "Jogador pegou morto")
        if (dados.sistema) {
            p.style.color = '#f1c40f';
            p.style.fontStyle = 'italic';
            p.innerText = dados.msg;
        } else {
            p.innerHTML = `<strong>${dados.nome}:</strong> ${dados.msg}`;
        }
        divMsgs.appendChild(p);
        divMsgs.scrollTop = divMsgs.scrollHeight;
        
        // Notificação visual no ícone se o chat estiver fechado
        const chat = document.getElementById('janela-chat');
        if (chat && chat.style.display === 'none') {
            const badge = document.querySelector('.badge-chat');
            if(badge) badge.style.display = 'block';
        }
    }
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
    
    // Guarda estado global
    ultimoEstadoSala = sala;
    
    // Esconde lobby e mostra mesa
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('mesa').style.display = 'flex';
    
    // Mostra barra de ferramentas
    const barra = document.getElementById('barra-ferramentas');
    if(barra) barra.style.display = 'flex';
    
    atualizarMesa(sala);
});

function atualizarMesa(sala) {
    console.log('🔄 Atualizando mesa...');
    // ✅ NOVO: Validação de sala
    if (!sala || !sala.jogo) {
        console.error('❌ Sala inválida:', sala);
        return;
    }    
    // Descobre quem sou eu
    meuIndex = sala.jogadores.findIndex(id => id === socket.id);
    if (meuIndex === -1 && sala.donos) {
        meuIndex = sala.donos.findIndex(id => id === socket.id);
    }
    
    // 🆕 CORREÇÃO: Se ainda não achou, tenta pelos primeiros 4 slots
    if (meuIndex === -1) {
        // Encontra primeiro slot não-bot
        for (let i = 0; i < 4; i++) {
            if (sala.jogadores[i] === socket.id || sala.donos[i] === socket.id) {
                meuIndex = i;
                break;
            }
        }
        
        // Se AINDA não achou, assume que é o primeiro humano (slot 0)
        if (meuIndex === -1) {
            console.warn('⚠️ Forçando meuIndex = 0 (primeiro jogador)');
            meuIndex = 0;
        }
    }
    
    console.log('✅ Meu índice final:', meuIndex);    
    console.log('✅ Meu índice:', meuIndex);
    
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
            infoJogo.innerText = `AGUARDANDO JOGADOR ${sala.vez + 1}...`;
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
    console.log('🔑 Chave da mão:', chaveMao);
    console.log('📦 Jogo completo:', Object.keys(sala.jogo));
    
    const mao = sala.jogo[chaveMao];
    console.log('🃏 Mão encontrada:', mao);
    
    if (mao && Array.isArray(mao)) {
        console.log('✅ Renderizando', mao.length, 'cartas');
        renderizarMinhaMao(mao);
    } else {
        console.error('❌ Mão inválida!', chaveMao, mao);
    }

    // 6. RENDERIZA JOGOS NA MESA
    const idEq = meuIndex % 2;
    const meusJogos = sala.jogo.jogosNaMesa[idEq];
    const jogosAdversarios = sala.jogo.jogosNaMesa[(idEq + 1) % 2];
    
    renderizarJogos('meus-jogos', meusJogos, true);
    renderizarJogos('jogos-adversarios', jogosAdversarios, false);
    renderizarTresVermelhos(sala);

    // 7. RENDERIZA ADVERSÁRIOS
    atualizarAdversarios(sala);
    
    // 8. ATUALIZA BOTÕES DE AÇÃO
    atualizarBotoesAcao(estado);

    // 7. CORREÇÃO MORTOS: Esconde se o array estiver vazio
    const elMorto1 = document.getElementById('morto1');
    const elMorto2 = document.getElementById('morto2');
    
    if (elMorto1) elMorto1.style.display = (sala.jogo.morto1 && sala.jogo.morto1.length > 0) ? 'block' : 'none';
    if (elMorto2) elMorto2.style.display = (sala.jogo.morto2 && sala.jogo.morto2.length > 0) ? 'block' : 'none';
    
    // ...
}
}

// ==========================================
// 🎴 ATUALIZAÇÃO DE ELEMENTOS VISUAIS
// ==========================================

function atualizarPlacar(sala) {
    // Se o servidor já mandou o placar calculado (implementado no broadcastEstado do server.js), usamos ele.
    if (sala.placarCalculado) {
        const idEq = meuIndex % 2;
        // Se eu sou time 0 (par ou ímpar dependendo da lógica), pego p1 ou p2
        // Assumindo: Jogador 1 (index 0) e 3 (index 2) são Time P1
        // Jogador 2 (index 1) e 4 (index 3) são Time P2
        
        const souTimeP1 = (meuIndex % 2 === 0);
        
        const ptsNos = souTimeP1 ? sala.placarCalculado.p1.total : sala.placarCalculado.p2.total;
        const ptsEles = souTimeP1 ? sala.placarCalculado.p2.total : sala.placarCalculado.p1.total;

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
    
    // Atualiza o número da bolinha
    if (badge) badge.innerText = qtd;
    
    if (elMonte) {
        // Visual: Opacidade se estiver vazio
        elMonte.style.opacity = (qtd === 0) ? '0.3' : '1';
        elMonte.style.cursor = (qtd === 0) ? 'not-allowed' : 'pointer';
        
        // Remove classes antigas para limpar estado
        elMonte.classList.remove('ativo-brilhando');
        elMonte.onclick = null; // Limpa clicks antigos para não acumular

        // Visual: Adiciona brilho se for a vez de comprar
        if (turnoAtivo && sala.estadoTurno === 'comprando' && qtd > 0) {
            elMonte.classList.add('ativo-brilhando');
        }

        // Lógica de Clique:
        // Define o clique SEMPRE (se tiver cartas), para evitar que o botão fique "morto".
        // O servidor validará se é a vez.
        if (qtd > 0) {
            elMonte.onclick = () => {
                console.log('🖱️ CLIQUE NO MONTE - Enviando solicitação...');
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
    
    // Limpa eventos anteriores
    areaLixo.onclick = null;
    areaLixo.classList.remove('ativo-brilhando');

    // LÓGICA DE INTERAÇÃO (COMPRAR OU DESCARTAR)
    areaLixo.onclick = () => {
        if (!turnoAtivo) return;

        // Caso 1: Comprar Lixo
        if (estado === 'comprando' && qtd > 0) {
            console.log('🗑️ Pegando lixo...');
            socket.emit('jogada', { acao: 'comprarLixo', dados: {} });
        }
        // Caso 2: Descartar no Lixo (CORREÇÃO DE USABILIDADE)
        else if (estado === 'descartando') {
            if (cartasSelecionadas.length === 1) {
                console.log('🗑️ Descartando carta:', cartasSelecionadas[0]);
                socket.emit('jogada', { acao: 'descartar', dados: { index: cartasSelecionadas[0] } });
                cartasSelecionadas = []; // Limpa seleção
                atualizarVisualSelecao();
            } else {
                alert("Selecione 1 carta para descartar clicando nela.");
            }
        }
    };

    // Renderização Visual
    if (qtd > 0) {
        const topo = sala.jogo.lixo[qtd - 1];
        const cartaDiv = document.createElement('div');
        cartaDiv.className = 'carta';
        cartaDiv.innerHTML = `<img src="${getImgUrl(topo)}">`;
        divLixo.appendChild(cartaDiv);
        
        // Brilho apenas se puder comprar
        if (turnoAtivo && estado === 'comprando') {
            areaLixo.classList.add('ativo-brilhando');
        }
    } else {
        // Se estiver vazio, mas for hora de descartar, permite clique (área vazia)
        divLixo.innerHTML = '<div style="color:rgba(255,255,255,0.2); font-size:14px; padding:20px;">LIXO</div>';
    }
}

// CORREÇÃO 2: Função para mostrar os 3 Vermelhos na mesa (Visualização do Placar)
function renderizarTresVermelhos(sala) {
    if (!sala.jogo.tresVermelhos) return;
    const idEq = meuIndex % 2;
    const adversarioEq = (idEq + 1) % 2;
    
    const desenhar = (containerId, cartas) => {
        const div = document.getElementById(containerId);
        if (!div || !cartas || cartas.length === 0) return;
        
        // Evita duplicar se já renderizou (verifica se já tem o container dos 3 vermelhos)
        if (div.querySelector('.tres-vermelhos-grupo')) return; 

        const grupo = document.createElement('div');
        grupo.className = 'grupo-baixado tres-vermelhos-grupo';
        grupo.style.border = '2px dashed #e74c3c'; 
        grupo.style.opacity = '0.9';
        grupo.title = "3 Vermelhos";

        cartas.forEach(c => {
            const el = document.createElement('div');
            el.className = 'carta tres-vermelho-bonus'; 
            el.innerHTML = `<img src="${getImgUrl(c)}">`;
            grupo.appendChild(el);
        });
        div.prepend(grupo); 
    };

    desenhar('meus-jogos', sala.jogo.tresVermelhos[idEq]);
    desenhar('jogos-adversarios', sala.jogo.tresVermelhos[adversarioEq]);
}

function atualizarAdversarios(sala) {
    if (!sala.jogo) return;
    
    // Calcula índices relativos
    const idxTopo = (meuIndex + 2) % 4;
    const idxEsq = (meuIndex + 1) % 4;
    const idxDir = (meuIndex + 3) % 4;
    
    const qtdTopo = sala.jogo[`maoJogador${idxTopo + 1}`]?.length || 0;
    const qtdEsq = sala.jogo[`maoJogador${idxEsq + 1}`]?.length || 0;
    const qtdDir = sala.jogo[`maoJogador${idxDir + 1}`]?.length || 0;
    
    console.log('👥 Adversários - Topo:', qtdTopo, 'Esq:', qtdEsq, 'Dir:', qtdDir);
    
    // Atualiza contadores
    renderizarMaoAdversario('mao-topo', qtdTopo);
    renderizarMaoAdversario('mao-esquerda', qtdEsq);
    renderizarMaoAdversario('mao-direita', qtdDir);
}

function renderizarMaoAdversario(idContainer, qtd) {
    const container = document.getElementById(idContainer);
    if (!container) {
        console.error('❌ Container não encontrado:', idContainer);
        return;
    }
    
    container.innerHTML = '';
    
    for (let i = 0; i < qtd; i++) {
        const card = document.createElement('div');
        card.className = 'carta-miniatura';
        container.appendChild(card);
    }
}

// ==========================================
// 🃏 RENDERIZAÇÃO DE CARTAS E JOGOS
// ==========================================

function renderizarMinhaMao(cartas) {
    const div = document.getElementById('minha-mao'); // ✅ Mudou de querySelector para getElementById
    console.log('🃏 Renderizando', cartas?.length, 'cartas'); // ✅ Adicionou log
    if (!div) {
        console.error('❌ Container minha-mao NÃO EXISTE NO DOM!');
        console.log('🔍 Tentando procurar:', document.getElementById('minha-mao'));
        return;
    }
    
    console.log('✅ Container encontrado:', div);
    div.innerHTML = '';
    
    if (!cartas) {
        console.error('❌ Parâmetro cartas é NULL/UNDEFINED');
        return;
    }
    
    if (!Array.isArray(cartas)) {
        console.error('❌ Parâmetro cartas NÃO É ARRAY:', typeof cartas);
        return;
    }
    
    if (cartas.length === 0) {
        console.warn('⚠️ Array de cartas está VAZIO');
        return;
    }
    
    console.log('🎴 Iniciando renderização de', cartas.length, 'cartas');
    
    cartas.forEach((c, i) => {
        const el = document.createElement('div');
        el.className = 'carta';
        
        if (cartasSelecionadas.includes(i)) {
            el.classList.add('selecionada');
        }
        
        el.innerHTML = `<img src="${getImgUrl(c)}">`;
        el.onclick = (e) => { 
            e.stopPropagation(); 
            toggleSelecao(i); 
        };
        
        div.appendChild(el);
    });
    
    console.log('✅ Renderizadas', cartas.length, 'cartas na mão');
}

function toggleSelecao(i) {
    if (cartasSelecionadas.includes(i)) {
        cartasSelecionadas = cartasSelecionadas.filter(x => x !== i);
        console.log('➖ Carta', i, 'desmarcada');
    } else {
        cartasSelecionadas.push(i);
        console.log('➕ Carta', i, 'selecionada');
    }
    
    // Atualiza classes CSS
    document.querySelectorAll('#minha-mao .carta').forEach((el, idx) => {
        if (cartasSelecionadas.includes(idx)) {
            el.classList.add('selecionada');
        } else {
            el.classList.remove('selecionada');
        }
    });
    
    // Atualiza botões
    if (ultimoEstadoSala) {
        atualizarBotoesAcao(ultimoEstadoSala.estadoTurno);
    }
}

function renderizarJogos(idDiv, jogos, ehMeu) {
    const div = document.getElementById(idDiv);
    if (!div) {
        console.error('❌ Container não encontrado:', idDiv);
        return;
    }
    
    // Mantém watermark se existir
    const watermark = div.querySelector('.watermark');
    div.innerHTML = '';
    if (watermark) div.appendChild(watermark);
    
    if (!jogos || jogos.length === 0) return;
    
    jogos.forEach((jogo, idxJogo) => {
        const grupo = document.createElement('div');
        grupo.className = 'grupo-baixado';
        
        // Verifica canastras para adicionar estilo visual
        if (jogo.length >= 7) {
            const temCuringa = jogo.some(c => c.face === '2' && c.naipe !== jogo[0].naipe); // Lógica simplificada visual
            grupo.classList.add(temCuringa ? 'canastra-suja' : 'canastra-limpa');
        }
        
        // --- CORREÇÃO DO CLIQUE PARA ENCAIXAR ---
        if (ehMeu && turnoAtivo) {
            grupo.style.cursor = 'pointer';
            grupo.onclick = (e) => {
                e.stopPropagation();
                
                if (cartasSelecionadas.length > 0) {
                    console.log('🎯 Encaixando cartas no jogo índice:', idxJogo);
                    
                    // CORREÇÃO: Envia no formato 'jogada'
                    socket.emit('jogada', { 
                        acao: 'baixarJogo', 
                        dados: { 
                            indices: cartasSelecionadas, 
                            indexJogoMesa: idxJogo // Envia o índice do jogo alvo
                        } 
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

// ==========================================
// 🎮 BOTÕES DE AÇÃO
// ==========================================

function atualizarBotoesAcao(estado) {
    const btnBaixar = document.getElementById('btn-baixar-jogo');
    const btnDescartar = document.getElementById('btn-descartar');
    const btnLimpar = document.getElementById('btn-limpar-selecao');
    const qtdSel = document.getElementById('qtd-selecionadas');
    const qtdDesc = document.getElementById('qtd-descartar');
    
    if (!btnBaixar || !btnDescartar || !btnLimpar) return;
    
    const qtd = cartasSelecionadas.length;
    
    // Atualiza contadores
    if (qtdSel) qtdSel.innerText = qtd;
    if (qtdDesc) qtdDesc.innerText = qtd;
    
    // Esconde tudo por padrão
    btnBaixar.style.display = 'none';
    btnDescartar.style.display = 'none';
    btnLimpar.style.display = 'none';
    
    if (!turnoAtivo) return;
    
    if (qtd > 0) {
        btnLimpar.style.display = 'inline-block';
    }
    
    if (estado === 'descartando') {
        if (qtd >= 3) {
            btnBaixar.style.display = 'inline-block';
        }
        if (qtd === 1) {
            btnDescartar.style.display = 'inline-block';
        }
    }
}

function acaoBaixar() {
    if (!turnoAtivo) {
        console.log('❌ Não é sua vez');
        return;
    }
    
    if (cartasSelecionadas.length < 3) {
        alert("Selecione pelo menos 3 cartas para baixar um jogo.");
        return;
    }
    
    console.log('📥 Enviando solicitação para baixar jogo:', cartasSelecionadas);
    
    // CORREÇÃO: Envia no formato que o servidor entende (evento 'jogada' com ação 'baixarJogo')
    socket.emit('jogada', { 
        acao: 'baixarJogo', 
        dados: { 
            indices: cartasSelecionadas, 
            indexJogoMesa: null // null indica que é um jogo novo
        } 
    });
    
    // Limpa seleção preventivamente
    cartasSelecionadas = [];
    atualizarVisualSelecao();
}

function acaoDescartar() {
    // Validação local básica
    if (!turnoAtivo) {
        console.log('❌ Tentativa de descarte fora do turno.');
        return;
    }
    
    if (cartasSelecionadas.length !== 1) {
        alert("Selecione 1 carta para descartar.");
        return;
    }
    
    const indiceCarta = cartasSelecionadas[0];
    console.log('🗑️ Descartando carta index:', indiceCarta);

    // CORREÇÃO CRÍTICA: Envia no formato padrão 'jogada' que o server.js espera
    socket.emit('jogada', { 
        acao: 'descartar', 
        dados: { index: indiceCarta } 
    });

    // Limpa a seleção visualmente imediatamente para evitar duplo clique
    cartasSelecionadas = [];
    atualizarVisualSelecao();
    
    // Limpa destaque de carta comprada
    ultimaCartaCompradaId = null; 
}

function acaoLimpar() { 
    console.log('🧹 Limpando seleção');
    cartasSelecionadas = []; 
    
    // Atualiza visual
    document.querySelectorAll('#minha-mao .carta').forEach(el => {
        el.classList.remove('selecionada');
    });
    
    if (ultimoEstadoSala) {
        atualizarBotoesAcao(ultimoEstadoSala.estadoTurno);
    }
}

function acaoOrdenar() { 
    console.log('🔃 CLIQUE REORDENAR');
    // CORREÇÃO: Envia o formato padrão de jogada que o server entende
    socket.emit('jogada', { acao: 'ordenar', dados: {} });
}

function pedirReset() {
    if (confirm("Reiniciar jogo?")) {
        console.log("🔄 Enviando pedido de reset...");
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
    
    // Usa uma classe para controlar a visibilidade ou alterna style direto
    if (chat.style.display === 'flex') {
        chat.style.display = 'none';
    } else {
        chat.style.display = 'flex';
        // Foca no input ao abrir
        setTimeout(() => {
            const input = document.getElementById('chat-input');
            if(input) input.focus();
            // Rola para o fim
            const msgs = document.getElementById('chat-msgs');
            if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }, 100);
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
// 🌐 EVENTOS GLOBAIS
// ==========================================

// Torna funções acessíveis globalmente para onclick no HTML
window.acaoBaixar = acaoBaixar;
window.acaoDescartar = acaoDescartar;
window.acaoLimpar = acaoLimpar;
window.acaoOrdenar = acaoOrdenar;
window.pedirReset = pedirReset;
window.fazerLogout = fazerLogout;
window.jogarAnonimo = jogarAnonimo;
window.fazerLogin = fazerLogin;
window.entrarModoTreino = entrarModoTreino;

// ✅ Aliases para compatibilidade com HTML
window.tentarBaixarJogo = acaoBaixar;
window.descartarCartaSelecionadas = acaoDescartar;
window.limparSelecao = acaoLimpar;
window.alternarOrdenacao = acaoOrdenar;

window.toggleChat = toggleChat;
window.enviarMensagem = enviarMensagem;

// Eventos adicionais do socket
socket.on('disconnect', () => {
    console.log('❌ Desconectado do servidor');
    alert('Conexão perdida. Recarregando página...');
    setTimeout(() => location.reload(), 2000);
});

socket.on('erroJogo', (msg) => {
    console.error('❌ Erro:', msg);
    alert(msg);
});

// ✅ Eventos importantes do servidor
socket.on('maoAtualizada', (dados) => {
    console.log('🃏 Mão atualizada:', dados);
    if (dados.mao && ultimoEstadoSala) {
        ultimoEstadoSala.jogo[`maoJogador${meuIndex + 1}`] = dados.mao;
        renderizarMinhaMao(dados.mao);
    }
});

socket.on('mudancaVez', (dados) => {
    console.log('🔄 Mudança de vez:', dados);
    if (ultimoEstadoSala) {
        ultimoEstadoSala.vez = dados.vez;
        ultimoEstadoSala.estadoTurno = dados.estado;
        turnoAtivo = (dados.vez === meuIndex);
        cartasSelecionadas = [];
        atualizarMesa(ultimoEstadoSala);
    }
});

socket.on('cartaComprada', (dados) => {
    console.log('🎴 Carta comprada:', dados);
    if (dados.mao && ultimoEstadoSala) {
        ultimoEstadoSala.jogo[`maoJogador${meuIndex + 1}`] = dados.mao;
        ultimoEstadoSala.estadoTurno = 'descartando';
        renderizarMinhaMao(dados.mao);
        atualizarBotoesAcao('descartando');
    }
});

// CORREÇÃO: Acessa a propriedade .total para evitar [object Object]
socket.on('atualizarPlacar', (placar) => {
    console.log('📊 Placar atualizado:', placar);
    const elNos = document.getElementById('pts-nos');
    const elEles = document.getElementById('pts-eles');
    
    // Verifica se placar.p1 existe e acessa .total, senão usa 0
    if (elNos) elNos.innerText = placar.p1?.total || 0;
    if (elEles) elEles.innerText = placar.p2?.total || 0;
});

socket.on('atualizarContadores', (dados) => {
    console.log('🔢 Contadores:', dados);
    const badgeMonte = document.getElementById('qtd-monte');
    const badgeLixo = document.getElementById('qtd-lixo');
    if (badgeMonte) badgeMonte.innerText = dados.monte || 0;
    if (badgeLixo) badgeLixo.innerText = dados.lixo || 0;
});

socket.on('atualizarMaosCount', (counts) => {
    console.log('👥 Contagem mãos:', counts);
    if (ultimoEstadoSala && counts) {
        atualizarAdversarios(ultimoEstadoSala);
    }
});

socket.on('mesaAtualizada', (dados) => {
    console.log('🎮 Mesa atualizada:', dados);
    if (ultimoEstadoSala) {
        // Atualiza jogos na mesa
        socket.emit('solicitarEstado'); // Pede estado completo
    }
});

socket.on('atualizarLixo', (carta) => {
    console.log('🗑️ Lixo atualizado:', carta);
    if (ultimoEstadoSala && carta) {
        ultimoEstadoSala.jogo.lixo.push(carta);
        atualizarLixo(ultimoEstadoSala, ultimoEstadoSala.estadoTurno);
    }
});

// ✅ OUVINTE QUE FALTAVA PARA O FIM DE JOGO
socket.on('fimDeJogo', (dados) => {
    console.log('🏁 FIM DE JOGO:', dados);
    document.getElementById('modal-fim').style.display = 'flex';
    
    // Preenche os dados do modal
    const preencher = (prefixo, dadosEq) => {
        document.getElementById(prefixo + '-batida').innerText = dadosEq.ptsBatida;
        document.getElementById(prefixo + '-morto').innerText = dadosEq.ptsMorto;
        document.getElementById(prefixo + '-limpa').innerText = dadosEq.ptsCanastrasLimpas;
        document.getElementById(prefixo + '-suja').innerText = dadosEq.ptsCanastrasSujas;
        document.getElementById(prefixo + '-3ver').innerText = dadosEq.pts3Vermelhos;
        document.getElementById(prefixo + '-cartas').innerText = dadosEq.ptsCartasMao + dadosEq.ptsCartasMesa; // Soma simplificada para visualização
    };

    preencher('p1', dados.detalhes.p1);
    preencher('p2', dados.detalhes.p2);
    
    document.getElementById('p1-total').innerText = dados.placar.p1;
    document.getElementById('p2-total').innerText = dados.placar.p2;
    
    // Título do Vencedor
    const souTimeP1 = (meuIndex % 2 === 0);
    const meuPlacar = souTimeP1 ? dados.placar.p1 : dados.placar.p2;
    const adversarioPlacar = souTimeP1 ? dados.placar.p2 : dados.placar.p1;
    
    const titulo = document.getElementById('titulo-vitoria');
    if (meuPlacar > adversarioPlacar) {
        titulo.innerText = "VITÓRIA!";
        titulo.style.color = "#2ecc71";
    } else {
        titulo.innerText = "DERROTA";
        titulo.style.color = "#e74c3c";
    }
});

console.log('✅ Script carregado com sucesso!');











