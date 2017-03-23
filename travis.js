import TelegramBot from 'node-telegram-bot-api';
import request from 'request-promise-native';
import fs from 'fs';

const TOKEN = process.env.TELEGRAM_TOKEN || '360404689:AAFRY7mnHyl2dLbK-FnYqo-BYBKwcZH-hz8';
const botOptions = {
    polling: true
};
const bot = new TelegramBot(TOKEN, botOptions);

const apiBaseURL = 'https://api.travis-ci.org';

// Matches "/subscribe [travis url]"
bot.onText(/\/subscribe https:\/\/travis-ci.org\/(.+)\/(.+)/, (msg, match) => {
    const [username, repo] = match.slice(1);
    addSubscription(msg.chat.id, username, repo);
    bot.sendMessage(msg.chat.id, `Trying to follow ${username}/${repo}`); 
});

// Matches "/unsubscribe [travis url]"
bot.onText(/\/unsubscribe https:\/\/travis-ci.org\/(.+)\/(.+)/, (msg, match) => {
    const [username, repo] = match.slice(1);
    bot.sendMessage(msg.chat.id, `unfollowing username=${username} and repo=${repo}`); 
});

// Matches "/help
bot.onText(/\/help/, (msg, match) => {
    const helpText = `You can subscribe to any [Travis CI](https://travis-ci.org/)  \
        project by sending a message\n\`/subscribe [url]\`, for example  \
        \n\`/subscribe https://travis-ci.org/facebook/react\`\n\n\
        You can see your subscriptions with command \`/list\`.\n\n\
        You can unsubscribe with command \n\`/subscribe [url]\`, for example  \
        \n\`/subscribe https://travis-ci.org/facebook/react\``.replace(/        /g, '');
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: "markdown" });
});

// Matches "/list"
bot.onText(/\/list/, (msg, match) => {
    const subscriptionList = getSubscriptions(msg.chat.id);
    bot.sendMessage(msg.chat.id, 'Getting your subscriptions'); 
});


const getSubscriptions = chat_id => {
    fs.readFile('subscriptions.txt', 'utf-8', (err, data) => {
        // console.log(data);
        const repos = data.split('\n')
            .filter(line => line.startsWith(chat_id))
            .map(line => 'https://travis-ci.org/' + line.split(' ')[1]);
        console.log(repos);
        bot.sendMessage(chat_id, repos.join('\n'));
    });
};

const addSubscription = (chat_id, username, repo) => {
    const options = {  
        method: 'GET',
        uri: `${apiBaseURL}/repos/${username}/${repo}`,
        json: true 
    };
    request(options)  
        .then(response => {
            console.log(response.id);
            fs.appendFile('subscriptions.txt', `${chat_id} ${username}/${repo}\n`, 
            (err) => {
                console.log("Subscription succefully added");
                bot.sendMessage(chat_id, "Subscription succefully added");
            });
        })
      .catch(err => {
        console.error(err)
        bot.sendMessage(chat_id, "Something went wrong while adding Subscription");
    });
};
