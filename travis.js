"use strict";

import Tgfancy from 'tgfancy'
import request from 'request-promise-native';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL;
const client = new pg.Client(DB_URL);
client.connect();

const TOKEN = process.env.TELEGRAM_TOKEN || 'Your Telegram API Token';
const PORT = process.env.PORT || 443;
const HOST = process.env.HOST || '0.0.0.0';
const url = process.env.URL || 'https://travis-tg-bot.herokuapp.com'
const bot = new Tgfancy(TOKEN, { webHook: { port: PORT, host: HOST } });
bot.setWebHook(`${url}/bot${TOKEN}`);

const apiBaseURL = 'https://api.travis-ci.org';

const requestOptions = {
	method: 'GET',
	headers: {
		accept: 'application/vnd.travis-ci.2+json'
	},
	json: true
};

// Matches "/subscribe [travis url]"
bot.onText(/\/subscribe (.*)travis-ci.org\/(.[^\/]*)\/(.[^\/]*)/, (msg, match) => {
	const [username, repo] = match.slice(2);
	addSubscription(msg.chat.id, username, repo);
});

// Matches "/unsubscribe [travis url]"
bot.onText(/\/unsubscribe (.*)travis-ci.org\/(.[^\/]*)\/(.[^\/]*)/, (msg, match) => {
	const [username, repo] = match.slice(2);
	removeSubscription(msg.chat.id, username, repo);
});

// Matches "/list"
bot.onText(/\/list/, async (msg, match) => {
	const repos = await getChatsSubscriptions(msg.chat.id);
	if (repos.length === 0) {
		bot.sendMessage(msg.chat.id, "You have not subscibed to any repository");
	} else {
		const urls = repos.map(repo => `https://travis-ci.org/${repo.username}/${repo.name}`);
		bot.sendMessage(msg.chat.id, urls.join('\n'));
	}
});

// Matches "/help
bot.onText(/(\/help|\/start)/, (msg, match) => {
	const helpText = `I can send you a message every time Travis-CI runs a new \
		build on repository you are subscribing to. You can subscribe to any \
		[Travis CI](https://travis-ci.org/) project by sending a message:\n\
		\`/subscribe [url]\`  -  for example \n\`/subscribe \
		https://travis-ci.org/facebook/react\`\n\n\
		You can see your subscriptions with command \`/list\`.\n\n\
		You can unsubscribe with command \n\`/unsubscribe [url]\`  -  for example\
		\n\`/unsubscribe https://travis-ci.org/facebook/react\``.replace(/		/g, '');
	bot.sendMessage(msg.chat.id, helpText, { parse_mode: "markdown" });
});

const getChatsSubscriptions = async (chat_id) => {
	const repos = await client.query(`
		SELECT * FROM repos r
		LEFT JOIN subscriptions s ON s.repo_id=r.id
		WHERE s.chat_id = ${chat_id}`)
	return repos.rows;
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

	// Check if chat exists in database
	const chatExists = await client.query(`SELECT 1 FROM chats WHERE id=${chat_id}`)
		.then(result => result.rowCount === 0 ? false : true);

	if (!chatExists) {
		// Add new chat to database
		client.query(`INSERT INTO chats VALUES (${chat_id})`);
	} else {
		// Check if chat is already subscribed to repo
		const chatsRepos = await getChatsSubscriptions(chat_id);
		if (chatsRepos.map(repo => repo.id).includes(repo.id)) {
			// User is already subscribed
			bot.sendMessage(chat_id, 'Already subscribed!');
			return;
		}
	}

	// Add subscription to database
	try {
		await Promise.all([
			// Add repo and subscription to database
			client.query(`INSERT INTO repos (id, username, name, build_id) VALUES 
				(${repo.id}, '${username}', '${repoName}', ${repo.last_build_id})
				ON CONFLICT DO NOTHING`),
			client.query(`INSERT INTO subscriptions (chat_id, repo_id) VALUES 
				(${chat_id}, ${repo.id}) ON CONFLICT DO NOTHING`)
		]);
		const text = `Subscription added. Last build ${repo.last_build_state}`;
		bot.sendMessage(chat_id, text);
	} catch (err) {
		console.error(err);
		bot.sendMessage(chat_id, "Something went wrong while adding the subscription");
	};
};

const removeSubscription = async (chat_id, username, repoName) => {
	const repo = await client.query(`
		SELECT * FROM repos 
		WHERE username='${username}' AND name='${repoName}'`)
	.then(result => result.rows[0]);
	
	client.query(`
		DELETE FROM subscriptions WHERE chat_id=${chat_id} AND repo_id=${repo.id}`)
	.then(() => bot.sendMessage(chat_id, `${username}/${repoName} removed`))
	.catch(err => {
		console.error(err);
		bot.sendMessage(chat_id, `Could not remove ${username}/${repoName}`);
	});
};

const checkRepoUpdates = async () => {
	const repos = await client.query(`SELECT * FROM repos`)
		.then(result => result.rows);
	
	repos.forEach(repo => {
		const url = `${apiBaseURL}/builds?repository_id=${repo.id}`;
		const options = Object.assign({}, requestOptions, {uri: url});

		request(options).then(resp => {
			const [build, commit] =  [resp.builds[0], resp.commits[0]];

			if (build.id !== repo.build_id && build.state !== 'started') {
				console.log(`NEW_BUILD ${url} ${build.id} ${repo.build_id}`)
				broadcastRepoUpdates(build, commit, `${repo.username}/${repo.name}`);
				updatelastBuildId(build.repository_id, build.id);
			}
		}).catch(console.error);
	});
}

const broadcastRepoUpdates = async (build, commit, repoName) => {
	// Get all chats which are subscribed to receive updates for the repo.
	const chats = await client.query(`
		SELECT * FROM chats c
		LEFT JOIN subscriptions s ON s.chat_id=c.id
		WHERE s.repo_id=${build.repository_id}`)
	.then(result => result.rows);
	
	const text = `*New Travis-CI build on ${repoName}!*\n\
		Build #${build.number} ${build.state}.\n\
		*${commit.author_name}*: ${commit.message}\n\
		[Compare commits](${commit.compare_url}).`.replace(/		/g, '');
	
	chats.forEach(chat => {
		bot.sendMessage(chat.chat_id, text, {parse_mode: 'markdown'});
	});
};

const updatelastBuildId = async (repoId, buildId)  => {
	client.query(`
		UPDATE repos
		SET build_id=${buildId}
		WHERE id=${repoId}
	`);
};

setInterval(checkRepoUpdates, 5000);
