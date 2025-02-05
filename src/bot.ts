import { Telegraf } from 'telegraf'
import { callbackQuery } from 'telegraf/filters'
import chalk from 'chalk'

const bot = new Telegraf(process.env.BOT_TOKEN!)

// const channelId = '-1002462309705' // ID of networkingFB channel
const testChannelId = '-1002282641909' // ID of test channel
const moderationChannelId = '-1002325968351' // ID of moderation channel

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

    console.log(chalk.hex('#FFF')(`Start:\n`), chalk.hex('#8B5DFF')('pending:'), pendingSuggestions, '\n', chalk.hex('#3D3BF3')(`published:`), publishedSuggestions, '\n', chalk.hex('#9694FF')(`rejected:`), rejectedSuggestions, '\n')
    
    ctx.reply('Ваше предложение отправлено на модерацию.')

    sendToModerators(newSuggestion, `Новое предложение от @${msg.from.username}:\n\n${newSuggestion.text}`)
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

  bot.telegram.sendMessage(moderationChannelId, text, options)
}

bot.on(callbackQuery('data'), async (ctx) => {
  const callbackQuery = ctx.callbackQuery
  const msg: any = callbackQuery.message

  const action = callbackQuery.data.split('_')[0]
  const suggestionId = parseInt(callbackQuery.data.split('_')[1])

  const suggestion = pendingSuggestions.find(s => s.id === suggestionId)

  const editMessage = async (suggestion: Suggestion, result: 'Опубликовано' | 'Отклонено') => {
    if (msg && msg.text) {
      const currentText = msg.text
      // ☑️🔘✔️🟢🔴
      await ctx.editMessageText(`${currentText}\n\n${result === 'Опубликовано' ? '☑️' : '🔘'} *${`${result}`}*`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Связаться', callback_data: `contact_${suggestion.id}`, url: `https://t.me/${suggestion.username}` }
            ]
          ]
        },
        parse_mode: 'Markdown'
      })
    }
  }
  
  switch (action) {
    case 'publish':
      if (suggestion) {
        ctx.answerCbQuery('Предложение подтверждено')
        publishedSuggestions.push({ ...suggestion, status: 'published' })
        pendingSuggestions = pendingSuggestions.filter(s => s.id !== suggestionId)
        editMessage(suggestion, 'Опубликовано')

        const suggestionPost = `${suggestion.text}` // production template
        bot.telegram.sendMessage(testChannelId, suggestionPost)

        bot.telegram.sendMessage(suggestion.userId, 'Предложение опубликовано!')
      }
      break
    case 'reject':
      if (suggestion) {
        ctx.answerCbQuery('Предложение отклонено')
        rejectedSuggestions.push({ ...suggestion, status: 'rejected' })
        pendingSuggestions = pendingSuggestions.filter(s => s.id !== suggestionId)
        editMessage(suggestion, 'Отклонено')

        bot.telegram.sendMessage(suggestion.userId, 'Предложение отклонено.')
      }
      break
    }
    console.log(chalk.hex('#FFF')(`End:\n`), chalk.hex('#8B5DFF')('pending:'), pendingSuggestions, '\n', chalk.hex('#3D3BF3')(`published:`), publishedSuggestions, '\n', chalk.hex('#9694FF')(`rejected:`), rejectedSuggestions, '\n')
})

bot.launch().catch(error => {
  console.error('Ошибка при запуске бота:', error)
})