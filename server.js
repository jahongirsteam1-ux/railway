const http = require('http');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api'); // Telegram bot kutubxonasi

// 1. Bot sozlamalari
// BotFather bergan TOKENni mana shu yerga qo'shtirnoq ichiga yozing:
const TOKEN = '8981640688:AAHzpa8nLsJ0MvXifkZ9jmfzt1lzR7ISw1g'; 
const bot = new TelegramBot(TOKEN, { polling: true });

const PORT = process.env.PORT || 3000;

// 2. Telegram Bot /start komandasi uchun kod
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const webAppUrl = "https://techstore-app-production.up.railway.app";

    bot.sendMessage(chatId, `Salom, ${msg.from.first_name}! 👋\n\n**TechStore** rasmiy botiga xush kelibsiz!\nEng yangi texnologiyalar va aksessuarlarni ko'rish uchun pastdagi tugmani bosing.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "🛍️ Do'konni ochish",
                        web_app: { url: webAppUrl }
                    }
                ]
            ]
        }
    });
});

// 3. Mavjud veb-server qismi (index.html xizmati)
const server = http.createServer((req, res) => {
    const filePath = path.join(__dirname, 'index.html');

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`TechStore server ishga tushdi: port ${PORT}`);
});
