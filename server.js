const http = require('http');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CARDXABAR_CHANNEL_ID = Number(process.env.CARDXABAR_CHANNEL_ID);

// 1. FIREBASE ADMIN PANELNI SOZLASH
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Bu yerda private_key ichidagi yangi qator belgilarini to'g'rilaymiz
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
    }),
    // O'zgaruvchi aniq o'qilishi uchun uni shu yerning o'zida string ekanini tekshiramiz
    databaseURL: String(process.env.FIREBASE_DATABASE_URL).trim()
  });
}
const db = admin.database();

// 2. TELEGRAF BOTNI ISHGA TUSHIRISH
const bot = new Telegraf(BOT_TOKEN);

// WebApp havolasi (GitHub Pages sahifangiz)
const WEBAPP_URL = "https://jahongirsteam1-ux.github.io/railway/"; 

// Botga /start bosilganda WebApp ochadigan tugma chiqarish
bot.start((ctx) => {
  ctx.reply(`⚡ TechStore do'konimizga xush kelibsiz, ${ctx.from.first_name}!`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🛍️ Do'konni ochish", web_app: { url: WEBAPP_URL } }]
      ]
    }
  });
});

// 3. KANALGA KELGAN CHEKNI REGEKS ORQALI TEKSHIRISH
bot.on('channel_post', async (ctx) => {
  if (ctx.channelPost.chat.id !== CARDXABAR_CHANNEL_ID) return;

  const text = ctx.channelPost.text || ctx.channelPost.caption;
  if (!text || !text.includes("To'ldirish")) return;

  try {
    // FAQAT "+" belgisidan keyingi summani olamiz (Balans summasiga tegmaydi)
    const match = text.match(/\+\s*([\d\.,\s]+)\s*UZS/);
    
    if (match) {
      const cleanAmountStr = match[1].trim().replace(/\./g, '').replace(',', '.');
      const incomingAmount = parseFloat(cleanAmountStr);

      console.log(`CardXabar kanalidan tushum keldi: ${incomingAmount} UZS`);

      const ordersRef = db.ref('orders');
      // Firebase'dan kutilayotgan va unikal summasi mos keladigan buyurtmani qidirish
      const snapshot = await ordersRef.orderByChild('finalAmount').equalTo(incomingAmount).once('value');
      const orders = snapshot.val();

      if (orders) {
        for (let orderId in orders) {
          if (orders[orderId].status === 'pending') {
            
            // 1. Statusni avtomat tasdiqlaymiz
            await ordersRef.child(orderId).update({
              status: 'confirmed',
              confirmedAt: admin.database.ServerValue.TIMESTAMP
            });

            console.log(`Buyurtma №${orderId} avtomatik tasdiqlandi!`);

            // 2. Foydalanuvchiga botdan xabar yuboramiz
            const userId = orders[orderId].userId;
            if (userId) {
              await bot.telegram.sendMessage(userId, `🎉 To'lovingiz qabul qilindi!\n\nBuyurtmangiz (№${orderId}) muvaffaqiyatli tasdiqlandi va yetkazib berishga topshirildi.`);
            }
            break;
          }
        }
      }
    }
  } catch (error) {
    console.error("Chekni tekshirishda xatolik:", error);
  }
});

// Botni ishga tushirish
bot.launch().then(() => console.log("🤖 Telegram Bot muvaffaqiyatli ishga tushdi!"));

// 4. WEB APP UCHUN SERVERNIKINI SAQLAB QOLISH
const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`TechStore Web Server ${PORT}-portda ishlamoqda.`);
});

// Xavfsiz o'chirish protsedurasi
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
