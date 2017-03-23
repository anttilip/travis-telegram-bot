import TelegramBot from 'node-telegram-bot-api';
import request from 'request-promise-native';
import fs from 'fs-promise';

const TOKEN = process.env.TELEGRAM_TOKEN || '360404689:AAFRY7mnHyl2dLbK-FnYqo-BYBKwcZH-hz8';
const botOptions = {
    polling: true
};
const bot = new TelegramBot(TOKEN, botOptions);

const apiBaseURL = 'https://api.travis-ci.org';

const requestOptions = {
    method: 'GET',
    headers: {
        accept: 'application/vnd.travis-ci.2+json'
    },
    json: true
};

// Matches "/subscribe [travis url]"
bot.onText(/\/subscribe https:\/\/travis-ci.org\/(.+)\/(.+)/, (msg, match) => {
    const [username, repo] = match.slice(1);
    addSubscription(msg.chat.id, username, repo);
});

// Matches "/unsubscribe [travis url]"
bot.onText(/\/unsubscribe https:\/\/travis-ci.org\/(.+)\/(.+)/, (msg, match) => {
    const [username, repo] = match.slice(1);
    bot.sendMessage(msg.chat.id, `unfollowing username=${username} and repo=${repo}`); 
});

// Matches "/list"
bot.onText(/\/list/, (msg, match) => {
    const subscriptionList = getSubscriptions(msg.chat.id);
    bot.sendMessage(msg.chat.id, 'Getting your subscriptions'); 
});

// Matches "/help
bot.onText(/(\/help|\/start)/, (msg, match) => {
    const helpText = `I can send you a message every time Travis-CI runs a new \
        build on repository you are subscribing to. You can subscribe to any \
        [Travis CI](https://travis-ci.org/) project by sending a message:\n\
        \`/subscribe [url]\`  -  for example \n\`/subscribe \
        https://travis-ci.org/facebook/react\`\n\n\
        You can see your subscriptions with command \`/list\`.\n\n\
        You can unsubscribe with command \n\`/subscribe [url]\`  -  for example\
        \n\`/subscribe https://travis-ci.org/facebook/react\``.replace(/        /g, '');
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: "markdown" });
});

const getSubscriptions = async chat_id => {
    const data = await fs.readFile('subscriptions.txt', 'utf-8');
    const repos = data.split('\n')
        .filter(line => line.startsWith(chat_id))
        .map(line => 'https://travis-ci.org/' + line.split(' ')[1]);

    bot.sendMessage(chat_id, repos.join('\n'));
};

const addSubscription = async (chat_id, username, repoName) => {
    let repo = null;
    // Get repo from API
    try {
        const options = Object.assign({}, requestOptions, 
            {uri: `${apiBaseURL}/repos/${username}/${repoName}`});
        const response = await request(options);
        repo = response.repo;
    } catch(error) {
        console.error(error);
        bot.sendMessage(chat_id, 'Not a valid repository');
        return;
    }
    
    // Append repository to subscriptions
    fs.appendFile('subscriptions.txt', `${chat_id} ${username}/${repoName} ${repo.id} ${repo.last_build_id}\n`)
        .then(() => {
            console.log("Subscription succefully added");
            const text = `Subscription added. Last build ${repo.last_build_state}`
            bot.sendMessage(chat_id, text);
        }).catch(error => {
            console.error(error)
            bot.sendMessage(chat_id, "Something went wrong while adding the subscription");
    });
};

const checkRepoUpdates = async () => {
    // Get current subscriptions and pair them by url and last build id
    const data = await fs.readFile('subscriptions.txt', 'utf-8');
    console.log(data);
    const baseUrl = 'https://api.travis-ci.org/builds?repository_id=';
    const repos =  data.split('\n')
        .filter(line => line.length > 2)
        .map(line => {
            const url = `${baseUrl}${line.split(' ')[2]}`;
            const lastBuildId = line.split(' ')[3];
            const repoName = line.split(' ')[1];
            return [url, Number(lastBuildId), repoName];
        });
    
    // Check if server has newer build
    repos.forEach(repo => {
        const [url, lastBuildId, repoName] = repo;
        const options = Object.assign({}, requestOptions, {uri: url});
        request(options).then(resp => {
            const [build, commit] =  [resp.builds[0], resp.commits[0]];
            if (build.id !== lastBuildId) {
                console.log(`NEW_BUILD ${url} ${build.id} ${lastBuildId}`)
                broadcastRepoUpdates(build, commit, repoName);
                updatelastBuildId(repoName, build.id);
            }
        }).catch(console.error);
    })
}

const broadcastRepoUpdates = async (build, commit, repoName) => {
    console.log('broadcast');
    const data = await fs.readFile('subscriptions.txt', 'utf-8');
    console.log(build.repository_id)
    console.log(data.split('\n').map(line => line.split(' ')[2]));
    const notifiedChats = data.split('\n')
        .filter(line => line.split(' ')[2] == build.repository_id)
        .map(line => line.split(' ')[0]);

    console.log(notifiedChats);
    const text = `**New Travis-CI build on ${repoName}!**\n\
        Build #${build.number} ${build.state}.\n\
        **${commit.author_name}**: ${commit.message}\n\
        [Compare commits](${commit.compare_url}).`.replace(/        /g, '');;

    notifiedChats.forEach(chatId => {
        bot.sendMessage(chatId, text, {parse_mode: 'markdown'});
    });
};

const updatelastBuildId = async (repoName, buildId)  => {
    const data = await fs.readFile('subscriptions.txt', 'utf-8');
    const updatedLines = data.split('\n').map(line => {
        const lineParts = line.split(' ');
        if (lineParts[1] === repoName) {
            lineParts.splice(3, 1, buildId);
            line = lineParts.join(' ');
        }
       return line;
    });

    fs.writeFile('subscriptions.txt', updatedLines.join('\n'), 'utf-8');
};

setInterval(checkRepoUpdates, 120000);