const fs = require('fs')
const readline = require('readline')
const { google } = require('googleapis')
const clientFile = '.cred/client_secret.json'
const tokenFile = '.cred/auth_token.json'
const commandFile = 'src/bot_command.json'
const authScope = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
]

fs.readFile(clientFile, (error, content) => {
    if (error) return console.error(error + '\n')
    const credentials = JSON.parse(content)
    const clientSecret = credentials.installed.client_secret
    const clientId = credentials.installed.client_id
    const redirectUrl = credentials.installed.redirect_uris[0]
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUrl)
    fs.readFile(tokenFile, (error, content) => {
        if (error) {
            getToken(oauth2Client)
        } else {
            oauth2Client.credentials = JSON.parse(content)
            getVideoId(oauth2Client)
        }
    })
})

/**
 * 
 * @param {google.auth.OAuth2} oauth 
 */
function getToken(oauth) {
    const authUrl = oauth.generateAuthUrl({
        access_type: 'offline',
        scope: authScope
    })
    console.warn('Login : ' + authUrl + '\n')
    const interface = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    interface.question('Code : ', code => {
        interface.close()
        console.log('')
        oauth.getToken(code, (error, token) => {
            if (error) return console.error(error + '\n')
            oauth.credentials = token
            fs.writeFile(tokenFile, JSON.stringify(token), error => { })
            getVideoId(oauth)
        })
    })
}

/**
 * 
 * @param {google.auth.OAuth2} oauth 
 */
function getVideoId(oauth) {
    const interface = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    interface.question('Video ID : ', id => {
        interface.close()
        console.log('')
        run(oauth, id)
    })
}

/**
 * 
 * @param {google.auth.OAuth2} oauth 
 * @param {string} videoId 
 */
function run(oauth, videoId) {
    google.youtube('v3').videos.list({
        part: 'liveStreamingDetails',
        id: videoId,
        auth: oauth
    }, (error, response) => {
        if (error) return console.error(error + '\n')
        const items = response.data.items
        if (items.length < 1) return
        const chatId = items[0].liveStreamingDetails.activeLiveChatId
        listenLiveChat(chatId, oauth)
    })
}

/**
 * 
 * @param {string} chatId 
 * @param {google.auth.OAuth2} oauth 
 * @param {string} token 
 * @param {bool} isSend 
 */
function listenLiveChat(chatId, oauth, token, isSend) {
    google.youtube('v3').liveChatMessages.list({
        auth: oauth,
        liveChatId: chatId,
        pageToken: token,
        part: 'id,snippet,authorDetails'
    }, (error, response) => {
        if (error) return console.error(error + '\n')
        fs.readFile(commandFile, (error, content) => {
            if (error) return console.error(error + '\n')
            const command = JSON.parse(content)
            checkSendMessage(response.data, isSend, oauth, chatId, command)
        })
    })
}

/**
 * 
 * @param {object} data 
 * @param {bool} isSend 
 * @param {google.auth.OAuth2} oauth 
 * @param {string} chatId 
 * @param {object} command 
 */
function checkSendMessage(data, isSend, oauth, chatId, command) {
    for (let item of data.items) {
        const author = item.authorDetails
        const message = item.snippet.textMessageDetails.messageText
        console.info(author.displayName + '\n' + message + '\n')
        if (isSend) botCommandChat(oauth, chatId, message, command, author)
    }
    setTimeout(listenLiveChat,
        data.pollingIntervalMillis + 2000,
        chatId,
        oauth,
        data.nextPageToken,
        true
    )
}

/**
 * 
 * @param {google.auth.OAuth2} oauth 
 * @param {string} chatId 
 * @param {string} message 
 * @param {object} library 
 * @param {object} author 
 */
function botCommandChat(oauth, chatId, message, library, author) {
    message = message.toLowerCase()
    if (!library[message]) return
    else if (message.startsWith('!edit')) editCommand(message, library, author)
    else sendMessage(oauth, chatId, library[message])
}

/**
 * 
 * @param {google.auth.OAuth2} oauth 
 * @param {string} chatId 
 * @param {string} message 
 */
function sendMessage(oauth, chatId, message) {
    google.youtube('v3').liveChatMessages.insert({
        part: 'snippet',
        auth: oauth,
        requestBody: {
            snippet: {
                type: 'textMessageEvent',
                liveChatId: chatId,
                textMessageDetails: {
                    messageText: message
                }
            }
        }
    }, (error, response) => { })
}

/**
 * 
 * @param {string} message 
 * @param {object} library 
 * @param {object} author 
 */
function editCommand(message, library, author) {
    if (!author.isChatOwner && !author.isChatModerator) return
    message = message.replace('!edit', '').trim()
    const command = message.split(' ')[0]
    message = message.replace(command, '').trim()
    library[command] = message
    fs.writeFile(commandFile,
        JSON.stringify(library, null, 2),
        error => { }
    )
}
