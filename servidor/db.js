const fs = require('fs');
const path = require('path');

const ARQUIVO_DB = path.join(__dirname, 'dados.json');

// Estrutura inicial se o arquivo não existir
const dadosIniciais = {
    usuarios: {}, // { "email": { senha, nome, vitorias, derrotas, pontos, historico: [] } }
    partidas: []  // Logs para rankings temporais (diario, semanal)
};

function carregarDados() {
    if (!fs.existsSync(ARQUIVO_DB)) {
        fs.writeFileSync(ARQUIVO_DB, JSON.stringify(dadosIniciais, null, 2));
        return dadosIniciais;
    }
    return JSON.parse(fs.readFileSync(ARQUIVO_DB));
}

function salvarDados(dados) {
    fs.writeFileSync(ARQUIVO_DB, JSON.stringify(dados, null, 2));
}

const db = {
    registrarUsuario: (email, senha, nome) => {
        const dados = carregarDados();
        if (dados.usuarios[email]) return { erro: "E-mail já cadastrado!" };
        
        dados.usuarios[email] = {
            nome,
            senha, // Em produção, usar hash (bcrypt)
            vitorias: 0,
            derrotas: 0,
            pontos: 0,
            premium: false,
            dataCadastro: new Date().toISOString()
        };
        salvarDados(dados);
        return { sucesso: true, usuario: { email, nome, ...dados.usuarios[email] } };
    },

    loginUsuario: (email, senha) => {
        const dados = carregarDados();
        const user = dados.usuarios[email];
        if (!user || user.senha !== senha) return { erro: "Credenciais inválidas!" };
        
        // Retorna dados sem a senha
        const { senha: _, ...userSafe } = user;
        return { sucesso: true, usuario: { email, ...userSafe } };
    },

    registrarFimPartida: (resultado) => {
        // resultado = { vencedores: [email1, email2], perdedores: [email3, email4], pontosVencedor, pontosPerdedor }
        const dados = carregarDados();
        const agora = new Date().toISOString();

        // Atualiza Vencedores
        resultado.vencedores.forEach(email => {
            if (dados.usuarios[email]) {
                dados.usuarios[email].vitorias++;
                dados.usuarios[email].pontos += 100; // Exemplo: 100 pts por vitória
            }
        });

        // Atualiza Perdedores
        resultado.perdedores.forEach(email => {
            if (dados.usuarios[email]) {
                dados.usuarios[email].derrotas++;
                dados.usuarios[email].pontos += 10; // Exemplo: 10 pts de consolação
            }
        });

        // Salva histórico para rankings temporais
        dados.partidas.push({
            data: agora,
            ...resultado
        });

        salvarDados(dados);
    },

    obterRanking: () => {
        const dados = carregarDados();
        const lista = Object.entries(dados.usuarios).map(([email, u]) => ({
            nome: u.nome,
            vitorias: u.vitorias,
            pontos: u.pontos,
            premium: u.premium
        }));

        // Ordena por Pontos (Decrescente)
        return lista.sort((a, b) => b.pontos - a.pontos).slice(0, 10); // Top 10
    }
};

module.exports = db;