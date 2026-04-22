const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

// Configuração Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Estado das conversas (guarda em memória)
const conversationState = new Map();

// Configuração
const CONFIG = {
  // Dia da semana (0=Domingo, 1=Segunda, ..., 5=Sexta)
  sendDay: 1, // Segunda-feira
  // Hora de envio (formato 24h)
  sendHour: 9,
  sendMinute: 0
};

// ===== FUNÇÕES PRINCIPAIS =====

async function startBot() {
  console.log('🚀 Iniciando bot WhatsApp...');

  // Autenticação (guarda sessão na pasta ./auth)
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  // Criar conexão WhatsApp
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  // Salvar credenciais quando atualizadas
  sock.ev.on('creds.update', saveCreds);

  // Escutar mensagens recebidas
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    
    // Ignorar mensagens sem conteúdo ou enviadas por nós
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = 
      msg.message.conversation || 
      msg.message.extendedTextMessage?.text || '';

    console.log(`📩 Mensagem de ${from}: ${text}`);

    await handleMessage(sock, from, text);
  });

  // Agendar envios semanais
  scheduleWeeklyMessages(sock);

  console.log('✅ Bot ativo e pronto!');
  console.log(`📅 Próximo envio: ${getNextSendDate().toLocaleString('pt-PT')}`);
}

// ===== LÓGICA DE CONVERSAÇÃO =====

async function handleMessage(sock, from, text) {
  const state = conversationState.get(from) || { step: 0 };

  // PASSO 0: Início da conversa
  if (state.step === 0 || text.toLowerCase().includes('começar')) {
    conversationState.set(from, { step: 1, startTime: Date.now() });
    
    await sock.sendMessage(from, { 
      text: '🚗 Olá! Vamos registar os quilómetros da viatura.\n\n' +
            'Por favor, indique a *matrícula* (ex: AA-12-BB):' 
    });
    return;
  }

  // PASSO 1: Receber matrícula
  if (state.step === 1) {
    const matricula = text.toUpperCase().trim();
    
    // Validação básica de matrícula portuguesa
    const isValid = /^[A-Z]{2}-\d{2}-[A-Z]{2}$/.test(matricula) ||
                    /^[A-Z]{2}-\d{2}-\d{2}$/.test(matricula) ||
                    /^\d{2}-[A-Z]{2}-\d{2}$/.test(matricula);
    
    if (!isValid && matricula.length > 3) {
      conversationState.set(from, { 
        step: 2, 
        matricula: matricula,
        startTime: state.startTime 
      });
      
      await sock.sendMessage(from, { 
        text: `📋 Matrícula registada: *${matricula}*\n\n` +
              'Agora indique os *quilómetros* (apenas números):' 
      });
    } else if (isValid) {
      conversationState.set(from, { 
        step: 2, 
        matricula: matricula,
        startTime: state.startTime 
      });
      
      await sock.sendMessage(from, { 
        text: `📋 Matrícula registada: *${matricula}*\n\n` +
              'Agora indique os *quilómetros* (apenas números):' 
      });
    } else {
      await sock.sendMessage(from, { 
        text: '⚠️ Matrícula inválida. Por favor use o formato correto:\n' +
              'AA-12-BB ou AA-12-34\n\n' +
              'Tente novamente:' 
      });
    }
    return;
  }

  // PASSO 2: Receber quilómetros
  if (state.step === 2) {
    const kms = parseInt(text.replace(/\D/g, ''));

    // Validar número
    if (isNaN(kms) || kms < 0) {
      await sock.sendMessage(from, { 
        text: '⚠️ Por favor indique um número válido de quilómetros.\n\n' +
              'Exemplo: 45000' 
      });
      return;
    }

    // Validar número razoável (até 999.999 km)
    if (kms > 999999) {
      await sock.sendMessage(from, { 
        text: '⚠️ Valor muito alto. Verifique se está correto.\n\n' +
              'Tente novamente:' 
      });
      return;
    }

    // Guardar no Supabase
    console.log(`💾 Guardando: ${state.matricula} - ${kms} km`);
    
    const { data, error } = await supabase
      .from('viaturas')
      .upsert({
        matricula: state.matricula,
        kms: kms,
        telefone: from.replace('@s.whatsapp.net', ''),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'matricula'
      });

    if (error) {
      console.error('❌ Erro Supabase:', error);
      await sock.sendMessage(from, { 
        text: '❌ Ocorreu um erro ao guardar os dados.\n' +
              'Por favor tente novamente mais tarde.\n\n' +
              'Se o problema persistir, contacte o suporte.' 
      });
    } else {
      console.log('✅ Dados guardados com sucesso!');
      await sock.sendMessage(from, { 
        text: `✅ *Dados guardados com sucesso!*\n\n` +
              `🚗 Matrícula: *${state.matricula}*\n` +
              `📏 Quilómetros: *${kms.toLocaleString('pt-PT')} km*\n` +
              `📅 Data: ${new Date().toLocaleString('pt-PT')}\n\n` +
              `Obrigado! 👍` 
      });
    }

    // Limpar estado da conversa
    conversationState.delete(from);
  }
}

// ===== AGENDAMENTO SEMANAL =====

function getNextSendDate() {
  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  let daysUntilSend;

  if (currentDay < CONFIG.sendDay) {
    // Ainda não chegou o dia esta semana
    daysUntilSend = CONFIG.sendDay - currentDay;
  } else if (currentDay === CONFIG.sendDay) {
    // É hoje, verificar hora
    if (
      currentHour < CONFIG.sendHour ||
      (currentHour === CONFIG.sendHour && currentMinute < CONFIG.sendMinute)
    ) {
      daysUntilSend = 0; // Enviar hoje
    } else {
      daysUntilSend = 7; // Próxima semana
    }
  } else {
    // Já passou, próxima semana
    daysUntilSend = 7 - (currentDay - CONFIG.sendDay);
  }

  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + daysUntilSend);
  nextDate.setHours(CONFIG.sendHour, CONFIG.sendMinute, 0, 0);

  return nextDate;
}

function scheduleWeeklyMessages(sock) {
  function scheduleNext() {
    const nextSend = getNextSendDate();
    const delay = nextSend - new Date();

    console.log(
      `📅 Próximo envio agendado para: ${nextSend.toLocaleString('pt-PT')}`
    );
    console.log(`⏳ Faltam ${Math.round(delay / 1000 / 60 / 60)} horas`);

    setTimeout(async () => {
      await sendWeeklyMessages(sock);
      scheduleNext(); // Agendar próxima semana
    }, delay);
  }

  scheduleNext();
}

async function sendWeeklyMessages(sock) {
  console.log('📨 Iniciando envio semanal...');

  try {
    // Buscar números do Supabase
    const { data: colaboradores, error } = await supabase
      .from('colaboradores')
      .select('telefone, nome');

    if (error) {
      console.error('❌ Erro ao buscar colaboradores:', error);
      return;
    }

    if (!colaboradores || colaboradores.length === 0) {
      console.log('⚠️ Nenhum colaborador encontrado na base de dados');
      return;
    }

    console.log(`👥 Encontrados ${colaboradores.length} colaboradores`);

    // Enviar para cada colaborador
    for (const colaborador of colaboradores) {
      try {
        const number = `${colaborador.telefone}@s.whatsapp.net`;
        const nome = colaborador.nome || 'Colaborador';

        // Iniciar conversa
        conversationState.set(number, { step: 1, startTime: Date.now() });

        await sock.sendMessage(number, {
          text: `🚗 Olá ${nome}!\n\n` +
                `Está na altura de registar os quilómetros das viaturas.\n\n` +
                `Por favor, indique a *matrícula* da viatura (ex: AA-12-BB):`
        });

        console.log(`✅ Mensagem enviada para ${colaborador.telefone}`);

        // Delay entre mensagens (evitar ban do WhatsApp)
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(
          `❌ Erro ao enviar para ${colaborador.telefone}:`,
          error
        );
      }
    }

    console.log('✅ Envio semanal concluído!');
  } catch (error) {
    console.error('❌ Erro geral no envio semanal:', error);
  }
}

// ===== INICIAR BOT =====

startBot().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
