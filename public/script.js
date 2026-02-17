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
    
    // CORREÇÃO: Envia 'jogada' com ação 'descartar' (o server não ouve 'descartarCarta' direto)
    socket.emit('jogada', { 
        acao: 'descartar', 
        dados: { index: cartasSelecionadas[0] } 
    });
    
    // Limpa seleção
    cartasSelecionadas = [];
    atualizarVisualSelecao();
    ultimaCartaCompradaId = null;
}
