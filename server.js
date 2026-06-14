/**
 * TechStore — Avtomatik To'lov Tekshiruv Tizimi
 * CardXabar integratsiyasi bilan Telegraf bot
 *
 * Firebase orders strukturasi (index.html dan):
 *   orderNum       : '#1042'
 *   products       : 'iPhone 16 Pro, AirPods'   ← string
 *   productDetails : [{id, name, brand, price, qty, image}]  ← array
 *   total          : 18500002   ← basePrice + suffix (unique amount)
 *   basePrice      : 18500000
 *   suffix         : 2
 *   addr           : 'Toshkent shahri, Yunusobod, ...'
 *   phone          : '+998901234567'
 *   status         : 'pending' | 'confirmed' | 'rejected'
 *   userId         : 7505685720
 *   userName       : 'Jahongir'
 *   userUsername   : 'jahongir_1220'
 *   createdAt      : 1780148210410
 *
 * pending_suffixes strukturasi (settings/pending_suffixes/{suffix}):
 *   orderNum : '#1042'
 *   userId   : 7505685720
 *   ts       : timestamp
 */

'use strict';

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express              = require('express');
const path                 = require('path');
const admin                = require('firebase-admin');

// ─────────────────────────────────────────────
// 1. ENV TEKSHIRUV
// ─────────────────────────────────────────────
const REQUIRED_ENV = [
  'BOT_TOKEN',
  'CARDXABAR_CHANNEL_ID',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_DATABASE_URL',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`ENV topilmadi: ${key}`);
    process.exit(1);
  }
}

const BOT_TOKEN            = process.env.BOT_TOKEN;
const CARDXABAR_CHANNEL_ID = process.env.CARDXABAR_CHANNEL_ID;
const WEBAPP_URL           = process.env.WEBAPP_URL
                          || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000'}`;
const PORT                 = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// 2. FIREBASE ADMIN INIT
// ─────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({
    projectId  : process.env.FIREBASE_PROJECT_ID,
    privateKey : process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();
console.log('Firebase Admin ulandi:', process.env.FIREBASE_PROJECT_ID);

// ─────────────────────────────────────────────
// 3. EXPRESS SERVER
// ─────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// 4. TELEGRAM BOT
// ─────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const name = ctx.from.first_name || 'Mehmon';
  return ctx.reply(
    `Salom, ${name}! 👋\n\nTechStore rasmiy botiga xush kelibsiz!\nEng yangi texnologiyalar va aksessuarlarni ko'rish uchun pastdagi tugmani bosing.`,
    Markup.inlineKeyboard([
      [Markup.button.webApp("🛍 Do'konni ochish", WEBAPP_URL)],
    ])
  );
});

bot.command('menu', (ctx) =>
  ctx.reply("Do'konni ochish:", Markup.inlineKeyboard([
    [Markup.button.webApp('TechStore', WEBAPP_URL)],
  ]))
);

bot.help((ctx) =>
  ctx.reply('/start — Boshlash\n/menu — Do\'kon\n/help — Yordam')
);

bot.on('message', (ctx) =>
  ctx.reply("Do'konni ochish uchun /start bosing:", Markup.inlineKeyboard([
    [Markup.button.webApp('TechStore', WEBAPP_URL)],
  ]))
);

// ─────────────────────────────────────────────
// 5. CARDXABAR REGEX PARSER
//
// CardXabar xabar namunasi:
//   "To'ldirish
//    + 18.500.002,00 UZS
//    Balans: 5 000 000,00 UZS"
//
// Faqat birinchi "+" dan keyingi summani olamiz.
// "Balans:" qatorini olmaymiz.
// ─────────────────────────────────────────────
const CARDXABAR_REGEX = /\+\s*([\d\s.,]+?)\s*UZS/i;

/**
 * "18.500.002,00" yoki "18 500 002,00" => 18500002
 */
function parseAmount(raw) {
  // Verguldan keyingi tiyin qismini olib tashlash
  const withoutTiyin = raw.replace(/,\d+$/, '').trim();
  // Barcha ajratgichlarni (nuqta, bo'shliq) tozalash
  const digitsOnly   = withoutTiyin.replace(/[\s.]/g, '');
  const num          = parseInt(digitsOnly, 10);
  return isNaN(num) ? null : num;
}

async function processChannelMessage(text) {
  if (!text) return;

  const match = text.match(CARDXABAR_REGEX);
  if (!match) return;

  const rawAmount   = match[1];
  const finalAmount = parseAmount(rawAmount);

  if (!finalAmount || finalAmount <= 0) {
    console.warn('Summa tahlil qilinmadi:', rawAmount);
    return;
  }

  console.log(`CardXabar tushumi: ${finalAmount} UZS`);
  await matchAndConfirmOrder(finalAmount);
}

// ─────────────────────────────────────────────
// 6. BUYURTMANI TOPIB TASDIQLASH
//
// index.html Firebase ga 'total' fieldiga yozadi:
//   total = basePrice + suffix  (masalan: 18500000 + 2 = 18500002)
//
// Shuning uchun 'total' bo'yicha qidiramiz, 'finalAmount' emas!
// ─────────────────────────────────────────────
async function matchAndConfirmOrder(finalAmount) {
  try {
    // 'total' = basePrice + suffix — index.html shu fieldni yozadi
    const snap = await db.ref('orders')
      .orderByChild('total')
      .equalTo(finalAmount)
      .once('value');

    const orders = snap.val();
    if (!orders) {
      console.log(`${finalAmount} UZS uchun pending buyurtma topilmadi`);
      return;
    }

    // Faqat 'pending' statusli birinchi buyurtmani olish
    const pendingEntry = Object.entries(orders).find(
      ([, order]) => order.status === 'pending'
    );

    if (!pendingEntry) {
      console.log(`${finalAmount} UZS — buyurtma allaqachon tasdiqlangan yoki topilmadi`);
      return;
    }

    const [orderKey, order] = pendingEntry;

    // Statusni 'confirmed' ga o'zgartirish
    await db.ref(`orders/${orderKey}`).update({
      status     : 'confirmed',
      confirmedAt: admin.database.ServerValue.TIMESTAMP,
      confirmedBy: 'auto_cardxabar',
    });

    // pending_suffixes dan bu suffixni o'chirish
    // index.html 'suffix' fieldini ham yozadi
    if (order.suffix != null) {
      await db.ref(`settings/pending_suffixes/${order.suffix}`).remove();
      console.log(`pending_suffix ${order.suffix} tozalandi`);
    }

    console.log(`✅ Buyurtma tasdiqlandi: ${order.orderNum || orderKey} | ${finalAmount} UZS | userId: ${order.userId}`);

    // Foydalanuvchiga Telegram xabari yuborish
    if (order.userId) {
      await notifyUser(order.userId, order, orderKey);
    }

  } catch (err) {
    console.error('matchAndConfirmOrder xatosi:', err);
  }
}

// ─────────────────────────────────────────────
// 7. FOYDALANUVCHIGA XABAR YUBORISH
//
// index.html ikki formatda yozadi:
//   products       = "iPhone 16 Pro, AirPods"  ← eski string format
//   productDetails = [{name, price, qty, image}] ← yangi array format
//
// Ikkalasini ham qo'llab-quvvatlaymiz
// ─────────────────────────────────────────────
async function notifyUser(userId, order, orderKey) {
  try {
    // productDetails (yangi) yoki products (eski string) dan nomlarni olamiz
    let productLines;
    if (Array.isArray(order.productDetails) && order.productDetails.length) {
      productLines = order.productDetails
        .map(i => `• ${i.name}${i.qty > 1 ? ` x${i.qty}` : ''} — ${Number(i.price * i.qty).toLocaleString('uz-UZ')} so'm`)
        .join('\n');
    } else {
      productLines = `• ${order.products || 'Mahsulot'}`;
    }

    // total = uniqueAmt (basePrice + suffix)
    const totalFormatted = order.total
      ? Number(order.total).toLocaleString('uz-UZ') + ' so\'m'
      : '—';

    const orderNum = order.orderNum || `#${orderKey}`;

    const message =
      `🎉 To'lovingiz tasdiqlandi!\n\n` +
      `📦 Buyurtma: ${orderNum}\n` +
      `🛒 Mahsulotlar:\n${productLines}\n` +
      `💰 Jami: ${totalFormatted}\n` +
      `📍 Manzil: ${order.addr || '—'}\n` +
      `📞 Telefon: ${order.phone || '—'}\n\n` +
      `🚀 Admin tez orada siz bilan bog'lanadi!\n` +
      `TechStore — Ishonchli xarid 🏆`;

    await bot.telegram.sendMessage(userId, message,
      Markup.inlineKeyboard([
        [Markup.button.webApp("Do'konni ochish", WEBAPP_URL)],
      ])
    );

    console.log(`📨 Xabar yuborildi: userId=${userId}, order=${orderNum}`);

  } catch (err) {
    // Foydalanuvchi botni bloklagan yoki boshqa xato
    console.warn(`Xabar yuborishda xato (userId: ${userId}):`, err.message);
  }
}

// ─────────────────────────────────────────────
// 8. KANAL XABARLARINI USHLASH
//    Bot CardXabar kanalining admini bo'lishi KERAK
//    yoki kanal forward xabarlarini o'qiydi
// ─────────────────────────────────────────────
bot.on('channel_post', async (ctx) => {
  const post      = ctx.channelPost;
  const channelId = String(post.chat.id);
  const targetId  = String(CARDXABAR_CHANNEL_ID);

  // Faqat bizning CardXabar kanalidan kelgan xabarlar
  if (channelId !== targetId) return;

  const text = post.text || post.caption || '';
  console.log(`📩 Kanal xabari [${channelId}]:`, text.substring(0, 120));

  await processChannelMessage(text);
});

// ─────────────────────────────────────────────
// 9. SERVER ISHGA TUSHIRISH
// ─────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('='.repeat(50));
  console.log(`Express server: http://localhost:${PORT}`);
  console.log(`Mini App URL  : ${WEBAPP_URL}`);
  console.log(`CardXabar ID  : ${CARDXABAR_CHANNEL_ID}`);
  console.log('='.repeat(50));

  try {
    const botInfo = await bot.telegram.getMe();
    console.log(`Bot ulandi: @${botInfo.username} (id: ${botInfo.id})`);

    await bot.launch({ dropPendingUpdates: true });
    console.log('✅ Bot polling boshlandi — CardXabar kanalini tinglayapman...');

  } catch (err) {
    console.error('Bot ishga tushmadi:', err.message);
    process.exit(1);
  }
});

process.once('SIGINT',  () => { bot.stop('SIGINT');  });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); });
