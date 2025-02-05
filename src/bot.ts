import { Telegraf } from 'telegraf'
import { callbackQuery } from 'telegraf/filters'
import chalk from 'chalk'

const bot = new Telegraf(process.env.BOT_TOKEN!)

type Suggestion = {
  id: number
  userId: number
  username: string | undefined
  text: string
  status?: 'pending' | 'published' | 'rejected'
}

type SuggestionWithStatus<T extends Suggestion['status']> = Suggestion & { status?: T }


let publishedSuggestions: SuggestionWithStatus<'published'>[] = []
let pendingSuggestions: SuggestionWithStatus<'pending'>[] = []
let rejectedSuggestions: SuggestionWithStatus<'rejected'>[] = []

bot.start((ctx) => {
  ctx.reply('Добро пожаловать! Отправьте ваши предложения.')
})

bot.on('text', (ctx) => {
  const msg = ctx.message

  if (msg.text) {
    const newSuggestion: SuggestionWithStatus<'pending'> = {
      id: Date.now(),
      userId: msg.from.id,
      username: msg.from.username,
      text: msg.text,
    }
    
    pendingSuggestions.push({ ...newSuggestion, status: 'pending' })

    console.log(chalk.hex('#00ffff')(`Start:`), `\npending:\n`, pendingSuggestions, `\npublished:\n`, publishedSuggestions, `\nrejected:\n`, rejectedSuggestions)
    
    ctx.reply('Ваше предложение отправлено на модерацию.')

    sendToModerators(newSuggestion, `Новое предложение от @${msg.from.username}:\n${newSuggestion.text}`)
  }
})

const sendToModerators = (suggestion: Suggestion, text: string) => {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Опубликовать', callback_data: `publish_${suggestion.id}` },
          { text: 'Отклонить', callback_data: `reject_${suggestion.id}` },
          { text: 'Связаться', callback_data: `contact_${suggestion.id}`, url: `https://t.me/${suggestion.username}` },
        ],
      ],
    },
  }

  bot.telegram.sendMessage(process.env.MODERATION_CHANNEL_ID!, text, options)
}

bot.on(callbackQuery('data'), (ctx) => {
  const callbackQuery = ctx.callbackQuery.data

  const action = callbackQuery.split('_')[0]
  const suggestionId = parseInt(callbackQuery.split('_')[1])

  const suggestion = pendingSuggestions.find(s => s.id === suggestionId)
  
  switch (action) {
    case 'publish':
      if (suggestion) {
        ctx.answerCbQuery('Предложение подтверждено')
        publishedSuggestions.push({ ...suggestion, status: 'published' })
        pendingSuggestions = pendingSuggestions.filter(s => s.id !== suggestionId)

        const suggestionPost = `${suggestion.text}` // production template
        bot.telegram.sendMessage(process.env.TEST_CHANNEL_ID!, suggestionPost)

        bot.telegram.sendMessage(suggestion.userId, 'Предложение опубликовано!')
      }
      break
    case 'reject':
      if (suggestion) {
        ctx.answerCbQuery('Предложение отклонено')
        rejectedSuggestions.push({ ...suggestion, status: 'rejected' })
        pendingSuggestions = pendingSuggestions.filter(s => s.id !== suggestionId)

        bot.telegram.sendMessage(suggestion.userId, 'Ваше предложение отклонено.')
      }
      break
    }
  console.log(chalk.hex('#00ffff')(`End:\n`), 'pending:', pendingSuggestions, `published:\n`, publishedSuggestions, `rejected:\n`, rejectedSuggestions)
})

bot.launch().catch(error => {
  console.error('Ошибка при запуске бота:', error)
})