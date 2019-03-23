const request = require('request-promise');
const cheerio = require('cheerio');
const Queue = require('bull');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// The currencies will be refreshed every second.
const refreshRate = 1000;

const prices = {};

// Queues can have different names, and be attached to different redis servers.
const fiat = new Queue('prices for fiat currencies', redisUrl);
const crypto = new Queue('prices for crypto currencies', redisUrl);

// The handler for the queue can either take a callback in the second argument or return a promise. 
// This handler grabs the prices of various fiat currencies, in U.S. dollars, from xe.com.
fiat.process(async function (job) {
    const $ = await request({
        url: `https://www.xe.com/currencytables/?from=USD`,
        transform: (body) => cheerio.load(body)
    });

    for (const symbol of job.data.symbols) {
        prices[symbol] = Number($(`#historicalRateTbl td:contains("${symbol}")`).next().next().next().text());
    }
});

// This handler grabs the current prices of various crypto currencies, in U.S. dollars from coindesk.
crypto.process(async function (job) {
    const ticker = await request({
        url: `https://production.api.coindesk.com/v1/currency/ticker?currencies=${job.data.symbols.join(',')}`,
        transform: (body) => JSON.parse(body)
    });

    for (const symbol in ticker.data.currency) {
        const price = ticker.data.currency[symbol].quotes.USD.price;
        prices[symbol] = price;
    }
});

// The console is refreshed every second with the updated results. 
setInterval(() => {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);

    let output = [];
    for (const symbol in prices) {
        const price = prices[symbol].toFixed(2);

        output.push(symbol + ': '+ price);
    }

    output = output.sort();

    if (output.length)
        process.stdout.write(output.join(" | "));
    else
        process.stdout.write('loading...');
    
}, refreshRate);

// Arbitrary can be passed to the handler for each job. Jobs can also be repeated.
fiat.add({ symbols: [ 'EUR', 'GBP', 'CNY', 'JPY' ] }, { repeat: { every: refreshRate } });
crypto.add({ symbols: [ 'BTC', 'ETH', 'XRP', 'BCH' ] }, { repeat: { every: refreshRate } });