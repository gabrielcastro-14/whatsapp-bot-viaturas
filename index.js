const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const conversationState = new Map();

// Lista de números para enviar (formato: 351912345678@s.whatsapp.net)
const CONTACT_NUMBERS = [
  '351912345678@s.whatsapp.net',
  '351923456789@s.whatsapp.net',
  // Adiciona mais números aqui
];

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || 
                 msg.message.extendedTextMessage?.text || '';

    await handleMessage(sock, from, text);
  });

  // Agendar envio semanal (toda segunda-feira às 9h)
  scheduleWeeklyMessages(sock);

  console.log('✅ Bot WhatsApp ativo!');
}

async function handleMessage(sock, from, text) {
  const state = conversationState.get(from) || { step: 0 };

  if (state.step === 0 || text.toLowerCase() === 'começar') {
    conversationState.set(from, { step: 1 });
    await sock.sendMessage(from, { 
      text: 'Olá! Por favor indique a matrícula da viatura:' 
    });
  } else if (state.step === 1) {
    conversationState.set(from, { 
      step: 2, 
      matricula: text.toUpperCase() 
    });
    await sock.sendMessage(from, { 
      text: 'Obrigado! Agora indique os quilómetros:' 
    });
  } else if (state.step === 2) {
    const kms = parseInt(text.replace(/\D/g, ''));

    if (isNaN(kms)) {
      await sock.sendMessage(from, { 
        text: 'Por favor indique um número válido de quilómetros.' 
      });
      return;
    }

    const { error } = await supabase.from('viaturas').upsert({
      matricula: state.matricula,
      kms,
      telefone: from,
      updated_at: new Date().toISOString()
    });

    await sock.sendMessage(from, { 
      text: error 
        ? '❌ Erro ao guardar dados. Tente novamente.' 
        : `✅ Dados guardados!\nMatrícula: ${state.matricula}\nQuilómetros: ${kms}`
    });

    conversationState.delete(from);
  }
}

function scheduleWeeklyMessages(sock) {
  // Calcular próxima segunda-feira às 9h
  function getNextMonday() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(9, 0, 0, 0);
    
    return nextMonday;
  }

  function scheduleNext() {
    const nextMonday = getNextMonday();
    const delay = nextMonday - new Date();

    console.log(`📅 Próximo envio: ${nextMonday.toLocaleString('pt-PT')}`);

    setTimeout(async () => {
      await sendWeeklyMessages(sock);
      scheduleNext(); // Agendar próxima semana
    }, delay);
  }

  scheduleNext();
}

async function sendWeeklyMessages(sock) {
  console.log('📨 Enviando mensagens semanais...');

  for (const number of CONTACT_NUMBERS) {
    try {
      conversationState.set(number, { step: 1 });
      
      await sock.sendMessage(number, {
        text: '🚗 Olá! Está na altura de registar os quilómetros.\n\nPor favor indique a matrícula da viatura:'
      });

      console.log(`✅ Mensagem enviada para ${number}`);
      
      // Delay entre mensagens (evitar ban)
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`❌ Erro ao enviar para ${number}:`, error);
    }
  }
}

startBot().catch(console.error);
